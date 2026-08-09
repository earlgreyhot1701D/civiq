// One meeting, items expanded. Every item keeps its full receipt.
// Grouped by date and body — never a count per body, which is a scorecard forming.
import { whenLabel, type Meeting } from '@/lib/feed';

// What the city published alongside this agenda. Named for what it is, so a reader
// can tell a translation from an addendum from a revision — the three used to be
// indistinguishable extra meeting cards.
const RELATED_LABEL: Record<string, string> = {
  spanish: 'Esta agenda en español (PDF)',
  supplemental: 'Supplemental packet (PDF)',
  amended: 'Revised version of this agenda (PDF)',
};

export default function MeetingCard({ m, showWhen }: { m: Meeting; showWhen: boolean }) {
  const when = showWhen ? whenLabel(m.meeting_date) : '';

  return (
    <article className="meeting">
      <header>
        <h3>
          {m.body} — {m.meeting_date}
        </h3>
        {when && <span className="when">{when}</span>}
        {/* `.tag` is the header tagline now; the pill has its own class. */}
        {m.is_cancelled && <span className="tag-pill">Cancelled</span>}
      </header>

      {m.title && <p className="mtitle">{m.title}</p>}

      {m.text_unavailable && (
        <p className="caveat">
          Text could not be read from this document. It appears to be a scan. Nothing in it
          has been guessed at — the original is linked below.
        </p>
      )}

      {!m.text_unavailable && !m.items.length && !m.is_cancelled && (
        <p className="caveat">
          No numbered items were found in this document. The original is linked below.
        </p>
      )}

      <ol className="items">
        {m.items.map((it) => (
          <li key={it.id}>
            <p>{it.plain_text}</p>
            <p className="receipt">
              Item {it.item_number} · pages {it.page_start}–{it.page_end}
            </p>
          </li>
        ))}
      </ol>

      <p className="receipt">
        <a href={m.url} target="_blank" rel="noopener noreferrer">
          Read the original agenda (PDF)
        </a>
      </p>

      {/* A revision changes which version counts, so it is called out rather than
          listed as just another link. Amendment diffing is out of scope. */}
      {m.related.some((r) => r.role === 'amended') && (
        <p className="caveat">
          A revised version of this agenda is posted. The revision is the later
          document; we do not compare the two or say what changed.
        </p>
      )}

      {m.related.length > 0 && (
        <ul className="related">
          {m.related.map((r) => (
            <li key={r.id}>
              <a href={r.url} target="_blank" rel="noopener noreferrer">
                {RELATED_LABEL[r.role] ?? 'Also published for this meeting (PDF)'}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
