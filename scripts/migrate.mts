// Apply a SQL migration. Exists because the README assumes psql, which is not
// present on a default Windows dev box, and because every migration in db/migrations
// is written to be idempotent so re-running one is safe.
//
//   npm run migrate db/migrations/001-document-roles.sql
//
// Migrations are applied in a transaction: a failure rolls back rather than leaving
// the schema half-changed. Prints the document-role summary afterwards, since that
// is the invariant both current migrations affect.
import { readFileSync } from 'node:fs';
import { dbConfigured, NO_DB, sql } from '../lib/db';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run migrate <path-to.sql>');
  process.exit(1);
}
if (!dbConfigured) {
  console.error(NO_DB);
  process.exit(1);
}

try {
  const text = readFileSync(file, 'utf8');
  await sql.begin((tx) => [tx.unsafe(text)]);
  console.log(`applied ${file}`);

  const roles = await sql<{ role: string; docs: number; linked: number; items: number }[]>`
    select d.role,
           count(*)::int as docs,
           count(d.relates_to)::int as linked,
           (select count(*)::int from items i
             join documents d2 on d2.id = i.document_id
            where d2.role = d.role) as items
      from documents d group by d.role order by docs desc`;
  console.table(roles);

  const [orphans] = await sql<{ n: number }[]>`
    select count(*)::int as n from documents
     where role <> 'primary' and relates_to is null`;
  console.log(
    orphans.n
      ? `note: ${orphans.n} non-primary document(s) have no primary sibling`
      : 'every non-primary document is linked to its agenda',
  );
} catch (err) {
  console.error(`migration failed (rolled back): ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
