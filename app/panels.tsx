// The three explanatory panels from the hackathon front end.
//
// The observations panel there was a hand-written array. Here every row is driven
// off real corpus counts, because the hardcoded ones had already drifted: the
// README said 16 cancellations and 22 item-less documents; the database says 19
// and 28. A panel whose whole purpose is "what we actually saw" cannot be a
// literal.
//
// Guardrail #2 shapes this file. Every count is corpus-wide and never grouped by
// body — a per-agency count is a scorecard forming, whatever it is labelled. And
// nothing is phrased as the city failing; only as where we looked and when.
import type { Stats } from '@/lib/stats';
import PrintButton from './print-button';

type Obs = { kind: string; text: string; why: string };

function observations(stats: Stats, checkedAt: string | null): Obs[] {
  const out: Obs[] = [];
  const asOf = checkedAt
    ? new Date(checkedAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    : null;

  if (stats.cancelled > 0)
    out.push({
      kind: 'Cancellation',
      text: `${stats.cancelled} of the ${stats.documents} agendas we hold are posted as a notice of cancellation.`,
      why: 'A cancelled meeting still posts a document. A tool that only looks for absences will send someone to a meeting that is not happening, so these are kept as published rather than dropped.',
    });

  if (stats.amended > 0)
    out.push({
      kind: 'Revised version',
      text:
        stats.amended === 1
          ? 'One agenda is posted as a revised version of an earlier one.'
          : `${stats.amended} agendas are posted as revised versions of earlier ones.`,
      why: 'Agendas get changed. The version you read last week may not be the one that counts today, so the revision is kept rather than merged into what it replaced.',
    });

  if (stats.scans > 0)
    out.push({
      kind: 'No text layer',
      text: `Text could not be read from ${stats.scans} of these ${stats.documents} agendas. They appear to be scans.`,
      why: 'There is no OCR step here. The document is stored with its link and flagged, and nothing inside it has been guessed at.',
    });

  if (stats.itemless > 0)
    out.push({
      kind: 'No numbered items',
      text: `${stats.itemless} agendas parsed cleanly but contain no numbered items.`,
      why: 'Supplemental packets and roster-style agendas are laid out differently. They are kept with their link rather than dropped, because an empty result is not the same as an absent one.',
    });

  out.push({
    kind: 'Listed twice',
    text: 'Every agenda is linked more than once on the city’s page. Repeated links to the same document are collapsed by document id.',
    why: 'That collapse is by id only. Two links to the same document become one row; two different documents never do, however alike they look.',
  });

  // Found by reading a proof panel and discovering the city's own words were in
  // Spanish. Stated plainly, including the part we have not fixed — a panel called
  // "what we saw" cannot quietly omit the thing it saw about itself.
  if (stats.spanish > 0)
    out.push({
      kind: 'Published in two languages',
      text: `${stats.spanish} of these agendas are the Spanish edition of a City Council meeting that also has an English edition. The city posts each as its own document, with its own id and its own page numbering.`,
      why: 'Both are kept, because dropping one of a pair means dropping the Spanish one. But they are not yet linked to each other, so the same decision can appear twice in a result list with different page numbers, and the Spanish edition is currently searched using English language rules. Neither is a mistake by the city.',
    });

  if (stats.latest)
    out.push({
      kind: 'Not located',
      text:
        `No agenda dated after ${stats.latest} was located at cityofventura.ca.gov/AgendaCenter` +
        (asOf ? ` as of ${asOf}.` : '.'),
      why: 'This says where we looked and when. It does not say anyone did anything wrong.',
    });

  return out;
}

const FLOW = [
  {
    step: '1 — WE READ',
    text: 'We check the city’s agenda page and download only what has changed, matched by checksum.',
  },
  {
    step: '2 — WE SPLIT',
    text: 'A program breaks each agenda into numbered items and records the pages they sit on. Not a model — a program.',
  },
  {
    step: '3 — WE REWRITE',
    text: 'A model turns city language into plain words. That is its only job, and it never sees a date or an item number.',
  },
  {
    step: '4 — WE ANSWER',
    text: 'You ask in your words. Every answer links back to the original PDF and names its page range.',
  },
];

const RULES = [
  {
    b: 'Never invent a date.',
    t: 'Meeting dates are parsed from the document’s own URL. Item numbers and page ranges are read from the PDF’s text. If we told you Wednesday and it was Tuesday, you would lose your chance to speak and never know it was our fault.',
  },
  {
    b: 'Never grade a city body.',
    t: 'No scores, no rankings, no counts per agency, and nothing is ever called late. Adding all that up is what turns a public-records reader into a weapon against a city clerk. So we do not add it up.',
  },
  {
    b: 'Never send anything for you.',
    t: 'Email goes to residents only. There is no code path in this project that sends anything to a government office.',
  },
  {
    b: 'Never answer without proof.',
    t: 'The body, the date, the item number, the page range and a link to the original PDF, every time. A summary points at the document. It never replaces it.',
  },
];

export default function Panels({
  stats,
  checkedAt,
}: {
  stats: Stats;
  checkedAt: string | null;
}) {
  const obs = observations(stats, checkedAt);

  return (
    <>
      <section className="panel noprint">
        <h2>What we saw, without judging anyone</h2>
        <p className="sub">
          These are dated observations about the documents themselves. We never score,
          rank, or count them against a city body.
        </p>
        {obs.map((o) => (
          <div className="obs" key={o.kind}>
            <span className="kind">{o.kind}</span>
            <p className="txt">{o.text}</p>
            <p className="why">{o.why}</p>
          </div>
        ))}
      </section>

      <section className="panel noprint">
        <h2>How this works</h2>
        <p className="sub">A fixed program handles the facts. The model only rewrites the language.</p>
        <div className="flow">
          {FLOW.map((f) => (
            <div className="n" key={f.step}>
              <div className="s">{f.step}</div>
              <div className="t">{f.text}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel noprint">
        <h2>Four things this tool will never do</h2>
        <p className="sub">
          These are built into how it works. They are not promises in a footer.
        </p>
        <ul className="rules">
          {RULES.map((r) => (
            <li key={r.b}>
              <b>{r.b}</b> {r.t}
            </li>
          ))}
        </ul>
        <PrintButton />
      </section>
    </>
  );
}
