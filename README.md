# Civiq — Ventura

Ask about City of Ventura board and commission agendas in plain language. Every
answer carries a receipt: body, meeting date, item number, page range, and a link
to the source PDF.

**Live:** https://civiq-earlgreyhot1701ds-projects.vercel.app

This is the stable production alias — it survives redeploys, unlike the per-build
`civiq-<hash>-...` URLs. Use it for anything you hand to someone else.

Covers all 21 Ventura boards and commissions — 141 published agendas, 707 items.

## Guardrails

1. **No model-generated dates, item numbers, or page ranges.** Meeting dates are
   parsed from the URL (`_07142026-3669` → 2026-07-14); item numbers and page
   ranges are read from the PDF's own text. The model only rewrites prose.
2. **No scores, grades, rankings, or counts per agency.** Nothing is ever called
   "late." Missing is phrased as *not located at [url] as of [timestamp]*.
3. **Nothing is ever sent to a government office.** Email goes to residents only.
   There is no send-to-city code path.
4. **Every result carries a receipt** linking to the original PDF.

Packet text is treated as untrusted data, never as instructions — stated
explicitly in the extraction prompt.

## Setup

```bash
npm install
cp .env.local.example .env.local
```

`DATABASE_URL` and `ANTHROPIC_API_KEY` are required.
`GOOGLE_GENERATIVE_AI_API_KEY` is optional — without it, search runs lexical-only
and degrades cleanly. `RESEND_API_KEY` is only needed for the email digest.

Apply the schema, then the seed rows (seed rows let the UI work before ingest finishes):

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

```bash
psql "$DATABASE_URL" -f db/seed.sql
```

## Ingest

One-shot script. No cron, no queue — the footer shows the real `runs.finished_at`.

```bash
npx tsx scripts/ingest.mts --dry-run
```

Dry run parses every PDF with no database and no model calls, so it costs nothing.
Then ingest for real, smallest blast radius first:

```bash
npx tsx scripts/ingest.mts --body 25 --limit 1
```

```bash
npx tsx scripts/ingest.mts
```

## Run

```bash
npm run dev
```

## Measured facts about the corpus

Verified live, not assumed:

| | |
|---|---|
| Agenda documents | 141 (282 raw links; each appears twice) |
| Bodies | 21, CIDs 4–43 |
| Items parsed | 707, 0 failures |
| Scanned / no text layer | 6 → stored with link, flagged `text_unavailable`, no OCR |
| Item-less documents | 22 (16 cancellations, 2 supplemental packets, 4 roster-style agendas) |

⚠️ The `/AgendaCenter/` prefix is required on `ViewFile` URLs. Without it the server
returns a ~105KB HTML 404 with a 404 status; `lib/pdf.ts` additionally rejects any
response lacking a `%PDF` header.

## Out of scope

Cron scheduling · OCR · amendment diffing · minutes · multi-language · auth ·
cities beyond Ventura.
