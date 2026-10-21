# Architecture

SimpleAtom is a Next.js front end over one Python calculation engine built on
[ASE](https://wiki.fysik.dtu.dk/ase/) and [mace-torch](https://github.com/ACEsuit/mace).
This page describes v2.2.0; the decisions behind it are in [the ADRs](../adr/README.md).

```
Browser ── Next.js 16 (Vercel) ───────────────────────────────── Supabase
  │         /calculate /benchmark /docs /r/[id]                  shared_results
  │                                                                ▲
  │   POST /api/jobs ─┐   GET|DELETE /api/jobs/[id]   POST /api/share (server-only store)
  │                    │
  │          lib/server/backend.ts · lib/server/jobs.ts
  │           ├─ MACE_API_URL set ──► FastAPI on a Hugging Face Space (remote mode)
  │           │                        POST/GET/DELETE /v1/jobs · POST /calculate
  │           └─ unset ──────────────► python3 mace-api/calculate_local.py --progress (local mode)
  │                                          │
  │                                          ▼
  │                          mace-api/calculate.py  ── contract.py (contract.json)
  │                            validate → read → load (safe_load) → run → validate result
```

## One engine, two entrypoints

`mace-api/calculate.py` holds all scientific logic. `calculate_local.py` (a CLI
that prints one JSON document on stdout and `@@progress` lines on stderr) and
`main.py` (FastAPI) are thin wrappers. The Next.js routes pick a mode from
`MACE_API_URL` ([ADR-0001](../adr/0001-dual-mode-execution.md)).

## The request contract

`mace-api/contract.json` is the single source of truth for calculation types,
parameter bounds, per-deployment resource caps (`hosted`, `local`) and the
model registry ([ADR-0022](../adr/0022-shared-request-contract.md),
[reference](../reference/contract.md)). `contract.py` enforces it before any
I/O; `scripts/gen-contract.mjs` generates `lib/generated/contract.ts` for the
UI and the request mirror in `lib/contract.ts`. Shared fixtures in
`test/fixtures/contract-requests.json` are checked against both.

## A calculation, step by step

1. **Submit.** The browser posts the structure and params to `/api/jobs`.
   `lib/contract.ts` refuses an obviously bad request at once; the backend's
   `validate_request()` refuses anything else before the job is queued.
2. **Queue.** One worker thread runs one calculation at a time
   ([ADR-0023](../adr/0023-calculations-as-jobs.md)) — torch's default dtype and
   the checkpoint guard are process-global, and the Space is one CPU.
3. **Read.** The upload is stored under a server-chosen name. `.xyz` is read as
   extended XYZ so a cell survives; the first frame of a multi-frame file is
   computed ([ADR-0019](../adr/0019-periodicity-survives-parsing.md)).
4. **Load.** The registry maps `modelType`/`modelSize` to upstream's model key.
   `safe_load.trusted_checkpoints()` lets `torch.load` unpickle only files whose
   SHA-256 is pinned ([ADR-0020](../adr/0020-trusted-checkpoint-loading.md)).
5. **Run.** Single-point, BFGS optimisation, or MD (NVT Langevin with
   `fixcm=False`, NVE velocity Verlet, NPT Melchionna). Each step reports
   progress, checks for cancellation and checks the time budget; a run that
   hits the budget ends with a labelled partial result.
6. **Describe.** `_build_result()` echoes the effective params, attaches the
   provenance manifest (checkpoint hash, versions, structure hash, git commit),
   stress and pressure for periodic cells, the licence notice, and the advisory
   validator's findings ([ADR-0008](../adr/0008-self-describing-results.md),
   [0009](../adr/0009-reproducibility-manifest.md), [0010](../adr/0010-advisory-validator.md)).
7. **Poll.** The browser polls `/api/jobs/[id]` with backoff and shows the real
   phase and step; aborting cancels the job on the server.

## Units at every boundary

| Boundary | Energy | Forces | Distance | Time | Temperature | Pressure / stress |
|---|---|---|---|---|---|---|
| User input | — | — | Å | fs | K | GPa |
| ASE / MACE internal | eV | eV/Å | Å | ASE units (`units.fs`) | K | eV/Å³ |
| JSON result | eV | eV/Å | Å | `timeTaken` in s | K | GPa (`units.GPa`) |

## Sharing (MACE Link)

`POST /api/share` validates a completed result and stores it through
`lib/server/share-store.ts`; the browser holds no database client. `/r/[id]`
and `/r/[id]/embed` read one row by id on the server
([ADR-0024](../adr/0024-share-through-a-server-route.md)). Schema and policies:
[`supabase/`](https://github.com/Jamessfks/simpleatom/tree/main/supabase).

## Deployment

The front end deploys to Vercel from `main`. The backend deploys to a Hugging
Face Docker Space only from CI, after every gate passes, by mirroring the staged
backend tree and waiting for `/health` to report the commit
([ADR-0002](../adr/0002-host-backend-on-hf-spaces.md),
[0026](../adr/0026-ci-gates-every-merge.md)). See [Deploy](../how-to/deploy.md).
