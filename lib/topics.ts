// Topics are curated lexical filters, NOT queries.
//
// The obvious implementation — route the topic label through hybridSearch — fails
// in an instructive way. Measured against this corpus, "downtown and the
// waterfront" embeds at cosine 0.6479, BELOW the 0.6591 worst-case fabricated
// query the dense floor was calibrated against, because the agendas say "Main
// Street", "Promenade" and "pier" where the category name says "downtown". The
// floor correctly refused it and the button returned nothing. A category name is
// not a question and does not belong in a distribution calibrated on questions.
//
// So a topic never touches the floor. It is an explicit OR of corpus-verified
// terms: deterministic, inspectable, and unaffected by whether an embedding key is
// set. If a topic returns nothing that is a bug in the term list below, not an
// honest empty state — which is exactly why it must not be adjudicated like one.
//
// Two traps, both measured rather than guessed:
//
//   1. The `replace(plainto_tsquery(...)::text, '&', '|')` trick in search.ts
//      DECOMPOSES phrases. "design review" contributes a bare `review`, which
//      matches almost every agenda item, and inflated this topic to 219 of 707.
//      phraseto_tsquery keeps it as 'design' <-> 'review'. Now 107.
//
//   2. The english dictionary stems `parking` and `park` to the same lexeme
//      ('park'), so a parks topic containing the bare word "park" cannot be
//      separated from parking-meter items — 186 hits, top result a parking
//      ordinance. The list works around the collision with playground/trail/
//      open space and lands on 37 genuinely park items.
//
// Term lists are tuned against the live 707-item corpus. Counts at time of
// writing: housing 93, streets 12, water 96, safety 22, downtown 100, money 113,
// parks 37, building 107. Re-probe before editing a list — a topic that quietly
// grows to a third of the corpus has stopped being a filter.
import { dbConfigured, NO_DB, sql } from './db';
import type { Hit } from './search';

export type Topic = { id: string; label: string; terms: string[] };

export const TOPICS: Topic[] = [
  {
    id: 'housing',
    label: 'Housing & shelters',
    terms: ['housing', 'shelter', 'homeless', 'encampment', 'affordable housing', 'apartment', 'tenant', 'eviction'],
  },
  {
    id: 'streets',
    label: 'Streets & repairs',
    terms: ['pothole', 'pavement', 'sidewalk', 'repaving', 'resurfacing', 'crosswalk', 'roadway', 'asphalt'],
  },
  {
    id: 'water',
    label: 'Water & sewers',
    terms: ['water', 'sewer', 'wastewater', 'drought', 'stormwater', 'groundwater', 'potable'],
  },
  {
    id: 'safety',
    label: 'Police & fire',
    terms: ['police', 'fire department', 'paramedic', 'crime', 'code enforcement', 'patrol', 'ambulance'],
  },
  {
    id: 'downtown',
    // "Main Street" must stay a phrase — as loose lexemes, `street` alone pulled in
    // every street-repair item in the corpus.
    label: 'Downtown & the waterfront',
    terms: ['downtown', 'waterfront', 'promenade', 'pier', 'harbor', 'beach', 'parklet', 'Main Street'],
  },
  {
    id: 'money',
    label: 'City money & budgets',
    terms: ['budget', 'appropriation', 'audit', 'sales tax', 'Measure O', 'expenditure', 'fiscal year'],
  },
  {
    id: 'parks',
    // No bare "park" — see trap #2 above.
    label: 'Parks & recreation',
    terms: ['playground', 'trail', 'open space', 'recreation', 'golf course', 'community garden'],
  },
  {
    id: 'building',
    label: 'Building & zoning',
    terms: ['zoning', 'variance', 'subdivision', 'design review', 'setback', 'historic preservation'],
  },
];

export const topicById = (id: string): Topic | null =>
  TOPICS.find((t) => t.id === id) ?? null;

/** `total` is the whole matching set; `hits` is the ranked page actually shown. */
export type TopicResult = { hits: Hit[]; total: number };

export async function topicSearch(id: string, limit = 12): Promise<TopicResult> {
  const topic = topicById(id);
  if (!topic) return { hits: [], total: 0 };
  if (!dbConfigured) throw new Error(NO_DB);

  // Only tsquery-NORMALIZED text is ever concatenated here; the terms themselves
  // stay bound parameters and never leave phraseto_tsquery, so this is
  // injection-safe for the same reason OR_Q in search.ts is. A term that lexes to
  // nothing (all stopwords) is dropped rather than left to break the syntax.
  // `<->` binds tighter than `|`, but each branch is parenthesised anyway.
  const tq = sql`(
    select string_agg('(' || phraseto_tsquery('english', term)::text || ')', ' | ')
    from unnest(${topic.terms}::text[]) term
    where phraseto_tsquery('english', term)::text <> ''
  )::tsquery`;

  const [count] = await sql<{ n: number }[]>`
    select count(*)::int as n from items where tsv @@ ${tq}`;

  // Newest meeting breaks rank ties: of two equally-matching items, the one on an
  // upcoming agenda is the one a resident can still act on.
  const hits = await sql<Hit[]>`
    select i.id, i.item_number, i.plain_text, i.raw_text, i.page_start, i.page_end,
           d.meeting_date, d.url, b.name as body,
           ts_rank_cd(i.tsv, ${tq}) as score
    from items i
    join documents d on d.id = i.document_id
    join bodies    b on b.id = d.body_id
    where i.tsv @@ ${tq}
    order by score desc, d.meeting_date desc
    limit ${limit}`;

  return { hits, total: count?.n ?? 0 };
}
