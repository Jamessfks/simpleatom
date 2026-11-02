---
status: accepted
date: 2026-10-20
decision-makers: Zicheng Zhao
---

# 0026 — CI gates every merge; deploys depend on CI

## Context and problem statement

There was no CI: ~81 Python tests nothing ran, no frontend tests, and a push to `main` deployed the backend untested.

## Decision outcome

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`, `daily` and `v*` branches: frontend (contract freshness, version agreement, typecheck, lint ≤ baseline, vitest, build, production `npm audit`), python-unit (hashed lock; contract/trust/guards; optimizer and SMILES tests; staging completeness), python-models (validator, provenance, science regressions), and docker-smoke (the staged image over HTTP). The Space deploys only from `main` after all four pass. Actions are pinned by commit SHA.

### Consequences

* Good, because A regression is caught before users see it.
* Bad, because vercel deploys `main` independently; branch protection must require these checks for the gate to bind the frontend too.

### Confirmation

The CI run itself; a deliberately broken refusal turns `python-unit` red.

## More information

* .github/workflows/ci.yml
* scripts/lint-baseline.mjs
* vitest.config.ts
