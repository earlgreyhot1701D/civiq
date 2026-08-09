-- Phase B: one definition of "which items may be returned by a search".
--
--   psql "$DATABASE_URL" -f db/migrations/002-retrievable-items.sql
--
-- The Spanish edition of a City Council agenda is a translation of a document we
-- already hold, and its plain_text is ENGLISH — the rewrite prompt asked for plain
-- English and got it, from Spanish source. So it renders identically to its
-- English twin and reads as a straight duplicate: search "when will my street be
-- repaved" and Item 11 of 2026-01-27 came back twice, pages 7-7 and 8-9, with
-- nothing saying one was a translation.
--
-- Nothing is dropped. The row stays, the PDF stays, and the primary agenda now
-- links to it — "a tool that removes duplicates carelessly drops one of the pair,
-- and the one it drops is usually the Spanish one" is an observation this project
-- publishes about itself, so it cannot be the thing this project does. Excluded
-- from retrieval only because there is no Spanish interface yet to return it to.
-- When one exists, this view is where that decision changes.
--
-- 'amended' and 'supplemental' items stay retrievable: an amendment is real
-- content for a real meeting (5 items), and supplemental packets hold none at all.
create or replace view retrievable_items as
  select i.*
    from items i
    join documents d on d.id = i.document_id
   where d.role <> 'spanish';
