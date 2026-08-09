'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, type ReactNode } from 'react';
import EmailForm from './email-form';
import HitCard from './hit-card';
import type { Hit } from '@/lib/search';

// Topics arrive as a prop rather than an import. Importing TOPICS as a value here
// pulled lib/topics.ts -> lib/db.ts -> postgres -> node:fs into the client bundle
// and broke the build outright. The type-only imports above are erased and safe;
// a value import from a module that reaches the database is not. Passing the list
// down also means the term lists never ship to the browser — they are an
// implementation detail of retrieval, and the picker only needs id and label.
export type TopicChoice = { id: string; label: string };

// Three states, not two. The prototype opened on a topic picker; the deployed app
// opened on a feed of meetings. Both exist to answer the same objection — a search
// box alone tells a resident nothing about what is even in here — so they compose
// rather than replace each other: the picker is the entry affordance, the feed is
// real content underneath it, and results replace both.
type Mode = 'browse' | 'search' | 'topic';

export default function AgendaSearch({
  bodies,
  checkedAt,
  topics,
  feed,
  panels,
}: {
  bodies: number;
  checkedAt: string | null;
  topics: TopicChoice[];
  feed: ReactNode;
  panels: ReactNode;
}) {
  const { messages, sendMessage } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('browse');
  const [asked, setAsked] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Keyed by item id — see the note at the top of hit-card.tsx.
  const [open, setOpen] = useState<Record<number, boolean>>({});

  async function run(body: object, label: string, next: Mode) {
    setAsked(label);
    setMode(next);
    setErr('');
    setOpen({});
    setBusy(true);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setHits(data.hits ?? []);
      setTotal(data.total ?? (data.hits?.length ?? 0));
      if (data.error) setErr(data.error);
    } catch (e) {
      setHits([]);
      setTotal(0);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function ask(q: string) {
    // The receipts are the product; the chat answer is commentary on top. Send the
    // model request without awaiting it and never let it fail the search — a slow
    // or erroring model must not take the results down with it.
    try {
      sendMessage({ text: q });
    } catch {
      /* chat is best-effort */
    }
    void run({ q }, q, 'search');
  }

  // A topic spends no model call. It is browsing, not a question, and there is
  // nothing for a model to answer that the ranked list does not already say.
  function pickTopic(id: string, label: string) {
    void run({ topic: id }, label, 'topic');
  }

  function reset() {
    setMode('browse');
    setAsked('');
    setHits([]);
    setTotal(0);
    setErr('');
    setInput('');
    setOpen({});
  }

  const answer = messages.filter((m) => m.role === 'assistant').slice(-1);

  return (
    <>
      <div className="searchwrap">
        <form
          className="searchbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) {
              ask(input.trim());
              setInput('');
            }
          }}
        >
          <label htmlFor="q" className="srlabel">
            Ask a question about Ventura agendas
          </label>
          <input
            id="q"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            autoComplete="off"
            // Verified against the live corpus: this phrasing reaches cosine 0.7458
            // and returns street-repair items. The prototype's example — "potholes on
            // my street" — must NOT be used here: the word "pothole" appears zero
            // times in all 141 agendas (Ventura writes "pavement rehabilitation" and
            // "slurry seal"), so it sims at 0.6482, correctly trips the dense floor,
            // and the box would invite a query that always answers "nothing found".
            // The prototype got away with it because its BRIDGE map rewrote pothole
            // -> street/repair/capital. Any placeholder here must be re-probed.
            placeholder="Ask in your own words — like “when will my street be repaved”"
          />
          <button type="submit" disabled={busy || !input.trim()}>
            {busy ? 'Reading…' : 'Search'}
          </button>
        </form>
      </div>

      <main className="wrap">
        {mode === 'browse' && (
          <div className="picker">
            <h2>What do you want to know about?</h2>
            <div className="topics">
              {topics.map((t) => (
                <button
                  type="button"
                  className="topic"
                  key={t.id}
                  onClick={() => pickTopic(t.id, t.label)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode !== 'browse' && (
          <button type="button" className="back" onClick={reset}>
            ← Start over
          </button>
        )}

        {/* Gated on search mode, not merely on having an answer. useChat owns the
            message list and reset() cannot clear it, so an ungated block kept the
            previous answer on screen after "Start over" — and showed it under topic
            results, which never made a model call to produce it. */}
        {mode === 'search' &&
          answer.map((m) => (
            <div key={m.id} className="answer">
              {m.parts.map((p, i) => (p.type === 'text' ? <span key={i}>{p.text}</span> : null))}
            </div>
          ))}

        {err && <p className="err">Search could not run: {err}</p>}

        <p className="count" aria-live="polite">
          {!busy && !err && mode !== 'browse' && hits.length > 0 && (
            <>
              {mode === 'topic' && total > hits.length
                ? `Showing the ${hits.length} closest of ${total} things about ${asked}. `
                : hits.length === 1
                  ? '1 thing matches. '
                  : `${hits.length} things match, closest first. `}
              <span className="note">
                This order is what may matter to you. It is not a score of anyone.
              </span>
            </>
          )}
        </p>

        {/* Names where we looked and when. Never "missing", never a near-miss shown
            under a label — if it were good enough to display it was good enough to rank. */}
        {mode !== 'browse' && !hits.length && !busy && !err && (
          <div className="empty">
            <strong>We did not find anything about that.</strong>
            <p>
              We found nothing about “{asked}” in the {bodies || 21} Ventura boards and
              commissions we have read
              {checkedAt
                ? `, as of ${new Date(checkedAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`
                : ''}
              .
            </p>
            <p className="note">
              This says where we looked and when. It does not say the city failed to post
              anything.
            </p>
          </div>
        )}

        {hits.map((h) => (
          <HitCard
            key={h.id}
            hit={h}
            open={Boolean(open[h.id])}
            onToggle={() => setOpen((o) => ({ ...o, [h.id]: !o[h.id] }))}
          />
        ))}

        {/* Follow works on an empty result set too — watching 21 bodies for something
            that has not happened yet is the thing a resident cannot do by hand, and the
            topic never had to exist in our corpus for it to work. */}
        {mode !== 'browse' && !busy && !err && (
          <EmailForm query={asked} hasHits={hits.length > 0} />
        )}

        {mode === 'browse' && feed}

        {panels}
      </main>
    </>
  );
}
