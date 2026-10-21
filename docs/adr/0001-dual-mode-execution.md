---
status: accepted
date: 2026-02-09
decision-makers: Zicheng Zhao
---

# 0001 — Run calculations in two modes over one shared engine

## Context and problem statement

Development needs zero configuration: `npm run dev` on a laptop with Python and mace-torch installed should just work. Production needs a hosted engine, because Vercel functions cannot run PyTorch. Two separate implementations would drift.

## Decision outcome

`MACE_API_URL` unset → the Next.js routes spawn `python3 mace-api/calculate_local.py` (local mode). Set → they forward to the hosted FastAPI app `mace-api/main.py` (remote mode). Both entrypoints are thin wrappers over **one** engine, `mace-api/calculate.py` (shared since 8482310), and both report refusals with the same JSON envelope. Since v2.2.0 both also expose the same job contract (ADR-0023).

### Consequences

* Good, because no duplicated scientific logic.
* Good, because local mode is the reference: what a developer runs is what production runs.
* Bad, because two entrypoints to keep aligned (stdout JSON vs HTTP status codes).
* Bad, because the CLI must keep stdout pure JSON; upstream prints to stdout, so stdout is redirected to stderr until the result is written.

### Confirmation

`test_scripts/test_backend_contract.py::TestCliGuards` (CLI) and the CI `docker-smoke` job (HTTP) run the same refusal cases against both entrypoints.

## More information

* app/api/calculate/route.ts
* lib/server/backend.ts
* mace-api/calculate_local.py
* 8482310
