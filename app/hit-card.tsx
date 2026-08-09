// One search result, with the proof panel ported from the hackathon front end.
//
// Disclosure state is keyed by item id, NOT by list position. The static prototype
// keyed it by index and got away with it because it re-rendered the whole page from
// scratch on every interaction; here the list reorders between a topic view and a
// search view, and an index key would leave a panel open against a different item.
// Same class of bug as keying model rewrites by item_number — see extract.ts.
import type { Hit } from '@/lib/search';

// The verbatim agenda text runs to 4000 chars in the database. The panel shows
// enough to check the rewrite against, and says when it has clipped rather than
// trailing off and letting the reader assume that is all the city wrote.
const PROOF_CHARS = 700;

export default function HitCard({
  hit,
  open,
  onToggle,
}: {
  hit: Hit;
  open: boolean;
  onToggle: () => void;
}) {
  const words = hit.raw_text ?? '';
  const clipped = words.length > PROOF_CHARS;

  return (
    <article className="item">
      <div className="status">
        <span className="when">
          {hit.body} · {hit.meeting_date}
        </span>
      </div>

      <h3>{hit.plain_text}</h3>

      <p className="receipt">
        Item {hit.item_number} · pages {hit.page_start}–{hit.page_end} ·{' '}
        <a href={hit.url} target="_blank" rel="noopener noreferrer">
          Read the original agenda (PDF)
        </a>
      </p>

      <div className="disc">
        <button type="button" onClick={onToggle} aria-expanded={open}>
          {open ? 'Hide the proof' : 'Show the proof'}
        </button>
      </div>

      {open && (
        <div className="panelbox">
          {/* The rewrite above is machine-written. This is not. Putting them in the
              same panel is the only way a reader can check one against the other. */}
          <div className="h">The city&rsquo;s own words</div>
          {words ? (
            <p className="quote">
              &ldquo;{words.slice(0, PROOF_CHARS).trim()}
              {clipped ? '…' : ''}&rdquo;
              {clipped && (
                <span className="clip"> Clipped here. The full text is in the PDF.</span>
              )}
            </p>
          ) : (
            <p className="none">
              No text was stored for this item. We will not reconstruct it.
            </p>
          )}

          <dl>
            <dt>Who decides</dt>
            <dd>{hit.body}</dd>
            <dt>Meeting date</dt>
            <dd>{hit.meeting_date}</dd>
            <dt>Item number</dt>
            <dd>{hit.item_number}</dd>
            <dt>Pages</dt>
            <dd>
              {hit.page_start}–{hit.page_end}
            </dd>
            <dt>Original document</dt>
            <dd>
              <a href={hit.url} target="_blank" rel="noopener noreferrer">
                Original agenda, PDF
              </a>
            </dd>
          </dl>

          <p className="verbatim">
            The meeting date, item number and page range are copied from the source
            document. The plain-language summary above them was written by a computer.
          </p>
        </div>
      )}
    </article>
  );
}
