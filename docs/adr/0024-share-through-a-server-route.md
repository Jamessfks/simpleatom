---
status: accepted
date: 2026-10-20
decision-makers: Zicheng Zhao
---

# 0024 — MACE Link writes go through a validating server route

## Context and problem statement

Supersedes ADR-0011. The anon key shipped in every page could list every shared structure and insert arbitrary JSON under any id; a database outage rendered "result not found" with HTTP 200; and the README's showcase link was found dead in production with its database host no longer resolving.

## Decision outcome

`POST /api/share` validates what it stores (completed runs only; element symbols; one finite 3-vector per atom; bounded trajectories; 3 MB cap), requires explicit consent, chooses the id, stores the result's own params, and rate-limits per visitor. Storage is server-only (`lib/server/share-store.ts`) and prefers `SUPABASE_SERVICE_ROLE_KEY`. The schema and policies live in `supabase/migrations/`; `0003_lockdown.sql` removes anon access once the key is set. A missing row is a real 404; an outage is "sharing unavailable".

### Consequences

* Good, because no database client ships to the browser.
* Good, because what a link shows was validated when it was stored.
* Bad, because applying the lockdown requires a manual, ordered migration and a secret on Vercel.

### Confirmation

`/api/share` refusal checks (consent, status, symbols, array lengths, NaN, 3.2 MB → 413); `/r/<bad id>` → 404; `/r/<id>` with no database → 'Sharing is unavailable'.

## More information

* app/api/share/route.ts
* lib/server/share-store.ts
* supabase/migrations/
* supabase/README.md
