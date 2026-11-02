# Backend and API security/correctness review: v2.2.0 (`audit-next-feature`, daed8bc)

Scope: `mace-api/` (all modules, Dockerfile, requirements), every `app/api/**/route.ts`, `lib/server/*.ts`,
`next.config.ts`, `.github/workflows/*.yml`, `scripts/stage-hf-space.sh`. The review was read-only: nothing in
the repo was edited or created, and the live Space and Vercel site were not contacted. Runtime probes ran in-process
(FastAPI TestClient, plus one in-process uvicorn) with the pinned stack: fastapi 0.135.1, starlette 1.9.0,
torch 2.10.0, mace-torch 0.3.16, ase 3.27.0. Probe scripts are in the scratchpad `review/` directory
(`t_admission.py`, `t_errors.py`, `t_science.py`, `t_bfgs.py`, `t_safeload.py`, `t_disconnect.py`). Where a probe
did not need MACE, the engine was stubbed, so those results test admission and transport only.

How the findings were produced:
- The `code-review` skill ran at high effort on `mace-api/`. It returned 10 findings; all were verified here, and
  the ones that hold are folded in below.
- The `security-review` skill ran in two passes: an identification sub-agent, then a false-positive filter
  sub-agent. The identification pass found **no new HIGH or MEDIUM vulnerability at ≥0.8 confidence**. It did flag
  one pre-existing issue, which is P1 below.
- I ran the probes myself.

None of these re-report S1–S6, R1–R4, U1–U5, A1–A8 or D1–D29. Where something is a regression in one of those fixes,
the finding says so.

---

## CONFIRMED (executed)

### F1 · HIGH · Hosted benchmarks share one rate-limit key: one benchmark at a time site-wide
- **Where:** `lib/server/backend.ts:113-117` and `:165-170` (`calculateRemote` sends only `X-SimpleAtom-Proxy-Key`,
  with no `X-SimpleAtom-Client-IP`); `mace-api/main.py:137-148` (`_client_key` falls back to `X-Forwarded-For`);
  `mace-api/jobs.py:77-83` (`per_client_active=1`).
- **Regression of:** the D22/S4 per-visitor limits (ADR-0023). `/api/jobs` forwards the IP (`lib/server/jobs.ts:35-41`),
  but the synchronous path that `/api/benchmark` and `/api/calculate` use does not.
- **Evidence** (`t_admission.py` T4). Two `/calculate` calls arrive with the same `X-Forwarded-For` (the Vercel
  egress IP as seen by the Space) and no client-IP header:
  ```
  visitor A -> 200 ; visitor B -> 429 You already have a calculation queued or running. Wait for it to finish, or cancel it, before starting another.
  ```
- **Why it matters:**
  - Every hosted benchmark is a run of sequential `/calculate` calls from Vercel.
  - While any visitor's benchmark is running, every other visitor's benchmark calls come back 429. The benchmark
    route records each 429 as a per-pair "error" (`benchmark/route.ts:245-251`).
  - The 30-per-hour window is also shared by everyone (see F2).
  - The Vercel-egress part is inferred from reading the code. The admission behaviour itself was executed.
- **howToVerify:** Run `t_admission.py`, section T4. Or read `calculateRemote` and confirm it has no
  `X-SimpleAtom-Client-IP`.
- **Fix:** Pass the visitor IP into `calculate()` (`clientIp(request)` from both routes) and send
  `X-SimpleAtom-Client-IP` from `calculateRemote`. Better still, move the benchmark onto `/v1/jobs`.

### F2 · MED · The 30-per-hour limit is smaller than a single allowed hosted benchmark
- **Where:** `mace-api/jobs.py:53` (`per_client_hourly=30`) versus `contract.json` `profiles.hosted.maxBenchmarkStructures=30`,
  `maxBenchmarkUploads=5`, and up to 3 models. That allows up to 105 calls in one request.
