# Agenda Watch — 2-Hour Hackathon Handoff

**Scope:** City of Ventura only. 21 boards/commissions. Ship a deployed URL.
**Team:** 3 people, parallel tracks, vibecoded.
**Deadline:** submissions close 2:25. Demos are 3 minutes.

---

## 0. Reconnaissance already done — do not re-litigate

I probed the live site. These are measured facts, not assumptions.

| Fact | Value | Consequence |
|---|---|---|
| Portal | CivicPlus CivicEngage `/AgendaCenter` | Known product, stable HTML |
| Bodies | 21, numeric CIDs (4–43) | Full list in §3 |
| Rendering | **Server-side HTML** | **No browser, no Browserbase, no Playwright** |
| One GET yields | 282 agenda + 89 minutes links, all bodies | Entire index = 1 request |
| Mean agenda | **3.7 pages** (Council: 8–14) | Not 300. Send whole doc to model |
| Text layer | 16/16 sampled clean, 1.4–2.6k chars/page | **No OCR** |
| Scanned | 1 outlier in 17 (a 2024 doc) | Detect + skip, don't solve |
| Whole archive | **~850k tokens ≈ under $3** | Budget is a non-issue |

**URL grammar:**
```
https://www.cityofventura.ca.gov/AgendaCenter
https://www.cityofventura.ca.gov/AgendaCenter/ViewFile/Agenda/_MMDDYYYY-<docid>
```
`_07142026-3669` = July 14 2026, doc 3669. **Date is in the URL** — parse it, never ask a model for it.

⚠️ The `/AgendaCenter/` prefix is required. `ViewFile/...` alone returns a 105KB HTML 404 that looks like success. This cost me a debugging cycle; don't repeat it.

---

## 1. Non-negotiable guardrails

These are the ethical spine and they're also your closing line on stage. Four rules, all cheap.

1. **No model-generated dates, deadlines, item numbers, or page ranges.** All copied verbatim or regex-extracted. The model's *only* job is rewriting staff prose into plain English.
2. **No scores, grades, rankings, or counts per agency.** Never "posted late." Missing = `"not located at [url] as of [timestamp]"`.
3. **Nothing is ever sent to a government office.** Resend emails go to **residents only**. No send-to-city code path, not even a stub.
4. **Every result carries a receipt:** body, meeting date, item number, page range, link to source PDF.

Rules 1 and 4 are also the cheapest path — regex-extracted fields are free *and* safe.

---

## 2. What we are building (and explicitly not)

**The 3-minute demo, which defines scope:**
1. Land on site: "21 Ventura bodies. Last read at 1:47 PM."
2. Type *"can they put a bar next to my house"* → real items, real receipts, links to real PDFs.
3. Click "Email me about this" → enter address → **a real email arrives on stage.**
4. Close on the four guardrails.

Anything not serving those four beats is cut.

### CUT — do not build
- ❌ Cron / scheduling (ingest is a **one-shot local script**; UI shows real `last_ingested_at`)
- ❌ OCR · ❌ Auth · ❌ Minutes (agendas only) · ❌ Multi-language
- ❌ Amendment diffing (just flag `AMENDED` via regex — free)
- ❌ Reranking · ❌ Vector DB · ❌ Queue · ❌ Workflow engine

At ~10 docs/week a cron plus a status column would already be over-engineering; at a 2-hour deadline a scheduler is pure cost. **A timestamp in the footer demos identically to a real cron and takes 4 minutes.**

---

## 3. Stack (decided)

| Layer | Choice | Note |
|---|---|---|
| App | **Next.js (App Router) on Vercel** | one deploy, judges get a URL |
| DB | **Neon Postgres** + `pgvector` + `tsvector` | store + dense + lexical + filters in ONE query |
| PDF | **`unpdf`** | serverless-safe, no native deps |
| Rewrite model | **`claude-haiku-4-5-20251001`** | it's rewriting, not reasoning |
| Chat model | **`claude-sonnet-5`** | the demo surface |
| Email | **Resend** | free: 3k/mo |
| Embeddings | **Gemini `gemini-embedding-2`** @ 768-d | **free tier, no credit card** |

