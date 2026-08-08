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

// Cosine similarity below which, with zero strict lexical hits, we say we found
// nothing rather than rank the least-irrelevant rows. Calibrated, not guessed —
// see the measurement in the comment inside hybridSearch.
export const DENSE_FLOOR = 0.7;

// Identifier-shaped queries are exact lookups. Someone asking for "Ordinance
// 2026-004" is not helped by a similar-but-different ordinance ranked first —
// that is a wrong answer wearing a receipt. Lexical is weighted up for these, and
// the OR fallback is withheld: if the exact identifier is not in the corpus, the
// honest empty state beats a confident near-miss. Plain-language queries keep the
// even 1.0/1.0 split, where broadening is what makes them work at all.
// Every branch requires a number adjacent to the word. A bare "ordinance" is
// conversational ("is there a new ordinance about short term rentals") and must
// broaden like any other plain-language query — routing it to exact mode returned
// nothing, which reads as a broken search rather than an honest empty state.
export const IDENTIFIER =
  /\b[A-Z]{2,}-?\d{2,}|\bordinance\s+(no\.?\s*)?\d|\bAPN\b|\bcase\s*no\.?\s*\d|\bresolution\s+(no\.?\s*)?\d/i;

export const weightsFor = (q: string) =>
  IDENTIFIER.test(q)
    ? { dense: 0.5, lexical: 2.0, exact: true }
    : { dense: DENSE_WEIGHT, lexical: LEXICAL_WEIGHT, exact: false };

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

// plainto_tsquery ANDs every term, so "can they put a bar next to my house" becomes
// bar & next & house and matches nothing — the headline demo query returned 0 rows.
// Swapping & for | inside the tsquery Postgres already built keeps its stemming and
// stopword handling (and stays injection-safe, since the text never leaves tsquery
// form). ts_rank_cd still ranks items matching more terms higher.
const AND_Q = (p: number) => `plainto_tsquery('english', $${p})`;
const OR_Q = (p: number) =>
  `replace(plainto_tsquery('english', $${p})::text, '&', '|')::tsquery`;

const LEX_CTE = (p: number, q: (p: number) => string) => `
lex as (
  select id, row_number() over (order by ts_rank_cd(tsv, ${q(p)}) desc) as rank
  from items where tsv @@ ${q(p)} limit 50
)`;

export async function hybridSearch(rawQuery: string, limit = 10): Promise<Hit[]> {
  const q = (rawQuery ?? '').trim().slice(0, MAX_QUERY);
  if (!q) return [];
  if (!dbConfigured) throw new Error(NO_DB);

  const vec = await embedQuery(q);
  const w = weightsFor(q);

  // Dense retrieval always returns something — cosine ranks every row, so there is
  // no natural "no match" and the honest empty state could never fire. Measured
  // against the real 707-item corpus: known-good queries top out at 0.7297+, and
  // queries with no plausible answer ("data centers", "casino") peak at 0.6591.
  // The floor sits in that gap. A non-empty strict lexical pass is strong enough
  // evidence on its own, so the floor only adjudicates when lexical found nothing.
  if (vec && !w.exact) {
    const [row] = await sql<{ sim: number; lex: number }[]>`
      select (select 1 - (embedding <=> ${toVector(vec)}::vector) from items
              where embedding is not null
              order by embedding <=> ${toVector(vec)}::vector limit 1) as sim,
             (select count(*)::int from items
              where tsv @@ plainto_tsquery('english', ${q})) as lex`;
    if (row && row.lex === 0 && Number(row.sim) < DENSE_FLOOR) return [];
  }

  const build = (lexQ: (p: number) => string) => {
    if (vec) {
      // $1 embedding · $2 query text · $3 dense weight · $4 lexical weight
      const text =
        `with dense as (
           select id, row_number() over (order by embedding <=> $1::vector) as rank
           from items where embedding is not null
           order by embedding <=> $1::vector limit 50
         ),` +
        LEX_CTE(2, lexQ) +
        TAIL.replace('$DW', '$3').replace('$LW', '$4').replace('$LIMIT', '$5');
      return { text, params: [toVector(vec), q, w.dense, w.lexical, limit] };
    }
    // No embedding key, or the embed call failed. Clean lexical-only search —
    // the dense half is simply empty. This is the shippable default.
    const text =
      `with dense as (select i.id, 1::bigint as rank from items i where false),` +
      LEX_CTE(1, lexQ) +
      TAIL.replace('$DW', '$2').replace('$LW', '$3').replace('$LIMIT', '$4');
    return { text, params: [q, w.dense, w.lexical, limit] };
  };

  const run = async (lexQ: (p: number) => string) => {
    const { text, params } = build(lexQ);
    return (await sql.unsafe(text, params as never[])) as unknown as Hit[];
  };

  try {
    const strict = await run(AND_Q);
    // Every term present is the better match when it exists; broaden only if the
    // strict pass found nothing, so precise queries keep their precise ranking.
    // Identifier lookups never broaden — see IDENTIFIER above.
    if (strict.length || w.exact) return strict;
    return await run(OR_Q);
  } catch (err) {
    throw new Error(`search failed: ${(err as Error).message}`);
  }
}
