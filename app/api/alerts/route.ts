// Save a resident's interest, and optionally send the digest immediately.
// "Send it to me now" — never wait on a scheduler during a live demo.
import { sql } from '@/lib/db';
import { hybridSearch } from '@/lib/search';
import { sendDigest } from '@/lib/email';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  try {
    const { email, query, sendNow } = (await req.json()) as {
      email?: string;
      query?: string;
      sendNow?: boolean;
    };
    const to = String(email ?? '').trim();
    const q = String(query ?? '').trim().slice(0, 200);

    if (!EMAIL.test(to)) return Response.json({ error: 'Enter a valid email address.' }, { status: 400 });
    if (!q) return Response.json({ error: 'Enter something to watch for.' }, { status: 400 });

    const [alert] = await sql<{ id: number }[]>`
      insert into alerts (email, query) values (${to}, ${q}) returning id`;

    if (!sendNow) return Response.json({ ok: true, id: alert.id, sent: false });

    const hits = await hybridSearch(q, 5);
    if (!hits.length) {
      return Response.json({
        ok: true,
        id: alert.id,
        sent: false,
        message: `Saved. Nothing matching "${q}" was located in what we have read so far.`,
      });
    }

    const { error } = await sendDigest(to, q, hits);
    if (error) return Response.json({ error: error.message }, { status: 502 });

    await sql`update alerts set last_sent_at = now() where id = ${alert.id}`;
    return Response.json({ ok: true, id: alert.id, sent: true, count: hits.length });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
