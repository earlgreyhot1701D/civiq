// The RRF query builder. Extracted from search.ts so that file can hold retrieval
// POLICY (the floor, the weights, the order of passes) and stay under its 150-line
// ceiling, while the SQL text lives here.
//
// Params are collected as they are emitted rather than hand-numbered. The previous
// version carried a comment explaining that HANDOFF §5's $1,$2,$4,$5 had to become
// $1..$4 because Postgres rejects an unreferenced parameter — that class of bug is
// now impossible to write.
import { toVector } from './db';

const K = 60;

export type RrfOpts = {
  vec: number[] | null;
  q: string;
  dense: number;
  lexical: number;
  limit: number;
  /** 'and' = every term present. 'or' = broadened. */
  mode: 'and' | 'or';
  /**
   * A tsquery, as text, OR-ed into the lexical half. This is how vocabulary
   * bridging reaches RANKING and not merely the floor decision: without it, a
   * bridged query passed the floor and was then ranked by whatever generic words it
   * happened to contain — "trash pickup schedule" returned a finance review at the
   * top, on the strength of "schedule", which is exactly the least-irrelevant-rows
   * failure DENSE_FLOOR exists to prevent.
   */
  bridgeTq?: string | null;
};

export function rrfQuery(o: RrfOpts): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const add = (v: unknown) => `$${params.push(v)}`;

  const vecP = o.vec ? add(toVector(o.vec)) : null;
  const qP = add(o.q);

  // Swapping & for | inside the tsquery Postgres already built keeps its stemming
  // and stopword handling, and stays injection-safe since the text never leaves
  // tsquery form. plainto_tsquery ANDs every term, so "can they put a bar next to
  // my house" became bar & next & house and matched nothing.
  const base =
    o.mode === 'and'
      ? `plainto_tsquery('english', ${qP})`
      : `replace(plainto_tsquery('english', ${qP})::text, '&', '|')::tsquery`;
  // A parameter may be referenced more than once, so the bridge tsquery is added
  // here and reused in both the rank and the filter below.
  const lexq = o.bridgeTq ? `(${base} || ${add(o.bridgeTq)}::tsquery)` : base;

  const dense = vecP
    ? `select id, row_number() over (order by embedding <=> ${vecP}::vector) as rank
       from retrievable_items where embedding is not null
       order by embedding <=> ${vecP}::vector limit 50`
    : // No embedding key, or the embed call failed. The dense half is simply empty
      // and search degrades to lexical-only. This is the shippable default.
      `select id, 1::bigint as rank from retrievable_items where false`;

  const dwP = add(o.dense);
  const lwP = add(o.lexical);
  const limitP = add(o.limit);

  const text = `
    with dense as (${dense}),
    lex as (
      select id, row_number() over (order by ts_rank_cd(tsv, ${lexq}) desc) as rank
      from retrievable_items where tsv @@ ${lexq} limit 50
    )
    select i.id, i.item_number, i.plain_text, i.raw_text, i.page_start, i.page_end,
           d.meeting_date, d.url, b.name as body,
           coalesce(${dwP}::float/(${K}+dn.rank), 0)
         + coalesce(${lwP}::float/(${K}+lx.rank), 0) as score
    from retrievable_items i
    join documents d on d.id = i.document_id
    join bodies    b on b.id = d.body_id
    left join dense dn on dn.id = i.id
    left join lex   lx on lx.id = i.id
    where dn.id is not null or lx.id is not null
    order by score desc limit ${limitP}`;

  return { text, params };
}
