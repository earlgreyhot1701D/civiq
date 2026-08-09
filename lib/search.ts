// Hybrid retrieval: RRF (k=60) over a dense half and a lexical half.
// Rank-based, so cosine distance is never normalized against ts_rank — the usual
// reason a hybrid ends up worse than either half alone.
//
// Dense indexes plain_text (how residents talk); lexical indexes raw_text +
// plain_text (preserves "PROJ-12345", "Ordinance 2026-004" verbatim). That
// asymmetry is the point.
import { bridgeTerms } from './bridge';
import { dbConfigured, NO_DB, sql, toVector } from './db';
import { embedQuery } from './embed';
import { lexicalCount, orTsquery } from './lexical';
import { rrfQuery } from './rrf';

export type Hit = {
  id: number;
  item_number: string;
  plain_text: string;
  raw_text: string; // the city's own words, for the proof panel. Never rewritten.
  page_start: number;
  page_end: number;
  meeting_date: string;
  url: string;
  body: string;
  score: number;
};

export const DENSE_WEIGHT = 1.0;
export const LEXICAL_WEIGHT = 1.0;
const MAX_QUERY = 200;

// Cosine similarity below which, with zero strict lexical hits, we say we found
// nothing rather than rank the least-irrelevant rows. Calibrated against the real
// corpus over 8 known-good and 7 fabricated queries:
//
//   min(good) 0.6958  "can a restaurant take over the parking spots on my block"
//   max(bad)  0.6591  "data centers being built near me"
//
// Midpoint of a 0.037-wide gap. An earlier 0.70 came from a 3-query sample that
// happened to exclude the weakest genuine queries, and it silently ate two of them
// — the sample size WAS the bug, so widen the probe set before moving this.
export const DENSE_FLOOR = 0.677;

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

export async function hybridSearch(rawQuery: string, limit = 10): Promise<Hit[]> {
  const q = (rawQuery ?? '').trim().slice(0, MAX_QUERY);
  if (!q) return [];
  if (!dbConfigured) throw new Error(NO_DB);

  const vec = await embedQuery(q);
  const w = weightsFor(q);
  // Empty for almost every query; see lib/bridge.ts for why that matters.
  const bridged = w.exact ? [] : bridgeTerms(q);

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
    if (row && row.lex === 0 && Number(row.sim) < DENSE_FLOOR) {
      // A bridged term matching IS evidence, and it is the only evidence available
      // for a query whose words the agendas never use. "potholes on my street" has
      // no strict lexical hit and sims at 0.6482 because the word appears zero
      // times in 141 agendas — but "pavement" and "resurfacing" are right there.
      //
      // This weakens the floor ONLY for queries containing a curated, verified
      // bridge word. bridgeTerms() returns nothing for anything else, so the
      // fabricated queries the floor exists to catch are adjudicated unchanged.
      if (!bridged.length || (await lexicalCount(bridged)) === 0) return [];
    }
  }

  // The bridge tsquery is built by Postgres from bound parameters and handed back
  // as text, so composing it into the lexical half below stays injection-safe.
  let bridgeTq: string | null = null;
  if (bridged.length) {
    const [r] = await sql<{ tq: string | null }[]>`select (${orTsquery(bridged)})::text as tq`;
    bridgeTq = r?.tq ?? null;
  }

  const run = async (mode: 'and' | 'or', withBridge = false) => {
    const { text, params } = rrfQuery({
      vec,
      q,
      dense: w.dense,
      lexical: w.lexical,
      limit,
      mode,
      bridgeTq: withBridge ? bridgeTq : null,
    });
    return (await sql.unsafe(text, params as never[])) as unknown as Hit[];
  };

  try {
    const strict = await run('and');
    // Every term present is the better match when it exists; broaden only if the
    // strict pass found nothing, so precise queries keep their precise ranking.
    // Identifier lookups never broaden — see IDENTIFIER above.
    if (strict.length || w.exact) return strict;
    // Broadening is where the bridge belongs: it is the city's vocabulary for a word
    // the resident used and the agendas never do, OR-ed into the lexical half so it
    // ranks rather than merely unblocking the floor.
    return await run('or', true);
  } catch (err) {
    throw new Error(`search failed: ${(err as Error).message}`);
  }
}
