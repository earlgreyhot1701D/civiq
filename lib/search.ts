// Hybrid retrieval: RRF (k=60) over a dense half and a lexical half.
// Rank-based, so cosine distance is never normalized against ts_rank — the usual
// reason a hybrid ends up worse than either half alone.
//
// Dense indexes plain_text (how residents talk); lexical indexes raw_text +
// plain_text (preserves "PROJ-12345", "Ordinance 2026-004" verbatim). That
// asymmetry is the point.
import { dbConfigured, NO_DB, sql, toVector } from './db';
import { embedQuery } from './embed';

export type Hit = {
  id: number;
  item_number: string;
  plain_text: string;
  page_start: number;
  page_end: number;
  meeting_date: string;
  url: string;
  body: string;
  score: number;
};

const K = 60;
export const DENSE_WEIGHT = 1.0;
export const LEXICAL_WEIGHT = 1.0;
const MAX_QUERY = 200;

// HANDOFF §5 numbers these $1,$2,$4,$5; Postgres rejects a parameter that is never
// referenced, so they are $1..$4 here. Same query, same weights.
const TAIL = `
select i.id, i.item_number, i.plain_text, i.page_start, i.page_end,
       d.meeting_date, d.url, b.name as body,
       coalesce($DW::float/(${K}+dn.rank), 0) + coalesce($LW::float/(${K}+lx.rank), 0) as score
from items i
join documents d on d.id = i.document_id
join bodies    b on b.id = d.body_id
left join dense dn on dn.id = i.id
left join lex   lx on lx.id = i.id
where dn.id is not null or lx.id is not null
order by score desc limit $LIMIT`;

const LEX_CTE = (p: number) => `
lex as (
  select id, row_number() over (
           order by ts_rank_cd(tsv, plainto_tsquery('english', $${p})) desc) as rank
  from items where tsv @@ plainto_tsquery('english', $${p}) limit 50
)`;

export async function hybridSearch(rawQuery: string, limit = 10): Promise<Hit[]> {
  const q = (rawQuery ?? '').trim().slice(0, MAX_QUERY);
  if (!q) return [];
  if (!dbConfigured) throw new Error(NO_DB);

  const vec = await embedQuery(q);

  let text: string;
  let params: unknown[];

  if (vec) {
    // $1 embedding · $2 query text · $3 dense weight · $4 lexical weight
    text =
      `with dense as (
         select id, row_number() over (order by embedding <=> $1::vector) as rank
         from items where embedding is not null
         order by embedding <=> $1::vector limit 50
       ),` +
      LEX_CTE(2) +
      TAIL.replace('$DW', '$3').replace('$LW', '$4').replace('$LIMIT', '$5');
    params = [toVector(vec), q, DENSE_WEIGHT, LEXICAL_WEIGHT, limit];
  } else {
    // No embedding key, or the embed call failed. Clean lexical-only search —
    // the dense half is simply empty. This is the shippable default.
    text =
      `with dense as (select i.id, 1::bigint as rank from items i where false),` +
      LEX_CTE(1) +
      TAIL.replace('$DW', '$2').replace('$LW', '$3').replace('$LIMIT', '$4');
    params = [q, DENSE_WEIGHT, LEXICAL_WEIGHT, limit];
  }

  try {
    return (await sql.unsafe(text, params as never[])) as unknown as Hit[];
  } catch (err) {
    throw new Error(`search failed: ${(err as Error).message}`);
  }
}

/** Real timestamp for the footer. Never a hardcoded string. */
export async function lastIngestedAt(): Promise<string | null> {
  if (!dbConfigured) return null;
  try {
    const [row] = await sql<{ finished_at: Date | null }[]>`
      select finished_at from runs where finished_at is not null
      order by finished_at desc limit 1`;
    return row?.finished_at ? row.finished_at.toISOString() : null;
  } catch {
    return null;
  }
}

export async function corpusStats(): Promise<{ bodies: number; documents: number; items: number }> {
  if (!dbConfigured) return { bodies: 0, documents: 0, items: 0 };
  try {
    const [row] = await sql<{ bodies: number; documents: number; items: number }[]>`
      select (select count(*)::int from bodies)    as bodies,
             (select count(*)::int from documents) as documents,
             (select count(*)::int from items)     as items`;
    return row ?? { bodies: 0, documents: 0, items: 0 };
  } catch {
    return { bodies: 0, documents: 0, items: 0 };
  }
}
