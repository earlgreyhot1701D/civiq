// One-shot ingest. No cron, no queue. Run it, watch it, read the runs row.
//   npx tsx scripts/ingest.mts            # all 21 bodies
//   npx tsx scripts/ingest.mts --body 25  # one body
//   npx tsx scripts/ingest.mts --body 25 --limit 1
//   npx tsx scripts/ingest.mts --dry-run  # parse only: no DB, no model, no spend
import 'dotenv/config';
import { dbConfigured, NO_DB, sql, toVector } from '../lib/db';
import { fetchIndex, parseIndex, fetchPdf, extractPages, type DocRef } from '../lib/pdf';
import { parseItems, rewriteItems } from '../lib/extract';
import { embedDocuments, embeddingsEnabled } from '../lib/embed';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const bodyFilter = arg('body') ? Number(arg('body')) : undefined;
const limit = arg('limit') ? Number(arg('limit')) : undefined;
const dryRun = process.argv.includes('--dry-run');

async function ingestDoc(doc: DocRef): Promise<{ changed: boolean; items: number }> {
  const { bytes, sha256 } = await fetchPdf(doc.url);

  if (!dryRun) {
    const [prior] = await sql<{ sha256: string }[]>`
      select sha256 from documents where id = ${doc.id}`;
    if (prior?.sha256 === sha256) return { changed: false, items: 0 };
  }

  const { pages, pageCount, charsPerPage, textUnavailable } = await extractPages(bytes);

  // Scanned packet: record the metadata and the link, say so honestly, move on.
  if (textUnavailable) {
    if (dryRun) {
      console.log(`  ${doc.id} text_unavailable (${charsPerPage} chars/page) — would skip`);
      return { changed: true, items: 0 };
    }
    await sql`
      insert into documents (id, body_id, meeting_date, url, sha256, title, is_amended, is_cancelled, page_count, text_unavailable)
      values (${doc.id}, ${doc.bodyId}, ${doc.meetingDate}, ${doc.url}, ${sha256}, ${doc.title}, ${doc.isAmended}, ${doc.isCancelled}, ${pageCount}, true)
      on conflict (id) do update set sha256 = excluded.sha256, text_unavailable = true,
        title = excluded.title, is_cancelled = excluded.is_cancelled,
        page_count = excluded.page_count, fetched_at = now()`;
    console.log(`  ${doc.id} text_unavailable (${charsPerPage} chars/page) — stored, skipped`);
    return { changed: true, items: 0 };
  }

  const parsed = parseItems(pages);

  if (dryRun) {
    const span = parsed.map((i) => `${i.itemNumber}:p${i.pageStart}-${i.pageEnd}`).join(' ');
    console.log(`  ${doc.id} ${doc.meetingDate} body ${doc.bodyId} ${pageCount}p — ${parsed.length} items  ${span}`);
    return { changed: true, items: parsed.length };
  }

  if (!parsed.length) {
    console.log(`  ${doc.id} no items matched — stored metadata only`);
  }

  // ONE Haiku call for the whole document.
  const plain = parsed.length ? await rewriteItems(parsed) : new Map<string, string>();

  // Only items the model actually rewrote get written; every row keeps a full receipt.
  const rows = parsed
    .filter((i) => plain.has(i.itemNumber))
    .map((i) => ({ ...i, plainText: plain.get(i.itemNumber)! }));

  const vectors = embeddingsEnabled() ? await embedDocuments(rows.map((r) => r.plainText)) : [];

  await sql.begin(async (tx) => {
    await tx`
      insert into documents (id, body_id, meeting_date, url, sha256, title, is_amended, is_cancelled, page_count, text_unavailable)
      values (${doc.id}, ${doc.bodyId}, ${doc.meetingDate}, ${doc.url}, ${sha256}, ${doc.title}, ${doc.isAmended}, ${doc.isCancelled}, ${pageCount}, false)
      on conflict (id) do update set sha256 = excluded.sha256, page_count = excluded.page_count,
        title = excluded.title, is_amended = excluded.is_amended,
        is_cancelled = excluded.is_cancelled, text_unavailable = false, fetched_at = now()`;
    await tx`delete from items where document_id = ${doc.id}`;
    for (let n = 0; n < rows.length; n++) {
      const r = rows[n];
      const v = vectors[n] ? toVector(vectors[n]) : null;
      await tx`
        insert into items (document_id, item_number, raw_text, plain_text, page_start, page_end, embedding)
        values (${doc.id}, ${r.itemNumber}, ${r.rawText}, ${r.plainText}, ${r.pageStart}, ${r.pageEnd}, ${v}::vector)`;
    }
  });

  console.log(`  ${doc.id} ${doc.meetingDate} body ${doc.bodyId} — ${rows.length} items, ${pageCount}p`);
  return { changed: true, items: rows.length };
}

async function main() {
  if (!dryRun && !dbConfigured) throw new Error(NO_DB);
  const run = dryRun
    ? { id: 0 }
    : (await sql<{ id: number }[]>`insert into runs default values returning id`)[0];

  const all = parseIndex(await fetchIndex());
  let docs = bodyFilter ? all.filter((d) => d.bodyId === bodyFilter) : all;
  docs = docs.sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));
  if (limit) docs = docs.slice(0, limit);

  console.log(
    `ingest${dryRun ? ' (DRY RUN — no DB, no model)' : ''}: ${docs.length} docs` +
      `${bodyFilter ? ` (body ${bodyFilter})` : ''}, ` +
      `embeddings ${embeddingsEnabled() ? 'ON' : 'OFF (lexical-only)'}`,
  );

  let changed = 0;
  let written = 0;
  const failures: string[] = [];

  for (const doc of docs) {
    try {
      const r = await ingestDoc(doc);
      if (r.changed) changed++;
      written += r.items;
    } catch (err) {
      // One bad document must not lose the whole run.
      failures.push(`${doc.id}: ${(err as Error).message}`);
      console.log(`  ${doc.id} FAILED — ${(err as Error).message}`);
    }
  }

  if (!dryRun) {
    await sql`
      update runs set finished_at = now(), docs_seen = ${docs.length},
        docs_changed = ${changed}, items_written = ${written} where id = ${run.id}`;
  }

  console.log(
    `done: ${docs.length} seen, ${changed} changed, ` +
      `${written} items ${dryRun ? 'parsed' : 'written'}, ${failures.length} failed`,
  );
  await sql.end();
  if (failures.length === docs.length && docs.length > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(`ingest failed: ${err.message}`);
  await sql.end().catch(() => {});
  process.exit(1);
});
