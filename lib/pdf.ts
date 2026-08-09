// Fetching + PDF text extraction. No model touches anything in this file.
// Everything here is regex-extracted or read from the PDF structure.
import { createHash } from 'node:crypto';
import { extractText, getDocumentProxy } from 'unpdf';

export const ORIGIN = 'https://www.cityofventura.ca.gov';
export const INDEX_URL = `${ORIGIN}/AgendaCenter`;
const UA = 'AgendaWatch/0.1 (civic research prototype)';

export type DocRef = {
  id: string; // "_07142026-3669"
  bodyId: number; // CivicPlus CID
  meetingDate: string; // YYYY-MM-DD, parsed from the id. NEVER from a model.
  url: string;
  title: string;
  isAmended: boolean;
  isCancelled: boolean;
  role: DocRole;
};

/**
 * What KIND of document this is, relative to the other documents for the same
 * meeting. Read from the city-given title verbatim, like isAmended/isCancelled.
 *
 *   primary      the agenda itself
 *   spanish      the separately-posted Spanish edition of the same agenda
 *   supplemental a packet of addenda published alongside the agenda
 *   amended      a revised re-post of an earlier agenda
 *
 * This exists because 17 (body, date) groups hold more than one document and they
 * are NOT all the same relationship: 10 are Spanish editions, 6 are supplemental
 * packets, 1 is a revision. Treating them alike would either drop real content or
 * present one decision as two. Never inferred from a same-day collision — a body
 * can legitimately hold two meetings in a day.
 */
export type DocRole = 'primary' | 'spanish' | 'supplemental' | 'amended';

export function roleFromTitle(title: string): DocRole {
  // Most specific first. The city writes the Spanish edition's title entirely in
  // Spanish ("24 DE MARZO DE 2026 AGENDA DEL CONCEJO MUNICIPAL").
  if (/CONCEJO MUNICIPAL/i.test(title)) return 'spanish';
  // "Supplemental Packet POSTED" is the agenda annotated to say a packet exists —
  // "June 22, 2026 Water Commission Regular Meeting Agenda - Supplemental Packet
  // Posted" is the agenda itself and carries the meeting's 5 items. A bare
  // "Supplemental Packet (06.11.2026)" is the packet. Without the lookahead this
  // demoted three real Water Commission agendas to addenda and orphaned them,
  // since they have no other sibling to attach to.
  if (/supplemental\s+packet(?!\s+posted)/i.test(title)) return 'supplemental';
  if (/\bamend/i.test(title)) return 'amended';
  return 'primary';
}

/** CivicPlus emits "Director&#39;s Hearing"; titles are shown to residents. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** "_07142026-3669" -> "2026-07-14". Returns null if the id is not the expected shape. */
export function meetingDateFromId(id: string): string | null {
  const m = /^_(\d{2})(\d{2})(\d{4})-\d+$/.exec(id);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const month = +mm;
  const day = +dd;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${yyyy}-${mm}-${dd}`;
}

export async function fetchIndex(): Promise<string> {
  try {
    const res = await fetch(INDEX_URL, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`index returned HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    throw new Error(`could not fetch ${INDEX_URL}: ${(err as Error).message}`);
  }
}

/**
 * Body association comes from the surrounding <div id="category-panel-<CID>">.
 * Splitting on that boundary is what ties each agenda link to its board.
 */
export function parseIndex(html: string): DocRef[] {
  const out: DocRef[] = [];
  const seen = new Set<string>();
  const parts = html.split(/<div id="category-panel-(\d+)"/);

  for (let i = 1; i < parts.length; i += 2) {
    const bodyId = Number(parts[i]);
    const segment = parts[i + 1] ?? '';
    const anchor =
      /<a\s[^>]*href="\/AgendaCenter\/ViewFile\/Agenda\/(_\d{8}-\d+)"[^>]*>([\s\S]*?)<\/a>/g;

    for (const m of segment.matchAll(anchor)) {
      const id = m[1];
      if (seen.has(id)) continue;
      const meetingDate = meetingDateFromId(id);
      if (!meetingDate) continue; // no date we can prove -> we do not write the row
      seen.add(id);
      const title = decodeEntities(m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
        .replace(/\*+/g, '')
        .trim();
      out.push({
        id,
        bodyId,
        meetingDate,
        // The /AgendaCenter/ prefix is REQUIRED. Without it the server returns a
        // ~105KB HTML 404 that parses like a successful response.
        url: `${ORIGIN}/AgendaCenter/ViewFile/Agenda/${id}`,
        title,
        isAmended: /amend/i.test(title),
        // The city says so in the title; we copy that, never infer it. A packet
        // with no items is not evidence of cancellation.
        isCancelled: /cancel/i.test(title),
        role: roleFromTitle(title),
      });
    }
  }
  return out;
}

export type FetchedPdf = { bytes: Uint8Array; sha256: string };

export async function fetchPdf(url: string): Promise<FetchedPdf> {
  if (!url.includes('/AgendaCenter/ViewFile/')) {
    throw new Error(`refusing to fetch ${url}: missing /AgendaCenter/ prefix`);
  }
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ctype = res.headers.get('content-type') ?? '';
    const bytes = new Uint8Array(await res.arrayBuffer());
    // An HTML body here means the 404-that-looks-like-200. Catch it explicitly.
    const isPdf =
      bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    if (!isPdf) {
      throw new Error(`not a PDF (content-type ${ctype}, ${bytes.length} bytes, no %PDF header)`);
    }
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (err) {
    throw new Error(`could not fetch ${url}: ${(err as Error).message}`);
  }
}

export type PdfText = {
  pages: string[];
  pageCount: number;
  charsPerPage: number;
  textUnavailable: boolean;
};

/** Per-page text. Page offsets are what page_start/page_end are derived from. */
export async function extractPages(bytes: Uint8Array): Promise<PdfText> {
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: false });
  const pages = (text as string[]).map((p) => p ?? '');
  const pageCount = pages.length;
  const totalChars = pages.reduce((n, p) => n + p.length, 0);
  const charsPerPage = pageCount ? Math.round(totalChars / pageCount) : 0;
  // Scanned packet: record it honestly and move on. We do not build OCR.
  return { pages, pageCount, charsPerPage, textUnavailable: charsPerPage < 300 };
}
