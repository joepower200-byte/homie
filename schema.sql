-- Homie: run this once in Supabase > SQL Editor > New query.
-- One table holds every home's shared state (devices, rooms, display theme, pairing codes).

create table if not exists public.docs (
  home       text        not null,           -- the home's private random ID (from the QR code)
  path       text        not null,           -- e.g. devices/l1, home/rooms, pairings/ab12cd34
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (home, path)
);

-- Send full rows on delete so the live feed can tell displays what went away.
alter table public.docs replica identity full;

-- Preview access: anyone who knows a home's ID can read and change it.
-- Fine for testing on your own devices. Accounts (the next phase) replace this with per-user rules.
alter table public.docs enable row level security;
drop policy if exists "preview access by home id" on public.docs;
create policy "preview access by home id" on public.docs
  for all to anon
  using (true)
  with check (char_length(home) >= 10 and char_length(path) <= 200);

-- Turn on live updates for the table (skipped if it's already on, so this file is safe to run again).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