- **Evidence** (T5). 33 sequential sync calls (11 structures × 3 models) from one key:
  ```
  33 sequential sync calls from one egress IP -> 30 x200 then [429, 429, 429]
  ```
- **Why it matters:** A benchmark the contract accepts fails partway every time. Combined with F1, it also uses up the
  shared hour for everyone.
- **howToVerify:** `t_admission.py`, section T5.
- **Fix:** Count a benchmark as one admission, or derive the hourly cap from `maxBenchmarkStructures × 3`. Also cap
  benchmark size in the contract so that `structures × models ≤ per_client_hourly`.

### F3 · MED · Per-visitor identity is client-chosen whenever the token is unset, and still trusted when it is set
- **Where:** `mace-api/main.py:137-148` and `:93-103`.
- **Evidence** (T1 and T2, hosted profile, `MACE_API_TOKEN` unset):
  ```
  no key -> 202 {'jobId': ..., 'status': 'queued'}
  same IP twice -> 202 429 rate_limited
  new spoofed IP -> 202 ; spoofed XFF -> 202
  ```
  With the token set:
  ```
  no key -> 401 ; wrong key -> 401 ; GET /v1/jobs/x no key -> 401 ; /capabilities, /health -> 200
  ```
  The comparison is constant-time (`hmac.compare_digest`, `main.py:101`).
- **Why it matters:**
  - Without the token, the hosted API is open to anyone. That is documented as "recommended" in
    `docs/reference/environment.md` and accepted in ADR-0023 ("Bad, because…").
  - Any direct caller can rotate `X-SimpleAtom-Client-IP` on every request. That defeats `per_client_active` and
    `per_client_hourly`, and one script can keep the 6-slot queue full and lock out every real visitor.
  - The docstring at `main.py:139-141` claims proxy authentication protects this, but the header is honoured even
    when no token is configured.
  - Whether production sets the token cannot be verified from here; the prior audit listed it as a user action.
- **howToVerify:** `t_admission.py`, sections T1, T1b and T2.
- **Fix:**
  - Honour `X-SimpleAtom-Client-IP` only after a valid proxy key. Otherwise key on `request.client.host` behind
    uvicorn `--proxy-headers --forwarded-allow-ips=<HF proxy>`.
  - Make `MACE_API_TOKEN` required on the hosted profile: refuse to start, or refuse compute, when it is unset.

### F4 · MED · `_submissions` grows without bound, refused requests included
- **Where:** `mace-api/jobs.py:63` (a `defaultdict(deque)`) and `:74`. The entry is created before any refusal and
  is never pruned. The module docstring (`jobs.py:13-14`) claims "memory stays flat no matter who calls".
- **Evidence** (T3):
  ```
  500 unique-key posts while queue full -> status counts {429: 500}
  _submissions entries before/after: 4 514
  ```
- **Why it matters:** Each distinct key, which F3 makes free to mint, leaves a permanent deque for the life of the
  Space. Even without spoofing, every real visitor IP stays until restart.
- **howToVerify:** `t_admission.py`, section T3.
- **Fix:**
  - Use `self._submissions.get(client)` and create the entry only when appending.
  - Delete windows that are empty after trimming.
  - Prune all stale windows inside `_reap_locked`, or use a bounded LRU.

### F5 · MED · Synchronous `/calculate` ignores client disconnects; orphaned jobs hold the worker and the client's slot
- **Where:** `mace-api/main.py:264-269`. There is no `request.is_disconnected()` check, and the job is not cancelled
  when the waiter goes away.
- **Evidence** (`t_disconnect.py`, a real uvicorn server):
  ```
  client gave up after 1 s (like Vercel's fetch timeout / a closed tab)
  0.5 s after disconnect: job status = running cancel_requested = False
  immediate retry from same key -> 429 rate_limited
  orphan finished as: succeeded (result discarded; nobody can fetch it via /calculate)
  ```
