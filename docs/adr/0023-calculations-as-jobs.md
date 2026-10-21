---
status: accepted
date: 2026-10-20
decision-makers: Zicheng Zhao
---

# 0023 — Long-running calculations are jobs: submit, real progress, cancel

## Context and problem statement

A calculation was one blocking HTTP request: the progress bar was estimated from elapsed time and capped at 95%; nothing could be cancelled; a closed tab left Python running for up to an hour; and a long run exceeded Vercel's function limit and surfaced as a non-JSON 504.

## Decision outcome

The backend accepts `POST /v1/jobs` (validated synchronously, 202 with an id), `GET /v1/jobs/{id}` (status, phase, BFGS/MD step, result) and `DELETE /v1/jobs/{id}`. One worker thread drains a bounded queue — torch's default dtype and the `torch.load` guard are process-global, and the Space is one CPU — with per-visitor limits and 15-minute expiry. Next.js `/api/jobs` proxies it in remote mode and emulates it in local mode around `calculate_local.py --progress`. The browser polls with backoff and cancels on abort. The synchronous `/calculate` remains, running through the same worker.

### Consequences

* Good, because progress is real; cancel stops the computation (a 10,000-step MD stops within ~0.1 s).
* Bad, because in-memory job state is lost if the Space restarts (polling then returns a clear 404).
* Bad, because without `MACE_API_TOKEN`, per-visitor limits trust a forwarded IP header; the global queue cap still bounds the box.

### Confirmation

In-process FastAPI checks of submit/poll/cancel/429/404 (see docs/audits/2026-10-20.md P3); browser check that Cancel kills the local Python child (`pgrep`).

## More information

* mace-api/jobs.py
* mace-api/main.py
* lib/server/jobs.ts
* lib/server/local-jobs.ts
* lib/api-client.ts
