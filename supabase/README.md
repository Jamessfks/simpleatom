# MACE Link database

Schema and security for the `shared_results` table behind MACE Link
(`/r/<id>`). Decision record: [docs/adr/0024](../docs/adr/0024-share-through-a-server-route.md).

Apply in order, in the Supabase SQL editor (or `supabase db push`):

| Migration | When | Effect |
|---|---|---|
| `0001_shared_results.sql` | any time | The table and its original permissive policies, as created by hand in 2026 |
| `0002_share_metadata.sql` | any time | `size_bytes`, `deleted_at`, a created-at index, a 3 MB row cap |
| `0003_lockdown.sql` | **after** the v2.2 frontend is live **and** `SUPABASE_SERVICE_ROLE_KEY` is set on Vercel | Anon can no longer list or insert; all access goes through the server |

Order matters: applying 0003 before the server route is deployed (or before
the service-role key is set) breaks sharing, because older frontends insert
with the anon key.

The service-role key is a secret: set it in Vercel's environment variables
only. It is never `NEXT_PUBLIC_` and is read only in
`lib/server/share-store.ts`.
