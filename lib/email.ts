// Resend digest. Residents only.
//
// Guardrail #3: nothing is ever sent to a government office. There is no
// send-to-city code path here, not even a stub. The only recipient is the
// address a resident typed into the form.
import { Resend } from 'resend';
import type { Hit } from './search';

// Constructed lazily: the Resend client throws on an absent key, and the build
// must not fall over just because email is unconfigured.
function client() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set, so no email can be sent.');
  return new Resend(key);
}

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export async function sendDigest(to: string, query: string, hits: Hit[]) {
  return client().emails.send({
    from: 'Agenda Watch <onboarding@resend.dev>',
    to, // residents only — never a city address
    subject: `${hits.length} Ventura items about "${query}"`,
    html:
      hits
        .map(
          (h) => `
      <p><strong>${esc(h.body)}</strong> — ${esc(h.meeting_date)}<br/>
      Item ${esc(h.item_number)} (p.${esc(h.page_start)}–${esc(h.page_end)})<br/>
      ${esc(h.plain_text)}<br/>
      <a href="${esc(h.url)}">Read the original agenda (PDF)</a></p>`,
        )
        .join('<hr/>') +
      `<p style="color:#666;font-size:12px">Every item above links to the source PDF.
       Agenda Watch never sends anything to the city on your behalf.</p>`,
  });
}
