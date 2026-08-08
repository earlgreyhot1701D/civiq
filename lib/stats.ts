// Corpus counts and the honest "last read at" timestamp.
// Split out of search.ts to keep that file under the 150-line ceiling.
import { dbConfigured, sql } from './db';

export type Stats = {
  bodies: number;
  documents: number;
  items: number;
  scans: number;
  cancelled: number;
};

const EMPTY: Stats = { bodies: 0, documents: 0, items: 0, scans: 0, cancelled: 0 };

/** Real timestamp for the footer. Never a hardcoded string. */
export async function lastIngestedAt(): Promise<string | null> {
  if (!dbConfigured) return null;
  try {
    const [row] = await sql<{ finished_at: Date | null }[]>`
      select finished_at from runs where finished_at is not null
      order by finished_at desc limit 1`;
    return row?.finished_at ? row.finished_at.toISOString() : null;
  } catch {
    return null;
  }
}

/** Coverage counts, including what could NOT be read. Absence is stated, not hidden. */
export async function corpusStats(): Promise<Stats> {
  if (!dbConfigured) return EMPTY;
  try {
    const [row] = await sql<Stats[]>`
      select (select count(*)::int from bodies)    as bodies,
             (select count(*)::int from documents) as documents,
             (select count(*)::int from items)     as items,
             (select count(*)::int from documents where text_unavailable) as scans,
             (select count(*)::int from documents where is_cancelled)     as cancelled`;
    return row ?? EMPTY;
  } catch {
    return EMPTY;
  }
}
