# Civiq — Ventura

Ask about City of Ventura board and commission agendas in plain language. Every
answer carries a receipt: body, meeting date, item number, page range, and a link
to the source PDF.

**Live:** https://civiq-earlgreyhot1701ds-projects.vercel.app

Covers all 21 Ventura boards and commissions — 141 published agendas, 707 items.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Next.js App Router                          │
│                                                                     │
│  page.tsx (server)         agenda-search.tsx (client)                │
│  ├─ feed of meetings       ├─ search input + topic picker           │
│  ├─ corpus stats           ├─ hit cards with receipts               │
│  └─ panels (observations,  ├─ AI chat answer (streaming)            │
│     guardrails, how-it-    └─ email follow form                     │
│     works)                                                          │
├─────────────────────────────────────────────────────────────────────┤
│                            API Routes                                │
│                                                                     │
│  /api/search   structured receipts (hybrid or topic)                │
│  /api/chat     streaming answer grounded in search hits             │
│  /api/alerts   save interest + send digest email                    │
├─────────────────────────────────────────────────────────────────────┤
│                          Library Layer                                │
│                                                                     │
│  search.ts ─── hybrid retrieval (RRF, k=60)                        │
│    ├─ rrf.ts        SQL query builder, parameterized                │
│    ├─ lexical.ts    tsquery construction + topic search             │
│    ├─ bridge.ts     resident→city vocabulary mapping                │
│    └─ embed.ts      Gemini 768-d, asymmetric taskType               │
│                                                                     │
│  feed.ts ────── upcoming + recent meetings from documents           │
│  stats.ts ───── corpus counts for UI panels                         │
│  topics.ts ──── curated lexical filters (not queries)               │
│  email.ts ───── Resend digest, residents only                       │
│  db.ts ──────── Postgres handle, date-as-string, toVector()         │
├─────────────────────────────────────────────────────────────────────┤
│                         Ingest Pipeline                               │
│                                                                     │
│  scripts/ingest.mts                                                 │
│    1. fetch /AgendaCenter HTML ─── one GET, all 21 bodies           │
│    2. parse links ─── date from URL, role from title                │
│    3. download PDF ─── sha256 dedup, skip unchanged                 │
│    4. extract text ─── unpdf, per-page offsets                      │
│    5. segment items ── regex, deterministic                         │
│    6. rewrite ──────── one Haiku call per document                  │
│    7. embed ────────── Gemini batch, RETRIEVAL_DOCUMENT             │
│    8. store ────────── transaction per document                     │
├─────────────────────────────────────────────────────────────────────┤
│                           Data Layer                                  │
│                                                                     │
│  Neon Postgres + pgvector + tsvector                                │
│  ┌──────────┐  ┌───────────┐  ┌───────┐  ┌────────┐  ┌──────┐     │
│  │  bodies  │──│ documents │──│ items │  │ alerts │  │ runs │     │
│  └──────────┘  └───────────┘  └───────┘  └────────┘  └──────┘     │
│                 role, relates_to   embedding (768-d)                 │
│                                   tsv (generated)                    │
└─────────────────────────────────────────────────────────────────────┘
```

### How search works

Hybrid retrieval using Reciprocal Rank Fusion (RRF, k=60) over two halves:

| Half    | Indexes              | Catches                          |
|---------|----------------------|----------------------------------|
| Dense   | `plain_text` (rewrite) | resident language ("bar near me") |
| Lexical | `raw_text` + `plain_text` | identifiers ("Ordinance 2026-004") |

The asymmetry is deliberate — rewriting destroys identifiers, so lexical keeps
the raw text. Identifier-shaped queries get upweighted lexical (2.0) and
suppressed dense (0.5). A calibrated dense floor (0.677) enables an honest empty
state when nothing relevant exists in the corpus.

A vocabulary bridge (`lib/bridge.ts`) maps words residents use that never appear
in agendas (e.g. "pothole" → "pavement", "resurfacing") into the lexical half.

### Key design decisions

- **Server renders, client searches.** The feed and panels are server components;
  the search interaction is a single client component (`agenda-search.tsx`) that
  receives them as slots.
- **One model call per document, not per item.** Haiku rewrites all items in a
  single batch, keeping cost and latency proportional to documents (~141), not
  items (~707).
- **Dates never touch a model.** Meeting dates are parsed from the URL path
  (`_07142026-3669` → `2026-07-14`). Item numbers and page ranges come from the
  PDF text layer. The model only rewrites prose.
- **Document roles.** Spanish editions, supplemental packets, and revisions are
  classified from the city's own title and linked to their primary agenda rather
  than shown as duplicate meetings.

---

## Guardrails

1. **No model-generated dates, item numbers, or page ranges.** Meeting dates are
   parsed from the URL; item numbers and page ranges are read from the PDF's own
   text. The model only rewrites prose.
2. **No scores, grades, rankings, or counts per agency.** Nothing is ever called
   "late." Missing is phrased as *not located at [url] as of [timestamp]*.
3. **Nothing is ever sent to a government office.** Email goes to residents only.
   There is no send-to-city code path.
4. **Every result carries a receipt** linking to the original PDF.

Packet text is treated as untrusted data, never as instructions — stated
explicitly in the extraction prompt.

---

## Prerequisites

- Node.js ≥ 18
- A Neon Postgres database with `pgvector` enabled
- API keys (see below)

## Setup

```bash
npm install
cp .env.local.example .env.local
# Fill in the values ↓
```

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Neon Postgres connection string (`?sslmode=require`) |
| `ANTHROPIC_API_KEY` | Yes | Claude Haiku (rewrite) + Sonnet (chat) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes* | Gemini embeddings (free tier) |
| `RESEND_API_KEY` | No | Email digest — only needed if using the Follow feature |

*⚠️ `GOOGLE_GENERATIVE_AI_API_KEY` is **effectively required**. Without a working
embedding call, search runs lexical-only and the dense floor that enables the
honest empty state is bypassed. Measured with the key's quota exhausted:
`npm run golden` drops from 17/17 to 10/17 — fabricated queries return confident
results with full receipts. Treat the key as required, and see the documented
defect in `lib/search.ts`.

### Database setup

Fresh install — applies schema and inserts the 21 body definitions:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Optionally seed a few items so the UI works before ingest finishes:

```bash
psql "$DATABASE_URL" -f db/seed.sql
```

For an existing database, apply migrations in order (each is idempotent):

```bash
npm run migrate db/migrations/001-document-roles.sql
npm run migrate db/migrations/002-retrievable-items.sql
```

---

## Ingest

One-shot script. No cron, no queue — the footer shows the real `runs.finished_at`.

```bash
# Dry run: parses every PDF, no DB writes, no model calls, costs nothing
npm run ingest -- --dry-run

