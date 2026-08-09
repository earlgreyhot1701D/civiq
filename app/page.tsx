// Server shell: the header timestamp is read from the runs table, never hardcoded.
//
// The feed and the explanatory panels are rendered here (server) and passed into
// AgendaSearch (client) as slots, so the client owns only the decision about when
// to show them. That keeps the database queries on the server while still letting
// a search replace the feed.
import AgendaSearch from './agenda-search';
import MeetingCard from './meeting-card';
import Panels from './panels';
import { getFeed } from '@/lib/feed';
import { corpusStats, lastIngestedAt } from '@/lib/stats';
import { TOPICS } from '@/lib/topics';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [last, stats, feed] = await Promise.all([
    lastIngestedAt(),
    corpusStats(),
    getFeed(),
  ]);

  const readAt = last
    ? new Date(last).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    : null;

  const feedSlot = (
    <>
      {feed.upcoming.length > 0 && (
        <section>
          <h2>Coming up</h2>
          {feed.upcoming.map((m) => (
            <MeetingCard key={m.id} m={m} showWhen />
          ))}
        </section>
      )}

      {feed.recent.length > 0 && (
        <section>
          {/* Labelled for what it is. Past meetings are never shown as upcoming. */}
          <h2>Most recent published agendas</h2>
          {feed.recent.map((m) => (
            <MeetingCard key={m.id} m={m} showWhen={false} />
          ))}
        </section>
      )}
    </>
  );

  return (
    <>
      <header>
        <div className="wrap">
          <div className="toprow">
            <div className="brand">
              <h1>Civiq</h1>
              <span className="city">Ventura, California</span>
            </div>
            <p className="builders">
              Built by <span>Jesus</span>, <span>Alissa</span>, <span>Frances</span> and{' '}
              <span>La Shara</span>
            </p>
          </div>
          <p className="tag">
            Your city decides things in public, in documents almost nobody reads. Ask your
            question the way you would actually say it.
          </p>
          <div className="readat">
            <span className="dot" aria-hidden="true" />
            <span>
              {readAt ? (
                <>
                  We last read all {stats.bodies || 21} boards and commissions on{' '}
                  <time dateTime={last ?? undefined}>{readAt}</time>
                </>
              ) : (
                <>No ingest run has completed yet, so nothing has been read into this database.</>
              )}
            </span>
          </div>
        </div>
      </header>

      <AgendaSearch
        bodies={stats.bodies}
        checkedAt={last}
        // Only id and label cross to the client; the term lists stay on the server.
        topics={TOPICS.map(({ id, label }) => ({ id, label }))}
        feed={feedSlot}
        panels={<Panels stats={stats} checkedAt={last} />}
      />

      <footer>
        <div className="wrap">
          <p>
            <b>Civiq</b> is an independent community project. It does not work for the City
            of Ventura and does not speak for it.
          </p>
          <p>
            Everything here comes from public records at{' '}
            <a
              href="https://www.cityofventura.ca.gov/AgendaCenter"
              target="_blank"
              rel="noopener noreferrer"
            >
              cityofventura.ca.gov/AgendaCenter
            </a>
            . What the city posts is always the official version. If we disagree with the
            city, the city is right.
          </p>
          <p>
            {stats.documents} agendas, {stats.items} items, across {stats.bodies} boards and
            commissions.
          </p>
        </div>
      </footer>
    </>
  );
}
