import { hybridSearch } from '../lib/search';
import { TOPICS, topicSearch } from '../lib/topics';
import { bridgeTerms } from '../lib/bridge';
import { sql } from '../lib/db';

type Case = { q: string; want: 'hits' | 'empty'; note?: string };
const CASES: Case[] = [
  // known-good, from the recalibration commit
  { q: 'can they put a bar next to my house', want: 'hits', note: 'headline, 0.7297' },
  { q: 'can a restaurant take over the parking spots on my block', want: 'hits', note: '0.6958' },
  { q: 'what will new buildings have to look like', want: 'hits', note: '0.6987' },
  // known-good, measured while porting
  { q: 'when will my street be repaved', want: 'hits' },
  { q: 'street repairs in my neighborhood', want: 'hits' },
  { q: 'is the city fixing the roads', want: 'hits' },
  // NEW: bridge must rescue these
  { q: 'potholes on my street', want: 'hits', note: 'BRIDGE: was blocked at 0.6482' },
  { q: 'potholes', want: 'hits', note: 'BRIDGE last-resort, single word' },
  { q: 'airbnb rules', want: 'hits', note: 'BRIDGE -> vacation rental' },
  // Removed from the bridge after reading what "recycling" actually matches
  // (VenturaWaterPure water recycling, not refuse). Honest empty state is correct.
  { q: 'trash pickup schedule', want: 'empty', note: 'bridge REMOVED, deliberately' },
  { q: 'eviction notice from my landlord', want: 'empty', note: 'bridge REMOVED, deliberately' },
  // Empty is CORRECT: the corpus holds nothing about traffic calming, and no
  // bridge was invented for it. Contrast "potholes on my street", which returns
  // hits only because "pavement"/"resurfacing" genuinely exist. This pair is the
  // evidence that the bridge is not a blanket floor-weakener.
  { q: 'speed bumps on my street', want: 'empty', note: 'no bridge, corpus has none' },
  // fabricated: must STAY empty. None contain a bridge word.
  { q: 'data centers being built near me', want: 'empty', note: '0.6591, worst fabricated' },
  { q: 'quantum teleportation timeshare', want: 'empty' },
  { q: 'cannabis dispensary near me', want: 'empty', note: 'deliberately NOT bridged' },
  { q: 'solar panels on my roof', want: 'empty', note: 'deliberately NOT bridged' },
  { q: 'is there a casino coming', want: 'empty' },
];

let pass = 0, fail = 0;
for (const c of CASES) {
  const hits = await hybridSearch(c.q, 6);
  const got = hits.length ? 'hits' : 'empty';
  const ok = got === c.want;
  if (ok) pass++;
  else fail++;
  const br = bridgeTerms(c.q);
  console.log(
    `${ok ? 'PASS' : 'FAIL'} want=${c.want.padEnd(5)} got=${String(hits.length).padStart(2)}` +
    `${br.length ? ' bridged[' + br.join(',') + ']' : ''}  "${c.q}"${c.note ? '  (' + c.note + ')' : ''}`);
  if (ok && hits.length) console.log(`        top: ${hits[0].body} — ${hits[0].plain_text.slice(0, 62)}`);
}
console.log(`\n${pass} pass, ${fail} fail`);

console.log('\n=== duplicate check: same item_number + date in one result set ===');
for (const q of ['when will my street be repaved', 'main street parklets', 'opportunity zone']) {
  const hits = await hybridSearch(q, 6);
  const seen = new Map<string, number>();
  for (const h of hits) {
    const k = `${h.body}|${h.meeting_date}|${h.item_number}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  console.log(` "${q}": ${hits.length} hits, ${dupes.length} duplicate pair(s)`);
}

console.log('\n=== topic counts after excluding the Spanish editions ===');
for (const t of TOPICS) {
  const r = await topicSearch(t.id, 12);
  console.log(`  ${t.label.padEnd(28)} ${String(r.total).padStart(3)} items, showing ${r.hits.length}`);
}
await sql.end();
