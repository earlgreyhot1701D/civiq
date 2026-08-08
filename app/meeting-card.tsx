// One meeting, items expanded. Every item keeps its full receipt.
// Grouped by date and body — never a count per body, which is a scorecard forming.
import { whenLabel, type Meeting } from '@/lib/feed';

export default function MeetingCard({ m, showWhen }: { m: Meeting; showWhen: boolean }) {
  const when = showWhen ? whenLabel(m.meeting_date) : '';

  return (
    <article className="meeting">
      <header>
        <h3>
          {m.body} — {m.meeting_date}
        </h3>
        {when && <span className="when">{when}</span>}
        {m.is_cancelled && <span className="tag cancelled">Cancelled</span>}
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
    </article>
  );
}
