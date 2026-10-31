---
status: accepted
date: 2026-10-20
decision-makers: Zicheng Zhao
---

# 0027 — Release path: security fixes ship by PR; `daily` is adopted on a cadence

## Context and problem statement

Amends ADR-0017. Keeping daily rounds off `main` protected users from churn but also kept fixes from them: D1 (a critical cross-convention comparison), D2 and D3 sat on `daily` for weeks while production lacked them.

## Decision outcome

Security and correctness fixes go to `main` through a pull request as soon as their gates pass. `daily` keeps accumulating exploratory rounds and is adopted into `main` on a fixed cadence (at least monthly) when every gate is green on it. Releases are tagged `vX.Y.Z` with a CHANGELOG entry; `package.json` and `contract.json` carry the same version (CI checks).

### Consequences

* Good, because fixed means live within days, not weeks.
* Bad, because more PRs to review.

### Confirmation

CI `frontend` job 'Version strings agree'; `daily_gate.py --compare` shows how far `daily` is ahead of `main`.

## More information

* docs/audits/2026-10-20.md R2
* CHANGELOG.md