- **Why it matters:**
  - `/api/calculate` aborts its fetch at 290 s (`maxDuration − 10`) and the benchmark aborts at its remaining
    budget, but the backend waits up to 360 s.
  - A closed tab, or Vercel giving up, leaves the single CPU busy for up to 240 s and more. Under F1, that also
    blocks every other benchmark user.
- **howToVerify:** `t_disconnect.py`.
- **Fix:** Wait in a loop of about 1 s. On `await request.is_disconnected()`, call `JOBS.cancel(job.id)`.
  Alternatively, retire sync `/calculate` in favour of `/v1/jobs` for the benchmark too.

### F6 · LOW · The sync `/calculate` wait counts queue time; a job that never started is cancelled with 504
- **Where:** `mace-api/main.py:265-269`. The wait is `timeBudgetSeconds + 120`, measured from submission, while
  `run_calculation`'s budget starts only when the job starts running.
- **Evidence** (E5). The budget was shrunk so that the wait is 3 s, and another visitor's job occupied the worker:
  ```
  sync call -> 504 after 3.0s; its job: status=cancelled started=None
  ```
- **Why it matters:** With jobs queued ahead, valid calculations are cancelled before they ever run, and the caller
  is told "did not finish in time".
- **howToVerify:** `t_errors.py`, section E5.
- **Fix:** Wait for `job.started` first (bounded by queue depth), then for the run's budget plus a margin. Or return
  503/429 and let the caller retry.

### F7 · MED · Geometry opt is labelled "DID NOT CONVERGE … still above fmax" when it did converge
- **Where:** `mace-api/calculate.py:1103-1126` and the `else` message at about `:1148`. ASE 3.27 calls observers
  before its convergence check, so `_StopEarly` from `on_step` can fire on the very step that converges, or at
  step 0 when model loading or a cold MACE-OFF download used up the budget. The deadline is set at
  `calculate.py:827-829`, before the model loads.
- **Evidence** (`t_bfgs.py`, ASE EMT, no model):
  ```
  reference: converged True in 3 steps, finalFmax 0.0378
  deadline hit at step K: converged = False | finalFmax = 0.0378 <= fmax 0.05: True
    message: Geometry optimization DID NOT CONVERGE ... with max force 0.0378 eV/Å, still above the fmax target of 0.05 eV/Å. The reported geometry is NOT a relaxed minimum ...
  deadline passed before step 0, input already relaxed: converged = False | finalFmax = 0.0096 | stoppedEarly = {'reason': 'time-budget', 'atStep': 0, ...}
  ```
- **Why it matters:**
  - CLAUDE.md's BFGS rule makes the convergence verdict load-bearing.
  - The message contradicts itself (0.0378 described as "above" 0.05), and that message survives into PDFs and
    MACE Links.
  - The frequency is low, but the step-0 case is reachable on a cold Space.
- **howToVerify:** `t_bfgs.py`.
- **Fix:** On the `_StopEarly` path, set `converged = final_fmax <= fmax`. Only if it is still false, say "stopped
  by the time budget". Consider starting the deadline after `loading-model`.

### F8 · MED · MACE-OFF element coverage is not checked before loading; the user gets an opaque error and inconsistent status
- **Where:** `mace-api/calculate.py:846-850` (only atom caps are checked) and `:905-906`. The model registry has
  `models[].elements` for MACE-OFF (10 elements), but the backend never reads it. `jobs.py:168-172` maps an uncoded
  `ValueError` to 500; `calculate_local.py:121-126` maps every `ValueError` to 400 `invalid_request`.
- **Evidence** (`t_science.py` D3, real MACE-OFF small on rock-salt NaCl):
  ```
  ValueError (ValueError subclass: True) code=None: np.int64(11) is not in list
  ```
