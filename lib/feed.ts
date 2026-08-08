// The homepage feed: meetings with their items already expanded.
//
// Driven from `documents`, NOT from `items`. A scanned agenda has zero item rows,
// so an items-first query would silently drop it and take the "could not read"
// honesty state with it.
import { dbConfigured, sql } from './db';

export type FeedItem = {
  id: number;
  document_id: string;
  item_number: string;
  plain_text: string;
  page_start: number;
  page_end: number;
};

export type Meeting = {
  id: string;
  meeting_date: string;
  url: string;
  title: string | null;
  is_cancelled: boolean;
  text_unavailable: boolean;
  page_count: number | null;
  body: string;
  items: FeedItem[];
};

const MEETING_COLS = sql`
  d.id, d.meeting_date, d.url, d.title, d.is_cancelled, d.text_unavailable,
  d.page_count, b.name as body`;

async function withItems(rows: Omit<Meeting, 'items'>[]): Promise<Meeting[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const items = await sql<FeedItem[]>`
    select id, document_id, item_number, plain_text, page_start, page_end
    from items where document_id = any(${ids}) order by id`;
  const byDoc = new Map<string, FeedItem[]>();
  for (const it of items) {
    const list = byDoc.get(it.document_id) ?? [];
    list.push(it);
    byDoc.set(it.document_id, list);
  }
  return rows.map((r) => ({ ...r, items: byDoc.get(r.id) ?? [] }));
}

export type Feed = { upcoming: Meeting[]; recent: Meeting[] };

/**
 * Upcoming meetings soonest-first. `recent` fills the page when the published
 * calendar is thin — a city with three meetings on the books is a real state, not
 * an error, but a near-empty homepage demos as a broken one. Both lists are
 * labelled for what they are; neither is presented as the other.
 */
export async function getFeed(limit = 25): Promise<Feed> {
  if (!dbConfigured) return { upcoming: [], recent: [] };
  try {
    const up = await sql<Omit<Meeting, 'items'>[]>`
      select ${MEETING_COLS} from documents d
      join bodies b on b.id = d.body_id
      where d.meeting_date >= current_date
      order by d.meeting_date asc limit ${limit}`;

    const need = limit - up.length;
    const back =
      need > 0
        ? await sql<Omit<Meeting, 'items'>[]>`
            select ${MEETING_COLS} from documents d
            join bodies b on b.id = d.body_id
            where d.meeting_date < current_date
            order by d.meeting_date desc limit ${need}`
        : [];

    const [upcoming, recent] = await Promise.all([withItems(up), withItems(back)]);
    return { upcoming, recent };
  } catch {
    return { upcoming: [], recent: [] };
  }
}

/**
 * Whole days from today to the meeting date. Arithmetic on a date copied from the
 * URL, so it stays inside guardrail #1. Comment deadlines get no countdown — those
 * rules are relative ("by 3:00 p.m. on the meeting date") and turning one into an
 * absolute datetime would be generation wearing a copy's clothes.
 */
export function daysUntil(meetingDate: string, today = new Date()): number {
  const [y, m, d] = meetingDate.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - now) / 86_400_000);
}

export function whenLabel(meetingDate: string, today = new Date()): string {
  const n = daysUntil(meetingDate, today);
  if (n === 0) return 'Meets today';
  if (n === 1) return 'Meets tomorrow';
  if (n > 1) return `Meets in ${n} days`;
  return '';
}
