-- Phase A: label what KIND of document each row is, and link it to the agenda it
-- belongs to. Idempotent, additive, and safe to run against the live database.
--
--   psql "$DATABASE_URL" -f db/migrations/001-document-roles.sql
--
-- Why: 17 (body, meeting_date) groups hold more than one document, and they are
-- three different relationships wearing the same shape.
--
--   10  Spanish edition of the same agenda   ("... AGENDA DEL CONCEJO MUNICIPAL")
--    6  supplemental packet of addenda       ("... Supplemental Packet (06/11/2026)")
--    1  revised re-post of an earlier agenda ("Amended Arts and Culture ...")
--
-- Before this, all three showed up as separate, unrelated meetings. The Spanish
-- edition was the worst of the three: its plain_text is ENGLISH (the rewrite
-- prompt asked for plain English and got it, from Spanish source), so it renders
-- identically to its English twin and reads as a straight duplicate.
--
-- Everything here is derived from the city-given title VERBATIM. Nothing is
-- inferred from a same-day collision — a body can legitimately meet twice in a
-- day, and this must not quietly merge two real meetings.

alter table documents add column if not exists role text not null default 'primary';
alter table documents add column if not exists relates_to text references documents(id);

alter table documents drop constraint if exists documents_role_check;
alter table documents add constraint documents_role_check
  check (role in ('primary', 'spanish', 'supplemental', 'amended'));

-- Backfill, recomputed from the title on every run. Deliberately ONE case
-- expression rather than a sequence of guarded updates: a sequence is not
-- idempotent, because a row misclassified on an earlier run no longer matches the
-- `where role = 'primary'` guard and can never be corrected by re-running. That
-- bit me — see the lookahead below. Mirrors roleFromTitle() in lib/pdf.ts; keep
-- the two in step.
--
-- "Supplemental Packet POSTED" is the agenda annotated to say a packet exists
-- ("... Water Commission Regular Meeting Agenda - Supplemental Packet Posted"),
-- and it carries the meeting's items. A bare "Supplemental Packet (06.11.2026)"
-- is the packet itself, and those hold zero items. Without the negative lookahead
-- three real Water Commission agendas were demoted to addenda and orphaned.
update documents set role =
  case
    when title ~* 'CONCEJO MUNICIPAL'                     then 'spanish'
    when title ~* 'supplemental\s+packet(?!\s+posted)'    then 'supplemental'
    when title ~* '\mamend'                               then 'amended'
    else 'primary'
  end;

-- Roles are recomputed above, so stale links must be cleared before relinking.
update documents set relates_to = null where role = 'primary' and relates_to is not null;

-- Link each non-primary document to the agenda it belongs to: same body, same
-- date, role 'primary'. Left null when there is no such sibling, which is a real
-- state and must stay visible rather than being papered over.
update documents d
   set relates_to = p.id
  from documents p
 where p.body_id      = d.body_id
   and p.meeting_date = d.meeting_date
   and p.role         = 'primary'
   and d.role        <> 'primary'
   and d.id          <> p.id;

create index if not exists documents_role_idx       on documents (role);
create index if not exists documents_relates_to_idx on documents (relates_to);

-- Guard: the UPDATE above assumes at most ONE primary per (body, date). If a body
-- ever posts two primary agendas for one day, relates_to would bind arbitrarily.
-- This raises instead of guessing.
do $$
declare n int;
begin
  select count(*) into n from (
    select body_id, meeting_date from documents
     where role = 'primary' group by 1, 2 having count(*) > 1) x;
  if n > 0 then
    raise exception 'ambiguous: % (body, date) group(s) have more than one primary '
      'document. relates_to cannot be assigned without choosing arbitrarily.', n;
  end if;
end $$;