### Everything above is free or already paid for

| | Cost | Signup friction |
|---|---|---|
| Vercel Hobby | free | GitHub login |
| Neon Postgres | free tier, pgvector included | no card |
| Gemini embeddings | **free of charge** | Google account, no card |
| Resend | free, 3,000/mo | no card |
| Claude (Haiku + Sonnet) | **your $200 credits** | already have it |
| `unpdf`, `postgres`, AI SDK | free, MIT | — |

**Total out-of-pocket: $0.** Full archive ingest is ~$3 against credits you were given.

⚠️ **Anthropic has no embeddings endpoint** — Claude credits don't cover the dense half. Gemini's free tier does, which is why it's here rather than OpenAI (OpenAI's API needs a funded account; discovering that at minute 40 would cost you the demo).

✅ **Still build lexical-first.** `tsvector` needs zero API keys and works in 20 minutes. Dense is an *upgrade*, not a dependency — the RRF query in §5 degrades cleanly when `embedding IS NULL`. Ship search, then improve it.

**Anthropic provider used directly** (your credits live there, not on any gateway). Model IDs `claude-haiku-4-5-20251001` and `claude-sonnet-5` are the direct-API format and are correct as written — if a linter tries to rewrite them to dotted slugs, that's gateway formatting and will 404.

```bash
npm i ai @ai-sdk/react @ai-sdk/anthropic @ai-sdk/google unpdf resend postgres
```

**Env (`.env.local`) — one person creates, pastes in team chat within 10 min:**
```
DATABASE_URL=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
RESEND_API_KEY=
```

### The 21 bodies (CivicPlus CIDs)
```
25 City Council            19 Planning Commission     11 Design Review Committee
18 Parks & Recreation      22 Water Commission         4 Historic Preservation
36 Arts & Culture          14 Parking Advisory        15 Finance/Audit/Budget
26 Mobile Home Rent Review 34 Director's Hearing      28 Measure O Oversight
37 General Plan Advisory    9 Appointments Rec.        6 Economic Dev. Subcttee
16 Housing & Homelessness  40 Streetlighting Ad Hoc   41 Council Rules
39 Main Street Moves       42 Cttee Reviewing Standing Cttees
43 City Hall East Boiler
```
**Ingest all 21.** It costs <$3 and "we read every board in the city" is a stronger demo line than "we read three."

---

## 4. Schema — FREEZE THIS FIRST (minute 0–10)

This is the contract between all three tracks. Nobody writes code until it's applied.
Ready to run: [`db/schema.sql`](db/schema.sql)

```sql
create extension if not exists vector;

create table bodies (id int primary key, name text not null);

create table documents (
  id          text primary key,        -- "_07142026-3669"
  body_id     int references bodies(id),
  meeting_date date not null,          -- from URL. NEVER from a model.
  url         text not null,
  sha256      text not null,
  is_amended  boolean default false,
  page_count  int,
  text_unavailable boolean default false,  -- scanned-PDF honesty flag
  fetched_at  timestamptz default now()
);

create table items (
  id          bigserial primary key,
  document_id text references documents(id) on delete cascade,
  item_number text,                    -- verbatim
  raw_text    text not null,           -- verbatim  → lexical index
  plain_text  text not null,           -- Claude    → dense index
  page_start  int, page_end int,
  embedding   vector(768),
  tsv tsvector generated always as (
    to_tsvector('english', coalesce(raw_text,'') || ' ' || coalesce(plain_text,''))
  ) stored
);

create index on items using gin (tsv);
create index on items using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table alerts (
  id bigserial primary key, email text not null, query text not null,
  created_at timestamptz default now(), last_sent_at timestamptz
);

create table runs (
  id bigserial primary key, started_at timestamptz default now(),
  finished_at timestamptz, docs_seen int, docs_changed int, items_written int
);
```

