-- MACE Link baseline: the table exactly as it was created by hand (it was only
-- ever documented in a code comment in lib/share.ts). Safe to run on a project
-- that already has it.

create table if not exists public.shared_results (
  id          text primary key,
  result      jsonb not null,
  params      jsonb not null default '{}',
  filename    text,
  created_at  timestamptz not null default now()
);

alter table public.shared_results enable row level security;

-- The original, permissive policies: anyone may read or insert any row.
-- Superseded by 0003_lockdown.sql once SUPABASE_SERVICE_ROLE_KEY is set.
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'shared_results' and policyname = 'Anyone can read shared results') then
    create policy "Anyone can read shared results" on public.shared_results for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shared_results' and policyname = 'Anyone can insert shared results') then
    create policy "Anyone can insert shared results" on public.shared_results for insert with check (true);
  end if;
end $$;
