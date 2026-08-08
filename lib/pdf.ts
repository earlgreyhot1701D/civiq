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
};

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
      const title = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      out.push({
        id,
        bodyId,
        meetingDate,
        // The /AgendaCenter/ prefix is REQUIRED. Without it the server returns a
        // ~105KB HTML 404 that parses like a successful response.
        url: `${ORIGIN}/AgendaCenter/ViewFile/Agenda/${id}`,
        title,
        isAmended: /amend/i.test(title),
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
