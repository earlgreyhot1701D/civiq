// Corpus counts and the honest "last read at" timestamp.
// Split out of search.ts to keep that file under the 150-line ceiling.
import { dbConfigured, sql } from './db';

export type Stats = {
  bodies: number;
  documents: number;
  items: number;
  scans: number;
  cancelled: number;
  amended: number;
  // Documents that parsed cleanly but yielded no numbered items — supplemental
  // packets, roster-style agendas. Kept with their link rather than dropped.
  itemless: number;
  // Counts by documents.role, all read from the city-given title verbatim.
  // See roleFromTitle() in lib/pdf.ts and db/migrations/001-document-roles.sql.
  spanish: number;
  supplemental: number;
  // Non-primary documents with no primary sibling to attach to. A real state, kept
  // visible rather than papered over — it is what caught three Water Commission
  // agendas being misclassified as addenda.
  orphans: number;
  // Latest meeting date we hold, for the "nothing located after" observation.
  // Never phrased as the city failing to post; only as where we looked and when.
  latest: string | null;
};

const EMPTY: Stats = {
  bodies: 0,
  documents: 0,
  items: 0,
  scans: 0,
  cancelled: 0,
  amended: 0,
  itemless: 0,
  spanish: 0,
  supplemental: 0,
  orphans: 0,
  latest: null,
};

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
             (select count(*)::int from documents where is_cancelled)     as cancelled,
             (select count(*)::int from documents where is_amended)       as amended,
             (select count(*)::int from documents where role = 'spanish')      as spanish,
             (select count(*)::int from documents where role = 'supplemental') as supplemental,
             (select count(*)::int from documents
               where role <> 'primary' and relates_to is null) as orphans,
             (select count(*)::int from documents d
               where not exists (select 1 from items i where i.document_id = d.id)
                 and not d.text_unavailable) as itemless,
             (select max(meeting_date)::text from documents) as latest`;
    return row ?? EMPTY;
  } catch {
    return EMPTY;
  }
}
