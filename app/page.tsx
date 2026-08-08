// Server shell: the footer timestamp is read from the runs table, never hardcoded.
import AgendaSearch from './agenda-search';
import { corpusStats, lastIngestedAt } from '@/lib/stats';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [last, stats] = await Promise.all([lastIngestedAt(), corpusStats()]);

  return (
    <main>
      <div className="masthead">
        <h1>Civiq</h1>
        <p className="builders">
          Built by <span>Jesus</span>, <span>Alissa</span>, <span>Frances</span> and{' '}
          <span>La Shara</span>
        </p>
      </div>
      <p className="sub">
        {stats.bodies || 21} Ventura boards and commissions. Ask in plain language; every
        answer carries a receipt.
      </p>

      <AgendaSearch />

      <footer>
        <p>
          {last ? (
            <>
              Last read at{' '}
              <time dateTime={last}>
                {new Date(last).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}
              </time>{' '}
              — {stats.documents} agendas, {stats.items} items.
            </>
          ) : (
            <>No ingest run has completed yet, so nothing has been read into this database.</>
          )}
        </p>

        {/* What could not be read is stated plainly. Never "missing", never "late". */}
        {stats.scans > 0 && (
          <p className="caveat">
            Text could not be read from {stats.scans} of these {stats.documents} agendas.
            They appear to be scans. The originals are linked and nothing in them has been
            guessed at.
          </p>
        )}
        {stats.cancelled > 0 && (
          <p className="caveat">
            {stats.cancelled} posted a notice of cancellation. They are kept as published
            rather than dropped, because a cancelled meeting is itself a thing a resident
            may be looking for.
          </p>
        )}
        <ul>
          <li>Meeting dates, item numbers and page ranges are copied from the source — never written by a model.</li>
          <li>No scores, grades or rankings about any agency.</li>
          <li>Nothing is ever sent to a government office.</li>
          <li>Every result links to the original PDF.</li>
        </ul>
      </footer>
    </main>
  );
}
