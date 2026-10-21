---
status: accepted, amended by 0027
date: 2026-09-11
decision-makers: Zicheng Zhao
---

# 0017 — Accumulate daily work on `daily`, never on auto-deploying `main`

## Context and problem statement

`main` auto-deploys to users. Daily agent rounds should pile up as one reviewable body of work.

## Decision outcome

Daily rounds commit to `daily` (tagged `daily/YYYY-MM-DD`), which merges `main` at the start of each run and is never auto-merged. The harness lives on `main`.

### Consequences

* Good, because A month of rounds is reviewable as one diff.
* Bad, because fixes made there are not live: in October 2026 D1–D3 had sat on `daily` for weeks (see ADR-0027).

### Confirmation

`python3 test_scripts/daily_gate.py --compare`.

## More information

* docs/v2/SUCCESS-CRITERIA.md §Branch strategy
