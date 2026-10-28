---
status: proposed
date: 2026-10-28
decision-makers: repository owner (pending approval at STOP-1)
---

# 0031 — Offer only devices that work; refuse CUDA on the public server, warn when it falls back locally

## Context and problem statement

A user who picks "CUDA (GPU)" is told nothing when the calculation runs on the CPU. The
2026-10-28 audit (D33, D34) sent `device: "cuda"` from a CPU-only machine through all four
paths: the CLI under both profiles, FastAPI `/calculate` and `/v1/jobs` under both
profiles, Next.js `/api/calculate` and `/api/jobs` in local mode, and the UI. Every result
came back with `params.device: "cpu"`, `manifest.runtime.device: "cpu"`, no `warnings` key
and no `requestedDevice`. The UI kept "CUDA (GPU)" in the selector, left the device out of
the "What will run" summary, and gave the timing as "0.16 s compute" with no device.

The causes:

* `resolve_device` (`mace-api/calculate.py:374-384`) returns `cpu` without a warning.
* `contract.json:22-25` lists `[cpu, cuda]` with no limit per profile.
* `/capabilities` (`main.py:304-313`) says nothing about devices.
* The selector is hard-coded (`components/calculate/parameter-panel.tsx:422-437`).

The hosted image can never use a GPU, because the lock pins `torch==2.10.0+cpu`
(`requirements.lock.txt:1946`). The docs promise a fallback on CUDA out-of-memory that does
not exist (`app/docs/calculations/page.tsx:276-281`).

Two rules pull in different directions:

* ADR-0004 says never return numbers for something other than what was asked.
* CLAUDE.md says "GPU fallback: always handle CUDA unavailable → CPU gracefully".

## Considered options

* **A. Refuse everywhere.** A request for an unavailable device gets `device_unavailable` (400).
* **B. Fall back everywhere, with a warning** and `params.requestedDevice`.
* **C. Per profile.** Hosted refuses with `device_unavailable`. Local falls back to CPU with
  a `result.warnings` entry and `params.requestedDevice: "cuda"`.
* **D. Hide CUDA in the UI only** and keep the silent backend fallback.

## Decision outcome

Chosen option: "C. Per profile". The device changes where the arithmetic runs, not what is
computed. The same weights and the same dtype give the same physics; this audit measured a
float64 CPU spread of 0 across 1 and 2 threads, while the CUDA-against-CPU difference is
UNVERIFIED. A local fallback that is announced is therefore not "a different calculation"
under ADR-0004, and it satisfies CLAUDE.md's graceful-fallback rule on machines where CUDA
comes and goes (drivers, containers). The public server can never satisfy `cuda`, and
`/capabilities` will say so, so on hosted the request is a client error and is refused.
Option D was rejected because the API is called directly (ADR-0003), so a UI-only fix leaves
the silent gap in place.

1. **Report only usable devices.** `/capabilities` (FastAPI) and `GET /api/calculate` (local
   mode) return `devices: {available: [...], cuda: {available, torchCuda, name}}`. `cpu` is
   always listed. `cuda` is listed only if `torch.cuda.is_available()` is true; `torchCuda`
   is `torch.version.cuda` and `name` is `torch.cuda.get_device_name(0)`.
2. **Contract.** `profiles.hosted.devices = ["cpu"]` and `profiles.local.devices = ["cpu",
   "cuda"]`, plus the new error codes `device_unavailable` (400) and `cuda_out_of_memory` (507).
3. **Local fallback** records `params.requestedDevice` and adds the warning: "CUDA was
   requested but is not available on this machine (torch.cuda.is_available() is False). The
   calculation ran on CPU; the numbers are unaffected, the timing is CPU timing."
4. **UI.** The selector lists the reported devices. On hosted it shows GPU disabled, with the
   reason ("The public server is CPU-only") and a link to the local-install guide. "What
   will run" includes the device, and the timing names it ("0.16 s compute on CPU").
5. **With a real GPU.**
   * CUDA out-of-memory (`torch.OutOfMemoryError`) becomes `cuda_out_of_memory`, with a hint
     to switch to CPU or use a smaller structure. Nothing is retried silently.
   * Precision rules (ADR-0005) are unchanged.
   * `enable_cueq` stays off unless `cuequivariance` is installed and a gain is measured.
     Today's log says "cuequivariance or cuequivariance_torch is not available".
   * No speedup is claimed anywhere until it has been measured on named hardware.
6. **Benchmark** keeps `device: "cpu"` (`app/api/benchmark/route.ts:207`) so comparisons run
   on one device, and the page says that it runs on CPU.
7. **Docs.** The out-of-memory sentence and the FAQ entry are rewritten to describe
   behaviour the code has.

### Consequences

* Good, because every gap between the device asked for and the device used is either an
  error or a visible warning, in every path.
* Good, because the UI cannot offer a device the server does not have.
* Bad, because API callers that send `device: "cuda"` to the hosted API now get a 400 where
  they used to get CPU results.
* Bad, because the CUDA-present path (out-of-memory handling, device name, float64 speed)
  cannot be verified without a CUDA machine. It stays UNVERIFIED until one is used.

### Confirmation

* Guard: `SIMPLEATOM_PROFILE=hosted python3 mace-api/calculate_local.py public/demo/ethanol.xyz
  '{"device":"cuda"}'` must print `{"status":"error","error":{"code":"device_unavailable",…}}`.
* `test_backend_contract.py::TestDevice`:
  * hosted refuses;
  * local, on a CPU-only machine, returns a warning and `requestedDevice`;
  * `/capabilities` reports `available == ["cpu"]` when `torch.cuda.is_available()` is false;
  * `torch.OutOfMemoryError` maps to `cuda_out_of_memory`, with the exception injected.
* vitest: the parameter panel renders only the devices it is given.

## More information

* Audit evidence: `docs/audits/2026-10-28.md` §Device path. Defects D33–D35.
* Hosted GPU options: [`docs/v2/hosted-gpu-memo.md`](../v2/hosted-gpu-memo.md).
* Upstream: `mace_mp()` and `mace_off()` forward `**kwargs` to `MACECalculator`, which takes
  `enable_cueq` and `enable_oeq` (`mace/calculators/mace.py:113-114`, v0.3.16).
* ADR-0004, ADR-0005, ADR-0008, ADR-0022.
