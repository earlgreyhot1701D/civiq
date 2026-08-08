// Server shell: the footer timestamp is read from the runs table, never hardcoded.
import AgendaSearch from './agenda-search';
import { corpusStats, lastIngestedAt } from '@/lib/search';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [last, stats] = await Promise.all([lastIngestedAt(), corpusStats()]);

  return (
    <main>
      <h1>Agenda Watch</h1>
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
