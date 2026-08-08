'use client';
import { useState } from 'react';

export default function EmailForm({ query, hasHits }: { query: string; hasHits: boolean }) {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, query, sendNow: true }),
      });
      const data = await res.json();
      setMsg(
        data.error
          ? `Could not send: ${data.error}`
          : data.sent
            ? `Sent ${data.count} items to ${email}.`
            : (data.message ?? 'Saved.'),
      );
    } catch (err) {
      setMsg(`Could not send: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="email" onSubmit={submit}>
      <label htmlFor="em">
          {hasHits
            ? 'Email me about this'
            : 'Follow this — we will email you if it appears on any agenda'}
        </label>
      <div className="row">
        <input
          id="em"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <button type="submit" disabled={busy || !email}>
          {busy ? 'Sending…' : hasHits ? 'Send it to me now' : 'Follow this'}
        </button>
      </div>
      {msg && <p className="note">{msg}</p>}
      <p className="note">
        Goes only to you. Civiq never sends anything to the city on your behalf.
      </p>
    </form>
  );
}
