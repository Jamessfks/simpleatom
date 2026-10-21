-- Additive: size accounting and a soft-delete marker. Nothing existing changes;
-- every row already stored keeps saying exactly what it said.

alter table public.shared_results add column if not exists size_bytes integer;
alter table public.shared_results add column if not exists deleted_at timestamptz;

update public.shared_results
   set size_bytes = octet_length(result::text)
 where size_bytes is null;

create index if not exists shared_results_created_at_idx on public.shared_results (created_at);

-- Refuse oversized rows at the database too (the API caps bodies at 3 MB).
alter table public.shared_results drop constraint if exists shared_results_size_cap;
alter table public.shared_results
  add constraint shared_results_size_cap check (octet_length(result::text) <= 3145728) not valid;
