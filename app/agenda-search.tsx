'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';
import EmailForm from './email-form';

export type Hit = {
  id: number;
  item_number: string;
  plain_text: string;
  page_start: number;
  page_end: number;
  meeting_date: string;
  url: string;
  body: string;
};

export default function AgendaSearch() {
  const { messages, sendMessage } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const [input, setInput] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [asked, setAsked] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function ask(q: string) {
    setAsked(q);
    setErr('');
    setBusy(true);
    // The receipts are the product; the chat answer is commentary on top. Send the
    // model request without awaiting it and never let it fail the search — a slow
    // or erroring model must not take the results down with it.
    try {
      sendMessage({ text: q });
    } catch {
      /* chat is best-effort */
    }
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      });
      const data = await res.json();
      setHits(data.hits ?? []);
      if (data.error) setErr(data.error);
    } catch (e) {
      setHits([]);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) {
            ask(input.trim());
            setInput('');
          }
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder="can they put a bar next to my house"
          aria-label="Ask about Ventura agendas"
        />
        <button type="submit" disabled={busy || !input.trim()}>
          {busy ? 'Reading…' : 'Ask'}
        </button>
      </form>

      {messages
        .filter((m) => m.role === 'assistant')
        .slice(-1)
        .map((m) => (
          <div key={m.id} className="answer">
            {m.parts.map((p, i) => (p.type === 'text' ? <span key={i}>{p.text}</span> : null))}
          </div>
        ))}

      {err && <p className="err">Search could not run: {err}</p>}

      {asked && !hits.length && !busy && !err && (
        <p className="none">
          Nothing matching “{asked}” was located in what has been read so far.
        </p>
      )}

      {hits.map((h) => (
        <article key={h.id} className="hit">
          <h3>
            {h.body} — {h.meeting_date}
          </h3>
          <p>{h.plain_text}</p>
          <p className="receipt">
            Item {h.item_number} · pages {h.page_start}–{h.page_end} ·{' '}
            <a href={h.url} target="_blank" rel="noopener noreferrer">
              Read the original agenda (PDF)
            </a>
          </p>
        </article>
      ))}

      {hits.length > 0 && <EmailForm query={asked} />}
    </>
  );
}
