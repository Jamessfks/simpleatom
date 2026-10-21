-- Lockdown: the anon key can no longer read or write the table directly.
--
-- Apply ONLY after the frontend with POST /api/share is deployed AND
-- SUPABASE_SERVICE_ROLE_KEY is set in the Vercel project. From then on every
-- read and write goes through the server (lib/server/share-store.ts), which
-- validates what it stores and reads one row by id. Before this, the public
-- anon key shipped in every page could list every shared structure and insert
-- arbitrary JSON under any id.

drop policy if exists "Anyone can read shared results" on public.shared_results;
drop policy if exists "Anyone can insert shared results" on public.shared_results;

-- RLS stays enabled with no policies: anon and authenticated get nothing; the
-- service role bypasses RLS by design.
revoke all on public.shared_results from anon, authenticated;