`runs` powers the honest "Last read at…" footer — a demo asset *and* guardrail #2.

**Unblocking move:** immediately after applying the schema, insert ~5 fake items ([`db/seed.sql`](db/seed.sql)). Tracks B and C then never wait on Track A's ingest.

---

## 5. The hybrid RAG, concretely

Hybrid is **forced by the product**, not a flourish. Residents type *"bar next to my house."* Receipts are *"Case No. PROJ-12345," "Ordinance 2026-004."*

- Dense alone **fails on identifiers** — embeddings smear `PROJ-12345` into noise.
- Lexical alone **fails on residents** — "bar next to my house" shares zero tokens with "conditional use permit for on-site alcohol sales, ABC Type 47."

**The trick — index different text per retriever:**

| Retriever | Indexed text | Why |
|---|---|---|
| Dense (`embedding`) | `plain_text` (Claude rewrite) | matches how residents talk |
| Lexical (`tsv`) | `raw_text` + `plain_text` | preserves exact identifiers verbatim |

Most implementations index the *same string* twice. Rewriting destroys identifiers; keeping raw text on the lexical side recovers them. **That asymmetry is where hybrid actually pays.**

**One SQL statement. RRF (`k=60`) — rank-based, so no normalizing cosine against `ts_rank`** (different scales; the usual reason hybrid ends up worse than either half).

```sql
with dense as (
  select id, row_number() over (order by embedding <=> $1) as rank
  from items where embedding is not null
  order by embedding <=> $1 limit 50
),
lex as (
  select id, row_number() over (
           order by ts_rank_cd(tsv, plainto_tsquery('english', $2)) desc) as rank
  from items where tsv @@ plainto_tsquery('english', $2) limit 50
)
select i.id, i.item_number, i.plain_text, i.page_start, i.page_end,
       d.meeting_date, d.url, b.name as body,
       coalesce($4::float/(60+dn.rank), 0) + coalesce($5::float/(60+lx.rank), 0) as score
from items i
join documents d on d.id = i.document_id
join bodies    b on b.id = d.body_id
left join dense dn on dn.id = i.id
left join lex   lx on lx.id = i.id
where dn.id is not null or lx.id is not null
order by score desc limit 10;
```
Params: `$1` query embedding · `$2` raw query text · `$4` dense weight · `$5` lexical weight.
With no `GOOGLE_GENERATIVE_AI_API_KEY`, `dense` is empty and this is a clean lexical search. Ship that first.

> **🔧 One decision worth a human, not a default (Track B owner, ~8 lines):**
> A resident searches `"Ordinance 2026-004"`. Lexical ranks the exact match #1; dense ranks a *different but similar* ordinance #1. Who wins?
> Favor lexical → identifier lookups are exact, plain-language queries drown in keyword noise. Favor dense → the reverse. Third option: regex-detect identifier-shaped queries (`/\b[A-Z]{2,}[- ]?\d{3,}\b|\bordinance\b|\bAPN\b/i`) and flip weights per query.
> Defaults to start: `dense=1.0, lexical=1.0`. This single choice shapes how search *feels* more than anything else here — set it deliberately.

---

## 6. Extraction — deterministic first, model last

**Verified working:** one regex pulled **31 correctly-numbered items** from the July 14 Council agenda, cleanly separating Closed Session (1–3) from Regular (1–12).

```ts
const ITEM = /^\s*(\d{1,2}[A-Z]?)\.\s+([A-Z].{15,400}?)(?=\n\s*\d{1,2}[A-Z]?\.\s+[A-Z]|\n\s*$)/gms;
```

