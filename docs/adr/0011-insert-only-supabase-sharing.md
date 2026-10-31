---
status: superseded by 0024
date: 2026-02-28
decision-makers: Zicheng Zhao
---

# 0011 — Share results insert-only on Supabase (MACE Link)

## Context and problem statement

Results needed permanent, citable URLs without accounts.

## Decision outcome

The browser inserted rows into `shared_results` with the public anon key; RLS allowed anyone to select or insert, nobody to update or delete; ids were `nanoid(8)`.

### Consequences

* Good, because citation stability: a link always shows what it showed.
* Bad, because the table was world-listable and world-insertable with arbitrary JSON; an outage was indistinguishable from a missing row.

### Confirmation

—

## More information

* lib/share.ts (pre-v2.2.0)
* 7e5f7e9