# Single document (smallest blast radius)
npm run ingest -- --body 25 --limit 1

# Full ingest — all 21 bodies
npm run ingest
```

Wall clock for full ingest is ~12 minutes (mostly Haiku calls + embedding batches).

---

## Development

```bash
npm run dev
```

### Available scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run ingest` | Run the ingest pipeline |
| `npm run migrate` | Apply a database migration file |
| `npm run golden` | Run the 17-query retrieval evaluation |

---

## Golden queries

Retrieval is verified against a fixed set of real and fabricated queries:

```bash
npm run golden
```

17 cases: known-good queries must return hits, fabricated ones must return the
honest empty state, and no result set may contain the same item twice. Run this
after touching anything in `lib/search.ts`, `lib/rrf.ts`, `lib/bridge.ts`, or
`lib/lexical.ts`.

---

## Deployment

Deployed on Vercel (Hobby tier). Push to `main` triggers a production deploy.

The app uses `force-dynamic` on the root page, so it is server-rendered on every
request — corpus stats and the meeting feed are always current.

---

## Project structure

```
app/
├── page.tsx              Server shell: header, feed, panels
├── agenda-search.tsx     Client: search, topics, results, chat
├── hit-card.tsx          Single search result with receipt
├── meeting-card.tsx      Feed card for upcoming/recent meetings
├── panels.tsx            Observations, how-it-works, guardrails
├── email-form.tsx        Follow/alert signup form
├── print-button.tsx      Print receipts
├── api/
│   ├── search/route.ts   Structured search (hybrid + topic)
│   ├── chat/route.ts     Streaming AI answer
│   └── alerts/route.ts   Save interest + send email
lib/
├── search.ts             Hybrid retrieval orchestration
├── rrf.ts                RRF SQL query builder
├── lexical.ts            tsquery construction + topic retrieval
├── bridge.ts             Resident→city vocabulary mapping
├── embed.ts              Gemini embedding (asymmetric taskType)
├── feed.ts               Meeting feed queries
├── stats.ts              Corpus statistics
├── topics.ts             Curated topic filters
├── db.ts                 Postgres connection
├── pdf.ts                Fetch + parse PDFs, extract text
├── extract.ts            Item segmentation + Haiku rewrite
├── email.ts              Resend digest
scripts/
├── ingest.mts            One-shot ingest pipeline
├── migrate.mts           Migration runner
├── golden.mts            Retrieval evaluation harness
db/
├── schema.sql            Full schema (drop + create)
├── seed.sql              Seed rows for development
├── migrations/
│   ├── 001-document-roles.sql
│   └── 002-retrievable-items.sql
```

---

## Measured facts about the corpus

Verified live, not assumed. Counts drift — the UI reads them from the database.

| | |
|---|---|
| Documents | 141 (282 raw links; each appears twice on the city page) |
| — by role | 124 agendas · 10 Spanish editions · 6 supplemental packets · 1 revision |
| Bodies | 21, CIDs 4–43 |
| Items parsed | 707 — of which 583 are retrievable |
| Retrievable | excludes 124 items in Spanish editions; see `db/migrations/002` |
| Scanned / no text layer | 6 → stored with link, flagged, no OCR |
| Cancellations | 19 |
| Item-less documents | 22, excluding the 6 scans |
| Meeting dates held | 2023-03-15 … 2026-08-17 |

---

## Known issues

- **Dense floor bypass when embeddings unavailable.** When the Gemini API is
  unreachable (quota, outage), the dense floor is skipped and fabricated queries
  return results. Documented in `lib/search.ts`. Not yet fixed.

---

## Out of scope

Cron scheduling · OCR · amendment diffing · minutes · auth · cities beyond Ventura.

Spanish editions are identified, linked, and honestly described. Nothing is
*authored* in Spanish — no Spanish summaries, no interface toggle.

---

## License

Private project. Not open source.