- **Why it matters:**
  - ADR-0004 says to refuse unsupported requests before work. Here the checkpoint is loaded first.
  - The hosted job fails as `500 calculation_failed` with an internal message; local mode calls the same failure
    400. Benchmark users only get an element hint from a regex on the message (`benchmark/route.ts:247`), and this
    message does not match it.
- **howToVerify:** `t_science.py`, section D3.
- **Fix:** After `_read_structure`, compare `set(atoms.get_chemical_symbols())` with `model["elements"]` when that
  list is non-empty. Raise `ContractError(code="unsupported_element", field="structure", status=422)`. Narrow
  `calculate_local.py`'s 400 mapping to `ContractError` and `UntrustedCheckpointError`.

### F9 · LOW · `device: "cuda"` silently runs on CPU, with no warning (confirms the suspected gap)
- **Where:** `mace-api/calculate.py:374-384` (`resolve_device`), echoed at `:946`. The hosted profile also accepts
  `cuda` at all (`contract.json` `devices`).
- **Evidence** (`t_science.py` D1, on a host where `torch.cuda.is_available()` is False):
  ```
  params.device: cpu | warnings: None
  ```
- **Why it matters:** The effective value differs from the requested one with no `result.warnings` entry (ADR-0004
  and ADR-0008, and CLAUDE.md pitfall 5 asks for graceful fallback). This is the only effective≠requested gap I
  found without a warning. Precision, dispersion, custom-model replacement and MD seed are all warned or echoed.
- **howToVerify:** `t_science.py`, section D1.
- **Fix:** Return a `(device, fell_back)` pair from `resolve_device`, then append "Requested device 'cuda' is not
  available here; ran on CPU." Optionally refuse `cuda` on the hosted profile.

### F10 · LOW · MACE-MP geometry-opt defaults to float64 without a warning (CLAUDE.md rule conflicts with ADR-0005)
- **Where:** `mace-api/calculate.py:164-192` (`upstream_default_precision`) and `:905-906`.
- **Evidence** (`t_science.py` D2, real MPA-0 geometry-opt with no precision requested):
  ```
  params.precision: float64 | upstream mace_mp default: float32
  warnings: []
  ```
- **Why it matters:** ADR-0005 makes float64 the intended default, following upstream's printed recommendation. But
  the binding CLAUDE.md rule says "never override either without recording the override in `result["params"]`
  **and** `result["warnings"]`". The precision is recorded in params only.
