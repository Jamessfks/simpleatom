---
status: accepted
date: 2026-10-20
decision-makers: Zicheng Zhao
---

# 0022 — One request contract with bounds, shared by Python and TypeScript

## Context and problem statement

The Next.js route mirrored only `calculationType`; Python validated more; nothing bounded `mdSteps` (100,000 allowed, a frame recorded per step), atom counts, upload sizes or SMILES length. The TypeScript `ModelType` had three values to Python's four.

## Decision outcome

`contract.json` defines calculation types, finite-number bounds per parameter, per-deployment profiles (`hosted`, `local`: atom caps by calculation type, step and atom-step caps, upload limits, a time budget, trajectory float budget) and the registry. `contract.py` enforces it; `scripts/gen-contract.mjs` generates `lib/generated/contract.ts` (literal types) for the UI and the mirror in `lib/contract.ts`. Shared fixtures are checked against both. A run that hits the time budget ends with an honest, labelled partial result.

### Consequences

* Good, because A UI option the backend would refuse is a type error or a failing fixture.
* Bad, because the generated file must be regenerated after edits (CI checks freshness).

### Confirmation

`npm run check:contract`; `test/contract.test.ts` and `test_backend_contract.py::TestSharedFixtures` over `test/fixtures/contract-requests.json`.

## More information

* mace-api/contract.json
* mace-api/contract.py
* scripts/gen-contract.mjs
* lib/contract.ts
