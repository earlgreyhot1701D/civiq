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
import { lexicalSearch, type LexicalResult } from './lexical';

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
export type TopicResult = LexicalResult;

/** A topic is a saved term list, so this is just the shared lexical query. */
export async function topicSearch(id: string, limit = 12): Promise<TopicResult> {
  const topic = topicById(id);
  if (!topic) return { hits: [], total: 0 };
  return lexicalSearch(topic.terms, limit);
}
