# HTTP API

Two layers expose the same engine. Browsers and scripts call the **Next.js
routes**; in remote mode those forward to the **backend** (FastAPI on the
Hugging Face Space). Every error, from either layer, has one shape:

```json
{ "status": "error", "message": "…", "error": { "code": "unsupported_model_size", "message": "…", "field": "modelSize" } }
```

Refusals use 4xx (400 invalid, 403 not allowed here, 413 too large, 422 over a
deployment limit, 429 busy or rate-limited); 5xx means something failed. What
counts as valid is in the [request contract](contract.md).

## Next.js routes

| Method & path | Body | Answer |
|---|---|---|
| `POST /api/jobs` | multipart: `files` (one structure), `params` (JSON object), optional `model` (local only) | `202 {jobId, status, queuePosition, progress}` |
| `GET /api/jobs/{id}` | — | `{jobId, status, progress, queuePosition, result?, error?}`; `status` ∈ queued, running, succeeded, failed, cancelled |
| `DELETE /api/jobs/{id}` | — | the job; a queued job is dropped, a running one stops at its next step |
| `POST /api/calculate` | as `/api/jobs` | the result, synchronously (bounded by the 300 s function limit) |
| `GET /api/calculate` | — | version, mode, profile, `customModels`, limits |
| `POST /api/benchmark` | JSON `{models, structureIds, calculationType}` or multipart with uploads | a `BenchmarkResult` |
| `POST /api/smiles-to-xyz` | JSON `{smiles}` | `{xyz, num_atoms, smiles_canonical, formula}` |
| `POST /api/share` | JSON `{result, filename, consent: true}` | `201 {id}` — the link is `/r/{id}` |

`progress` while running: `{phase, step, totalSteps, …}` where `phase` is
`reading-structure`, `loading-model`, `computing`, `geometry-opt` (with `fmax`,
`energy`) or `molecular-dynamics` (with `temperature`, `energy`).

Example — queue a geometry optimisation and poll it:

```bash
curl -s -F files=@public/demo/ethanol.xyz \
     -F 'params={"calculationType":"geometry-opt","modelType":"MACE-OFF","modelSize":"small"}' \
     http://localhost:3000/api/jobs
curl -s http://localhost:3000/api/jobs/<jobId>
```

## Backend (FastAPI)

| Method & path | Notes |
|---|---|
| `POST /v1/jobs`, `GET /v1/jobs/{id}`, `DELETE /v1/jobs/{id}` | The job API the Next.js routes proxy. One worker; at most one active job per visitor, 30 an hour; results kept 15 minutes. |
| `POST /calculate` | Synchronous; runs through the same worker. |
| `POST /smiles-to-xyz` | RDKit ETKDG + MMFF94. |
| `GET /capabilities` | Profile, `customModels`, limits, offered models. |
| `GET /health` | `{status, version, profile, gitCommit}` — CI waits for `gitCommit` to equal the deployed SHA. |

With `MACE_API_TOKEN` set, every endpoint except `/health`, `/capabilities` and
`/` requires the header `X-SimpleAtom-Proxy-Key`, so only the Vercel front end
can compute. The front end forwards the visitor's IP as `X-SimpleAtom-Client-IP`
for per-visitor limits.

## Result shape

`types/mace.ts` (`CalculationResult`) is the authoritative TypeScript shape.
Key fields: `energy` (eV), `forces` (eV/Å), `positions` (Å), `symbols`,
`lattice` (null if non-periodic), `properties.{volume, stress, pressure}`
(Å³, GPa; null if not fully periodic), `trajectory` (opt and MD; strided to a
budget, see `params.trajectoryStride`), `params` (what actually ran),
`warnings`, `licenseNotice`, `converged`, `stoppedEarly`, `provenance`,
`validation`, `timeTaken` (compute seconds).
