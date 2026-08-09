-- Agenda Watch — schema. Apply this FIRST. It is the contract between all 3 tracks.
--   psql "$DATABASE_URL" -f db/schema.sql
-- Then immediately: psql "$DATABASE_URL" -f db/seed.sql   (unblocks Tracks B & C)

create extension if not exists vector;

drop table if exists items, documents, bodies, alerts, runs cascade;

create table bodies (
  id   int primary key,          -- CivicPlus CID
  name text not null
);

create table documents (
  id               text primary key,   -- "_07142026-3669"
  body_id          int references bodies(id),
  meeting_date     date not null,      -- parsed from URL. NEVER from a model.
  url              text not null,
  sha256           text not null,
  title            text,               -- verbatim link text from /AgendaCenter
  is_amended       boolean default false,
  is_cancelled     boolean default false,   -- the city said "CANCELLED" in the title;
                                            -- copied, never inferred from item count
  page_count       int,
  text_unavailable boolean default false,  -- scanned PDF; be honest, don't guess
  fetched_at       timestamptz default now(),
  -- What KIND of document this is, relative to the others for the same meeting.
  -- Read from the city-given title verbatim; see roleFromTitle() in lib/pdf.ts.
  -- 17 (body, date) groups hold 2 documents and they are NOT one relationship:
  -- 10 Spanish editions, 6 supplemental packets, 1 revision.
  role             text not null default 'primary'
                   check (role in ('primary','spanish','supplemental','amended')),
  -- The primary agenda a non-primary document belongs to. Null is a real state.
  relates_to       text references documents(id)
);

create index documents_role_idx       on documents (role);
create index documents_relates_to_idx on documents (relates_to);

create table items (
  id          bigserial primary key,
  document_id text references documents(id) on delete cascade,
  item_number text,               -- verbatim from source
  raw_text    text not null,      -- verbatim      -> lexical index
  plain_text  text not null,      -- Claude rewrite -> dense index
  page_start  int,
  page_end    int,
  embedding   vector(768),        -- gemini-embedding-2 @ outputDimensionality 768
                                  -- null until embeddings run; search degrades gracefully
  tsv tsvector generated always as (
    to_tsvector('english', coalesce(raw_text,'') || ' ' || coalesce(plain_text,''))
  ) stored
);

create index items_tsv_idx on items using gin (tsv);
-- NOTE: create the ivfflat index AFTER ingest (it needs rows to train).
-- Under time pressure just use hnsw, which does not care:
create index items_embedding_idx on items using hnsw (embedding vector_cosine_ops);

create table alerts (
  id         bigserial primary key,
  email      text not null,       -- residents ONLY. never a city address.
  query      text not null,
  created_at timestamptz default now(),
  last_sent_at timestamptz
);

create table runs (
  id           bigserial primary key,
  started_at   timestamptz default now(),
  finished_at  timestamptz,
  docs_seen    int,
  docs_changed int,
  items_written int
);

-- All 21 Ventura bodies, verified live from /AgendaCenter
insert into bodies (id, name) values
  (25, 'City Council'),
  (19, 'Planning Commission'),
  (11, 'Design Review Committee'),
  (18, 'Parks & Recreation Commission'),
  (22, 'Water Commission'),
  (4,  'Historic Preservation Committee'),
  (36, 'Arts & Culture Commission'),
  (14, 'Parking Advisory Committee'),
  (15, 'Finance, Audit & Budget Committee'),
  (26, 'Mobile Home Rent Review Board'),
  (34, 'Director''s Hearing (Administrative Hearing)'),
  (28, 'Measure O Citizens Oversight Committee'),
  (37, 'General Plan Advisory Committee'),
  (9,  'Appointments Recommendation Committee'),
  (6,  'Economic Development Subcommittee'),
  (16, 'Housing and Homelessness Subcommittee'),
  (40, 'City Council Streetlighting Ad Hoc Committee'),
  (41, 'City Council Rules Committee'),
  (39, 'Main Street Moves Ad Hoc Subcommittee'),
  (42, 'Committee Reviewing City Council Standing Committees'),
  (43, 'Council Committee Reviewing City Hall East Boiler Project')
on conflict (id) do nothing;
