// Single Postgres handle. Neon over SSL.
//
// Deliberately does NOT throw at import time: the page must still render (and the
// build must still pass) when DATABASE_URL is absent. Callers check dbConfigured.
import postgres from 'postgres';

const url = process.env.DATABASE_URL;

export const dbConfigured = Boolean(url);

export const sql = postgres(url ?? 'postgres://unconfigured/unconfigured', {
  ssl: 'require',
  max: 5,
  // postgres.js connects lazily, so an unconfigured handle costs nothing until used.
  onnotice: () => {},
});

/** pgvector literal: [0.1,0.2,...] */
export const toVector = (nums: number[]) => `[${nums.join(',')}]`;

export const NO_DB =
  'DATABASE_URL is not set. Copy .env.local.example to .env.local, then apply db/schema.sql.';