Pipeline per document — **the model touches step 5 only:**
1. `meeting_date` ← parse from URL. Never a model.
2. `sha256(pdf)` — unchanged → skip, spend nothing.
3. `extractText` via `unpdf`, keep per-page offsets → `page_start`/`page_end`.
4. If `chars/page < 300` → `text_unavailable = true`, store metadata + link, **move on**. (~6% of docs. Don't build OCR.)
5. Batch all items from one doc into **one Haiku call** → returns `[{item_number, plain_text}]`.
6. Embed `plain_text` (if key present). Insert.

**One call per document, not per item** — 282 calls total, not ~4,000. Biggest single cost and wall-clock lever.

### Embeddings — use asymmetric task types

`gemini-embedding-2` takes a `taskType`, and using the **matching pair** measurably beats using one mode for both. Two lines, free, real recall gain:

```ts
import { google } from '@ai-sdk/google';
import { embedMany } from 'ai';

// INGEST — items being stored
const { embeddings } = await embedMany({
  model: google.textEmbeddingModel('gemini-embedding-2'),
  values: items.map(i => i.plain_text),
  providerOptions: { google: { outputDimensionality: 768,
                               taskType: 'RETRIEVAL_DOCUMENT' } },
});

// QUERY — the resident's question. DIFFERENT taskType.
providerOptions: { google: { outputDimensionality: 768,
                             taskType: 'RETRIEVAL_QUERY' } }
```

Same asymmetry principle as §5: documents and questions are different kinds of text, so stop pretending one encoder setting serves both. 768 dims (from a 3072 default) is Matryoshka truncation — the model **auto-renormalizes**, so cosine still works and your `vector(768)` column stays small.

```
System: Rewrite each municipal agenda item in plain English for a resident
who has never read an agenda. 1-2 sentences. Say who it affects and what
would change.
NEVER output dates, deadlines, dollar amounts, or item numbers — those are
attached separately from the source. If an item is procedural, say so plainly.
Return JSON: [{ "item_number": <as given>, "plain_text": "..." }]
```
Note the prompt *forbids* the model from emitting the very fields guardrail #1 protects. Cheap defense-in-depth.

**Run ingest early and in the background** — ~90s wall-clock at concurrency 10, while Tracks B/C build.

---

## 7. AI SDK — verified against `ai@7.0.58`, not memory

These APIs **changed recently**; the old forms are what a model will reach for by default. Vibecoding will produce the deprecated version unless you paste this in.

- `useChat` **no longer manages input** → `useState` + `sendMessage({ text })`
- `api: '/api/chat'` → `transport: new DefaultChatTransport({ api })`
- `toDataStreamResponse()` → **`toUIMessageStreamResponse()`**
- `maxTokens` → `maxOutputTokens` · `parameters` → `inputSchema` · `maxSteps` → `stopWhen`

```ts
// app/api/chat/route.ts
import { anthropic } from '@ai-sdk/anthropic';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { hybridSearch } from '@/lib/search';

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const q = messages.at(-1)?.parts.find(p => p.type === 'text')?.text ?? '';
  const hits = await hybridSearch(q);

  const result = streamText({
    model: anthropic('claude-sonnet-5'),
    system:
      `Answer using ONLY the agenda items below. Every claim cites its item.\n` +
      `Never state a date or deadline that is not verbatim in the context.\n` +
      `If nothing matches, say so and name what was searched.\n\n` +
      hits.map(h =>
        `[${h.body} · ${h.meeting_date} · Item ${h.item_number} · p.${h.page_start}-${h.page_end}]\n` +
        `${h.plain_text}\nSource: ${h.url}`).join('\n\n'),
    messages: convertToModelMessages(messages),
  });
  return result.toUIMessageStreamResponse();
}
```

```tsx
// app/page.tsx
'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';

export default function Page() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const [input, setInput] = useState('');
  return (
    <form onSubmit={e => {
      e.preventDefault();
      if (input.trim()) { sendMessage({ text: input }); setInput(''); }
    }}>
      <input value={input} onChange={e => setInput(e.target.value)}
             disabled={status !== 'ready'} />
    </form>
  );
}
```

---

## 8. Resend — the closing beat

Resident saves a plain-language interest; we email matching items **with receipts**. This is the participation loop that makes it a product rather than a search box.

🚨 **Demo landmine:** on Resend's free tier without a verified domain you can send **only to your own signup address**. Verifying a domain needs DNS propagation you don't have time for.
✅ **Mitigation:** demo with the team member's own email, sending from `onboarding@resend.dev`. Works instantly, looks identical on stage. **Test this at minute 30, not minute 110.**

```ts
// lib/email.ts
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendDigest(to: string, query: string, hits: Hit[]) {
  return resend.emails.send({
    from: 'Agenda Watch <onboarding@resend.dev>',
    to,                                   // residents only — never a city address
    subject: `${hits.length} new Ventura items about "${query}"`,
    html: hits.map(h => `
      <p><strong>${h.body}</strong> — ${h.meeting_date}<br/>
      Item ${h.item_number} (p.${h.page_start}–${h.page_end})<br/>
      ${h.plain_text}<br/>
      <a href="${h.url}">Read the original agenda (PDF)</a></p>`).join('<hr/>'),
  });
}
```

Give it a **"Send it to me now"** button. Never wait on a scheduler in a live demo.

---

## 9. Three tracks — no file collisions

Ownership is by directory so nobody merges on top of anybody.

| | Owner | Files | Done when |
|---|---|---|---|
| **A · Ingest** | | `scripts/ingest.ts`, `lib/pdf.ts`, `lib/extract.ts` | 21 bodies in Postgres, `runs` row written |
| **B · Search** | | `lib/search.ts`, `app/api/chat/route.ts` | Lexical → hybrid, returns receipts |
| **C · UI + Email** | | `app/page.tsx`, `app/api/alerts/route.ts`, `lib/email.ts` | Chat renders receipts; email lands |

**Schedule (120 min):**
```
0:00–0:10  Schema applied · Neon up · env in team chat · seed rows in · repo pushed
0:10–0:15  Track A kicks off full ingest IN BACKGROUND
0:10–1:10  Three tracks in parallel
0:30       ⚠️ Track C sends one real Resend email. Do not defer this.
1:10–1:35  Integrate. Freeze features.
1:35–1:50  Deploy to Vercel. Rehearse the 3 min TWICE.
1:50–2:00  Submit. Buffer.
```
**Feature freeze at 1:35 is not a suggestion.** A deployed demo of three working things beats a localhost demo of six.

---

## 10. Demo script

> "Twenty-one boards decide things in Ventura. The agendas are public — and unreadable."
>
> *[type: "can they put a bar next to my house"]*
>
> "Plain English. And every answer carries a receipt — body, date, item number, page, link to the original PDF. We never paraphrase away the source."
>
> *[click Email me → address → send]* — *email arrives on stage*
>
> "Four rules. Dates are never written by the model — they're copied from the document, because a wrong deadline costs someone their say. We never score or rank an agency, so this can't become a tool for harassing city clerks. We never send anything to the city — a human does that. And when we can't find something we say exactly where we looked and when."

The guardrails are the strongest 20 seconds you have. **Impact is the heaviest-weighted criterion — land them.**

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Embedding provider hiccup | Ship lexical-only. Query in §5 degrades cleanly. |
| Resend free-tier restriction | Send to own address. **Verify at 0:30.** |
| Neon/pgvector setup drags | Seed rows unblock B and C immediately |
| `ivfflat` needs rows before indexing | Create the index **after** ingest, or use `hnsw` |
| Vibecoded deprecated AI SDK APIs | Paste §7 into context before generating chat code |
| Ingest overruns | Ingest CID 25/19/11 first, backfill rest in background |

## 12. Out of scope — say this if judges ask
Cron scheduling · OCR for scanned packets · amendment/supplemental diffing · minutes · multi-language · auth · cities beyond Ventura.

Portability note: the fetcher sits behind one `fetch(url) → html` seam. Ventura needs no browser. Cities on PrimeGov or newer Legistar are JS-rendered and would need one — swapping that implementation is a one-file change. **We designed the seam without buying the product.**
