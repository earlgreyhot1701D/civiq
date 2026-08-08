-- Agenda Watch — seed rows. Run AFTER schema.sql.
--   psql "$DATABASE_URL" -f db/seed.sql
--
-- Purpose: unblock Tracks B (search) and C (UI/email) so they never wait on ingest.
-- These are SYNTHETIC rows for wiring only. The url values point at the real
-- /AgendaCenter/ViewFile path shape so link rendering is exercised honestly,
-- and every row carries a full receipt (body, date, item number, page range, url).
-- Delete them before demoing:  delete from documents where id like 'SEED-%';

insert into documents (id, body_id, meeting_date, url, sha256, is_amended, page_count, text_unavailable)
values
  ('SEED-_07142026-3669', 25, '2026-07-14',
   'https://www.cityofventura.ca.gov/AgendaCenter/ViewFile/Agenda/_07142026-3669',
   'seed-not-a-real-digest-0001', false, 12, false),
  ('SEED-_08262026-3702', 19, '2026-08-26',
   'https://www.cityofventura.ca.gov/AgendaCenter/ViewFile/Agenda/_08262026-3702',
   'seed-not-a-real-digest-0002', false, 8, false),
  ('SEED-_09032026-3715', 11, '2026-09-03',
   'https://www.cityofventura.ca.gov/AgendaCenter/ViewFile/Agenda/_09032026-3715',
   'seed-not-a-real-digest-0003', false, 5, false)
on conflict (id) do nothing;

insert into items (document_id, item_number, raw_text, plain_text, page_start, page_end)
values
  ('SEED-_07142026-3669', '7C',
   'CONDITIONAL USE PERMIT PROJ-12345: Request for approval of a Conditional Use Permit to allow on-site sale and consumption of alcoholic beverages (ABC Type 47) in conjunction with a bona fide eating establishment located at 1234 Main Street, APN 073-0-123-456.',
   'A restaurant on Main Street wants permission to serve alcohol with meals. If approved, neighbors would see a new bar-and-restaurant operating at that address.',
   4, 6),

  ('SEED-_07142026-3669', '9A',
   'ORDINANCE 2026-004: An ordinance of the City Council amending Chapter 24.150 of the Municipal Code relating to short-term vacation rental permits and density limits within the Coastal Zone.',
   'The city is changing its rules for short-term vacation rentals near the coast, including how many can operate in one area. This affects homeowners who rent out their homes and the neighbors living around them.',
   7, 9),

  ('SEED-_08262026-3702', '4',
   'DESIGN REVIEW FOR A 48-UNIT MULTIFAMILY RESIDENTIAL DEVELOPMENT, Case No. PROJ-20899, located at the northeast corner of Thompson Boulevard and Ash Street, including a request for reduced parking ratios.',
   'A developer wants to build a 48-apartment building downtown with fewer parking spaces than normally required. People living nearby would see a new apartment building and more competition for street parking.',
   2, 5),

  ('SEED-_08262026-3702', '6B',
   'PUBLIC HEARING: Consideration of a Zoning Text Amendment to permit accessory dwelling units on lots under 5,000 square feet, consistent with Government Code Section 65852.2.',
   'The city is considering letting people build backyard cottages on smaller lots than the current rules allow. This affects homeowners who want to add a rental unit and the neighbors on those blocks.',
   6, 8),

  ('SEED-_09032026-3715', '2',
   'APPROVAL OF MINUTES: Approval of the regular meeting minutes of the Design Review Committee. This is a procedural item requiring no public testimony.',
   'This is a routine housekeeping step where the committee signs off on the written record of its last meeting. It does not change anything for residents.',
   1, 1)
on conflict do nothing;
