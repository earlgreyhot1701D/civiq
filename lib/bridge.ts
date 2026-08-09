// The words residents type, mapped to the words the agendas actually use.
//
// This exists because of a measured hole. "pothole" appears ZERO times in all 141
// agendas — Ventura writes "pavement rehabilitation" and "slurry seal" — so
// "potholes on my street" gets no strict lexical hit, sims at 0.6482, trips the
// dense floor, and returns the honest empty state. The floor is behaving
// correctly. The corpus simply does not contain the word, and no amount of
// recalibration fixes a vocabulary gap. Neither half of hybrid retrieval closes
// it: lexical has nothing to match, and dense puts the phrase below the worst
// fabricated query in the calibration set.
//
// THE RULE FOR ADDING AN ENTRY, and it is not optional:
//
//   1. The source word must return ZERO items from the corpus. If residents' word
//      is already present, search already works and broadening it only adds noise.
//   2. Every target must return MORE than zero items.
//   3. READ THE ITEMS THE TARGET RETURNS. A count above zero is necessary and not
//      sufficient, and this is where a first draft of this file went wrong — six of
//      fourteen entries were removed after actually reading what they matched:
//        trash/garbage -> recycling   the corpus's "recycling" is WATER recycling
//                                     (VenturaWaterPure), not refuse collection
//        speed bump    -> speed       matched the VERB, in "rules to speed up
//                                     approval for affordable housing projects"
//        drainage      -> stormwater  appears once, incidentally, inside an
//                                     emergency electrical maintenance contract
//        eviction      -> rent        mobile-home rent control is adjacent to
//                                     eviction, not about it
//   4. If a resident word has no sound target — "cannabis", "solar", "bicycle",
//      "graffiti", "fireworks", "trash" — DO NOT invent a bridge. The honest empty
//      state is the correct answer. Bridging a word to loosely-related items is
//      precisely the "least-irrelevant rows carrying a full receipt" failure that
//      DENSE_FLOOR was added to stop, and a bridge is a way to reopen that hole
//      from the other side.
//
// Verify with a tsquery probe, not a regex: `\m` word boundaries do not work on
// this database even as a SQL literal, which silently returned zero for words that
// were plainly present and sent an earlier probe down the wrong path. Count with
// `tsv @@ plainto_tsquery('english', word)` over role='primary' items — that is
// what search itself sees, and it handles stemming.
//
// Counts below are from the live 707-item corpus at time of writing.
// Deliberately small. Every pair below was checked by reading the items it returns,
// not just by counting them.
export const BRIDGE: Record<string, string[]> = {
  // pothole(0) -> pavement(2) resurfacing(4) slurry(1)
  // Reads as: "hire a paving company to seal and resurface streets". Correct.
  pothole: ['pavement', 'resurfacing', 'slurry'],
  potholes: ['pavement', 'resurfacing', 'slurry'],
  // crosswalk(0) -> pedestrian(4) sidewalk(3) signal(1)
  // Reads as: "sidewalk improvements and a pedestrian crossing", bollards. Correct.
  crosswalk: ['pedestrian', 'sidewalk', 'signal'],
  // drainage(0) -> sewer(2). Reads as: "repair and replace the sewer line on
  // Monmouth Way". Thin but correct. stormwater(1) was dropped — see rule 3.
  drainage: ['sewer'],
  // airbnb(0) -> vacation rental(2), short term rental(2). Reads as: "changes to
  // its rules about short-term vacation rentals and homestays". Correct. Note
  // "short term rental" is PRESENT in the corpus, so it is a target here and must
  // never become a source.
  airbnb: ['vacation rental', 'short term rental'],
  // bar(0) nightclub(0) liquor(0) -> alcohol(2) conditional use(23). Reads as:
  // "Vault Cocktails wants to change from a restaurant to a bar/nightclub". This is
  // the headline demo query; dense already carried it at 0.7297, and the bridge
  // gives the lexical half something to match so it no longer rides on dense alone.
  bar: ['alcohol', 'conditional use'],
  nightclub: ['alcohol', 'conditional use'],
  liquor: ['alcohol', 'conditional use'],
};

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Targets for every bridge word present in the query, deduplicated. Empty when the
 * query contains none — which is the common case, and the reason this cannot
 * weaken the floor for an arbitrary query. A fabricated query like "data centers
 * being built near me" or "is the city building a casino downtown" touches no key
 * here and is adjudicated exactly as before.
 *
 * Single-word keys match whole tokens, not substrings: "bar" must not fire on
 * "barrier" or "barbecue". Plurals are matched by trying the token with a trailing
 * "s" removed as well, since residents type "bars" and "potholes".
 */
export function bridgeTerms(query: string): string[] {
  const q = fold(query);
  if (!q) return [];
  const tokens = new Set(q.split(' '));
  const out = new Set<string>();

  for (const [key, targets] of Object.entries(BRIDGE)) {
    const hit = key.includes(' ')
      ? q.includes(key) // multi-word keys are phrases: "speed bump"
      : tokens.has(key) || tokens.has(`${key}s`) || [...tokens].some((t) => t.replace(/s$/, '') === key);
    if (hit) for (const t of targets) out.add(t);
  }
  return [...out];
}