- **Fix:** Add an informational warning ("mace_mp() defaults to float32; float64 used for geometry optimisation per
  upstream's recommendation"), or amend the CLAUDE.md rule to exempt ADR-0005's documented default.

### F11 · LOW · Malformed numbers produce an unhandled 500, not a 400
- **Where:**
  - `mace-api/calculate.py:121-124`: `int(inf)` raises `OverflowError`, which is not caught.
  - `mace-api/contract.py:257-261`: `float(<huge int>)` raises `OverflowError`.
  - `mace-api/main.py:158-161`: only `json.JSONDecodeError` is caught, but Python's 4300-digit limit raises a plain
    `ValueError`.
- **Evidence** (E1):
  ```
  seed Infinity -> 500 Internal Server Error
  seed NaN -> 400 ... invalid_number
  mdSteps 400-digit int -> 500 Internal Server Error
  params 5000-digit int -> 500 Internal Server Error
  ```
- **Why it matters:** These are refusals reported as server faults (the same class as D4). Only direct backend
  callers can reach them, because the Next proxy's `JSON.parse` rejects `Infinity` and turns huge ints into
  Infinity, which it then refuses. No details leak; the body is a generic "Internal Server Error".
- **Fix:** Catch `(TypeError, ValueError, OverflowError)` in `resolve_seed` and `resolve_number`. Catch `ValueError`
  around `json.loads` in `_intake`.

### F12 · LOW · Python and TS contract drift on `seed` and whitespace handling
- **Where:** `mace-api/calculate.py:114-133` versus `lib/contract.ts:114-133`.
- **Evidence** (E1):
  ```
  seed 3.7 (float) -> 202 (queued)
  ```
  The backend accepts 3.7 and `int()` truncates it to 3. TS refuses it as "expected a whole number". From reading:
  - `seed: "1e3"`: TS accepts (1000); Python refuses.
  - `seed: " "`: TS treats it as 0; Python uses the default 42.
  - Python strips `precision`, `device` and `modelSize`; TS compares them exactly.
- **Why it matters:** This is silent coercion at the security boundary. ADR-0022 says the backend should be the
  stricter side. The effective seed is recorded, so it is reproducible, but it is not what was asked for.
- **Fix:** Route the seed through `contract.resolve_number(params, "seed")`, which already rejects non-integers, and
  add the cases to `test/fixtures/contract-requests.json`.

### F13 · MED · Upload caps run only after the whole body has been received and spooled, even for unauthenticated callers
- **Where:** `mace-api/main.py:121-134`, `:209-217` and `:249-257`. Starlette parses the multipart body into
  `UploadFile`s before the handler runs, so `_save_capped` and `_require_proxy_key` both run afterwards. Uvicorn
  sets no body limit.
- **Evidence** (E4):
  ```
  30 MB upload -> 413 upload_too_large; bytes already received when handler ran: 30000000
  token set, NO key, 30 MB upload -> 401; bytes parsed+spooled before the 401: {'files': 30000000}
  ```
- **Why it matters:** The 2 MB hosted cap and the proxy key do not bound what an anonymous caller can make the Space
  read and write to its temp disk. Any limit at the HF proxy is unknown. DoS-class, so the security skill excludes
  it, but it is a real gap in "size limits enforced before reading".
- **Fix:** Add ASGI middleware that rejects requests with a missing or invalid proxy key, or with
  `Content-Length > maxUploadBytes + slack`, before the body is read. It should also count streamed bytes for
  chunked requests.

### F14 · LOW · Deployed manifests report `code.gitDirty: null` with no note (regression in the D3 fix)
- **Where:** `mace-api/provenance.py:382-385`: the pinned-commit fallback resets `unavailableReason=None`.
  `build_manifest` (`:475-480`) only adds a note when `commit is None`.
- **Evidence** (a copy of provenance/contract outside any git checkout, with a `GIT_COMMIT` file):
  ```
  git_info: {'commit': 'daed8bc…', 'dirty': None, 'unavailableReason': None}
  code: {'gitCommit': 'daed8bc…', 'gitDirty': None}
  notes mentioning git: []
  ```
- **Why it matters:** It breaks the module's own rule that a null needs a matching note, on every hosted result. The
  `capture_checkpoint_loads` docstring (about `:202`) still describes the removed global shim and the event-loop
  execution (read-only).
- **Fix:** In the fallback, set `unavailableReason="git dirty state cannot be checked in the deployed image (commit
  from GIT_COMMIT written at deploy time)"`, and add a note whenever `dirty is None`.

### F15 · LOW · Cancelling during a step-less phase is not honoured; the job later reports "succeeded"
- **Where:** `mace-api/jobs.py:136-145` and `:158-162`; `calculate.py:1079-1083` (a single-point has no `tick`).
- **Evidence** (`t_disconnect.py`, second part):
  ```
  DELETE answered status: running
  after the pass ends: status = succeeded | result present: True
  ```
- **Fix:** In `_work`, check `job.cancel_requested` after `run()` returns and finish as `cancelled`. Also add a
  `hooks.phase()` check after the model loads, which already exists, and after the forward pass.

### F16 · LOW · `import mace` leaves `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` set for the whole process (defence in depth)
- **Where:** `mace/__init__.py:5` and `mace/calculators/mace.py:15` (upstream). `safe_load.py:27-32` documents it.
- **Evidence** (`t_safeload.py`, benign payload that calls `print`):
  ```
  TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD = 1
  inside guard: untrusted .model refused (UntrustedCheckpointError); .pt refused (UnpicklingError) even with explicit weights_only=False; file object refused
  outside the guard, after `import mace`:  >>> PAYLOAD EXECUTED <<<  plain torch.load(.pt) ... loaded
  ```
- **Why it matters:** No user-reachable `torch.load` exists outside the guard today. Every mace call site
  (`mace/calculators/mace.py:226`, `foundations_models.py:297…567`) resolves `torch.load` at call time, so the guard
  catches it. But any future code path or library that calls `torch.load` without `weights_only` will unpickle.
- **Fix:** After the first `import mace` (in calculate.py's loader functions), run
  `os.environ.pop("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", None)`. The guard passes `weights_only` explicitly, so nothing
  breaks.

---

## PLAUSIBLE (read-only, or only partly executed)

### P1 · HIGH (pre-existing, not a regression) · Local mode: a LAN peer or a visited website can run code on the developer's machine
- **Where:**
  - `contract.json` `profiles.local.customModels: true`
  - `lib/contract.ts:88-92` (no `MACE_API_URL` means `local`)
  - `lib/server/jobs.ts:93-97` and `lib/server/backend.ts:279-283` (the upload becomes `--model-path`)
  - `calculate.py:867-878` (`trusted_paths=(model_path,)`) and `safe_load.py:86-88`
  - `package.json` `"dev": "next dev"` (no `-H`)
- **Executed:**
  - `calculate_local.py <xyz> {} --model-path evil.model` under the default local profile, with a benign pickle:
    `stderr has payload marker: True`.
  - Next 16.4.2's dev cross-site guard is out of scope here: `node_modules/next/dist/server/lib/router-utils/block-cross-site-dev.js`
    applies only to `/_next` and `/__nextjs` (`if (!isInternalEndpoint(req)) return false`).
  - `start-server.js` binds every interface when no hostname is given.
  - No route checks `Origin`.
- **Not executed:** the browser or LAN delivery leg. A multipart POST is a CORS "simple request", so there is no
  preflight. Chrome's Local Network Access prompt may block the cross-site variant; a LAN peer is not affected by it.
- **Why it matters:** ADR-0020 keeps custom models in local mode on the premise "your own machine with your own
  file". The dev server breaks that premise for anyone who shares its network, for example campus Wi-Fi. It existed
  on `main` through `/api/calculate`; v2.2 adds `/api/jobs`.
- **howToVerify:** Run `npm run dev` with no `MACE_API_URL`. From another host, POST `files=@h2.xyz`,
  `params={}`, `model=@benign.model` to `http://<dev-ip>:3000/api/jobs`, then check the dev-server stderr for the
  payload marker.
- **Fix (any of these):**
  - Default `customModels` to false in every profile and require `ALLOW_CUSTOM_MODELS=1`.
  - Refuse `model` uploads unless `Host` and `Origin` are loopback.
  - Make `"dev": "next dev -H 127.0.0.1"`.
- **FP-filter verdict:** see the addendum at the end of this file.

### P2 · MED · `workflow_dispatch` lets a manual run deploy any branch to production without CI
- **Where:** `.github/workflows/deploy-hf-space.yml:13`. Gating exists only on the `workflow_call` path
  (`ci.yml:152-156`, `needs: [frontend, python-unit, python-models, docker-smoke]`).
- **Why it matters:** "Run workflow" on an arbitrary ref stages and pushes that ref to the Space. That is exactly the
  production-from-an-unmerged-branch failure R3 fixed. It is safe only if the `hf-production` environment restricts
  deployment branches, which is a GitHub setting and cannot be seen from the repo.
- **Fix:** Remove `workflow_dispatch`, or guard the job with `if: github.ref == 'refs/heads/main'`, and add
  environment branch protection.
- **Hygiene, low:**
  - The HF token is embedded in the clone URL (`:37`), so it persists in the runner's `.git/config`. It is masked in
    logs. Prefer `git -c http.extraheader` or a credential helper.
  - `actions/checkout@v4` is not pinned to a SHA.

### P3 · LOW · Benchmark route: malformed JSON or wrong types produce a 500
- **Where:** `app/api/benchmark/route.ts:82` (`request.json()`) and `:89` (`JSON.parse(json)`). Neither is guarded,
  so both reach `errorResponse` as a non-`ApiError` with status 500. `structureIds` and `models[]` entries are not
  type-checked; for example, a string `structureIds` passes the `.length` check.
- **Fix:** Wrap the parse in `ApiError(400, "invalid_body")`, and check that `structureIds` is an array of strings and
  that each model has a string `type` and `size`.

### P4 · LOW · `/smiles-to-xyz` bypasses the job queue and every per-visitor limit
- **Where:** `mace-api/main.py:296-297`. `asyncio.to_thread` uses the default executor, so up to `min(32, cpu+4)`
  concurrent RDKit embeds run alongside the single MACE worker. The only bounds are 500 characters and `max_atoms`.
- **Fix:** Add a small semaphore and a per-client counter, or route it through `JobStore` as a light job.

### P5 · LOW · Error messages pass exception text through
- **Where:**
  - `main.py:301` (`f"{type(e).__name__}: {e}"`)
  - `calculate.py:728-741` (ASE text)
  - `calculate.py:424-434` (custom-model text, local only)
  - `backend.ts:37-51` (any non-`ApiError` message becomes a 500 body; in local mode an `ENOSPC` from `writeFile`
    would include the temp path)
- **Evidence:** E2 found no server paths in hosted errors for malformed cif, pdb, POSCAR or xyz uploads. This is
  therefore a hardening item, not a demonstrated leak.
- **Fix:** In `errorResponse`, map non-`ApiError` failures to a generic message and log the detail server-side.

### P6 · LOW · No Next-side body cap before `request.formData()` outside Vercel
- **Where:** `app/api/jobs/route.ts:20`, `app/api/calculate/route.ts:42`, `app/api/benchmark/route.ts:84`.
- **Why it matters:** On Vercel the platform's 4.5 MB limit applies. Self-hosted or local `next start` has no
  default limit for route handlers, so `checkUploadSize` runs after the whole body is buffered in memory.
- **Fix:** Check `content-length` against the profile cap before calling `formData()`.

### P7 · LOW · The 240 s budget is not a wall-clock bound
- **Where:** `calculate.py:103-111`. The deadline is checked only in `tick()`, once per BFGS or MD step.
- **Why it matters:** A 5000-atom single-point, a model load, or a cold MACE-OFF download has no deadline check.
  Combined with F5 and F6, the sync path can exceed both the 240 s budget and Vercel's 290 s fetch.
- **Fix:** Document the budget as "between steps", or run single-points under a watchdog that reports partial results
  honestly.

---

## Checked and fine
- **Token check:** `hmac.compare_digest` over bytes, which is constant-time. With the token set, it gates
  `POST /v1/jobs`, `GET` and `DELETE /v1/jobs/{id}`, `/calculate` and `/smiles-to-xyz`. `/health` (git SHA, by
  design), `/capabilities`, `/` and `/docs` expose no secrets.
- **Hosted profile:** a custom model is refused with 403 in `validate_request` inside `_intake`, before anything is
  saved. `maxModelUploadBytes` is 0 and `ALLOW_CUSTOM_MODELS` is unset in the Dockerfile.
- **`safe_load` (S3/D19 holds):** an untrusted `.model` is refused by hash; non-checkpoint files are forced to
  `weights_only=True` even when the caller passes False; file objects are forced to True. All mace 0.3.16
  `torch.load` sites go through the patched attribute.
- **`modelSize`/`modelType`** are allow-listed (S3b holds). **Filenames:** server-chosen
  (`structure<ext>`, `custom.model`), display names are basename-only, printable, and at most 120 characters
  (S2/D20 holds).
- **ASE** always reads with an explicit `format=`, so magic-byte detection, and with it any pickle-based reader, is
  never reached. There is no yaml, `eval`, `np.load(allow_pickle)` or `shell=True`.
- **Temp dirs are removed** on save errors (`except BaseException`), on admission refusal (`_submit`), and on every
  terminal state including cancel-while-queued (`_finish_locked`). Next's local paths remove them in `finally` and
  `catch`.
- **Hosted errors** contained no server paths (E2). `describe()` omits the client key and the workdir. Job ids are
  128-bit `token_urlsafe(16)`.
- **Job store:** bounded at 200 entries with a 900 s TTL. Result size is bounded by the profile trajectory budget
  (150k floats, 500 frames).
- **Next proxy:** builds fresh outbound headers and never relays client headers. The job-id regex
  `^[A-Za-z0-9_-]{16,64}$` runs before path interpolation. The host comes only from `MACE_API_URL`, so there is no
  SSRF.
- **CLI argv:** `execFile` and `spawn` with no shell. The params JSON always starts with `{`. Display names need an
  allowed suffix, so they cannot collide with `--model-path` or `--progress`.
- **Share route** (security sub-agent): server-chosen 72-bit id, shape validation, 3 MB cap, insert-only with
  service-role key. There is no `dangerouslySetInnerHTML` or JSON-LD anywhere, and WEAS data is escaped inside a
  sandboxed iframe.
- **`next.config.ts`:** nosniff, Referrer-Policy, Permissions-Policy and `frame-ancestors 'self'` everywhere except
  exactly `/r/<id>/embed`. A full CSP is still the known S6 follow-up.
- **CI:** runs on `pull_request`, not `pull_request_target`, with `contents: read`. Automatic deploy happens only on
  a push to `main` after all gates. Staging uses `git ls-files mace-api` minus tests, plus the validator and
  `GIT_COMMIT`, so no `.env` is shipped.
- **MD:** one `default_rng(seed)` feeds both Maxwell-Boltzmann and Langevin. The seed is recorded in `params` and in
  the message. No unrecognised `calculationType` falls through.
- **Minor code-review leftovers (not findings):** unused `import math` and dead `_UNIMPLEMENTED_HINTS` in
  `calculate.py`.

---

## Addendum: security-review false-positive filter on P1
- **Verdict:** TRUE POSITIVE. Confidence 8/10, which passes the skill's ≥8 bar. Severity HIGH. Pre-existing: it was
  on `main` through `/api/calculate`, and v2.2 adds `/api/jobs`.
- **Evidence the filter cited:**
  - `package.json:6` runs `next dev` with no `-H`, and Next's `start-server.js:430` calls `listen(port, undefined)`,
    which binds every interface.
  - `block-cross-site-dev.js:64-85` checks only `/_next` and `/__nextjs`.
  - There is no `allowedDevOrigins`, `middleware.ts` or `proxy.ts`, and no route checks `Origin`, `Host` or auth.
  - `contract.json` local profile sets `customModels: true`.
  - `jobs.ts:93-96` turns the upload into `--model-path`, and `safe_load.py:86-88` then loads it with
    `weights_only=False`.
  - `/api/jobs` answers 202 and runs the job anyway, so the attacker never needs to read the response.
- **What limits it:** the developer must be running local mode. Chrome's Local Network Access prompt gates the
  cross-site path. The LAN path needs no user action at all.
- **What widens it:** a self-hosted `next start` with no `MACE_API_URL` also selects the local profile.
- **Result of the security-review skill after filtering:** this is the only finding at ≥8 confidence. Everything
  else in this file comes from the code-review skill or from my own runtime probes, which have a broader remit
  (correctness, availability, scientific honesty) than the security skill's exclusions allow.
