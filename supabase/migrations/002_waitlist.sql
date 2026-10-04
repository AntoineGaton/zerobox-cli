-- ─────────────────────────────────────────────────────────────────────────────
-- Waitlist for ZeroBox Web (landing site form, site/app/api/waitlist).
-- Written only by the site's server route using the service role key, which
-- bypasses RLS. RLS is enabled with no policies, so anon/authenticated clients
-- can neither read nor write this table.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

create table if not exists waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text unique not null,
  created_at timestamptz default now()
);

alter table waitlist enable row level security;
