// Single Postgres handle. Neon over SSL.
//
// Deliberately does NOT throw at import time: the page must still render (and the
// build must still pass) when DATABASE_URL is absent. Callers check dbConfigured.
import postgres from 'postgres';

const url = process.env.DATABASE_URL;

export const dbConfigured = Boolean(url);

// Neon requires SSL; a local Postgres (docker, CI) does not offer it.
const isLocal = !!url && /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);

export const sql = postgres(url ?? 'postgres://unconfigured/unconfigured', {
  ssl: isLocal ? false : 'require',
  max: 5,
  types: {
    // A `date` column must come back as the stored "YYYY-MM-DD" string. Letting the
    // driver build a JS Date reinterprets it in the server's local zone, which
    // shifted 2026-07-14 to "Jul 13" west of UTC — a meeting date off by a day is
    // exactly the failure guardrail #1 exists to prevent.
    date: { to: 1082, from: [1082], serialize: (v: string) => v, parse: (v: string) => v },
  },
  // postgres.js connects lazily, so an unconfigured handle costs nothing until used.
  onnotice: () => {},
});

/** pgvector literal: [0.1,0.2,...] */
export const toVector = (nums: number[]) => `[${nums.join(',')}]`;

export const NO_DB =
  'DATABASE_URL is not set. Copy .env.local.example to .env.local, then apply db/schema.sql.';
