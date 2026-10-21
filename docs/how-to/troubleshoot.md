# Troubleshoot

| Symptom | Cause and fix |
|---|---|
| `OMP: Error #15` on macOS | Two copies of libomp. `export KMP_DUPLICATE_LIB_OK=TRUE`. |
| First calculation takes ~30 s | The checkpoint is downloading into `~/.cache/mace`. Later runs are fast. |
| "Refusing to load '…model': its SHA-256 … does not match" | The cached file is not the pinned checkpoint (corrupt download, or upstream re-published it). Delete it from `~/.cache/mace` and retry; if upstream really changed it, verify the new file and update its pin in `mace-api/contract.json`. |
| `unsupported_model_size` | MACE-MPA-0 is published in `medium` only; MP-0 and MACE-OFF have small/medium/large. |
| `limit_exceeded` (422) | Over this deployment's caps (see the [contract](../reference/contract.md#deployment-profiles)). Run locally for bigger jobs. |
| `custom_models_disabled` (403) | The public instance does not load uploaded checkpoints. Run locally. |
| `busy` / `rate_limited` (429) | The shared backend runs one job at a time; try again shortly. |
| A geometry says "DID NOT CONVERGE" | It hit `maxOptSteps` or the time budget; raise the steps or loosen `forceThreshold`. The geometry is not a relaxed minimum. |
| "Sharing is unavailable right now" | The MACE Link database is not configured or not reachable — the link itself may be fine. |
| D3 dispersion error | `torch-dftd` is not installed (`pip install -r mace-api/requirements.txt`). |
| MACE-OFF element error | MACE-OFF covers H, C, N, O, F, P, S, Cl, Br, I only; use MACE-MPA-0. |
