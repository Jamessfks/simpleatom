---
title: MACE API
emoji: ⚛️
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
---

# SimpleAtom MACE API (v2.2.0)

The backend of [SimpleAtom](https://mace-lake.vercel.app): FastAPI over one
calculation engine (`calculate.py`, ASE + mace-torch). This Space is deployed
**only by CI** from [Jamessfks/simpleatom](https://github.com/Jamessfks/simpleatom);
changes pushed here by hand are overwritten on the next deploy.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/jobs` | Queue a calculation (multipart `files`, `params`); returns `202 {jobId}` |
| `GET` | `/v1/jobs/{id}` | Status, real progress (phase, BFGS/MD step) and the result |
| `DELETE` | `/v1/jobs/{id}` | Cancel |
| `POST` | `/calculate` | Run one calculation and wait (same worker) |
| `POST` | `/smiles-to-xyz` | SMILES → 3D XYZ (RDKit ETKDG + MMFF94) |
| `GET` | `/capabilities` | Profile, limits, offered models |
| `GET` | `/health` | Liveness, version and the deployed git commit |

What `params` may contain, and every limit on this deployment (the `hosted`
profile), is in the generated
[request contract](https://github.com/Jamessfks/simpleatom/blob/main/docs/reference/contract.md).
Refusals return 4xx with `{"status": "error", "error": {"code", "message", "field"}}`.
Full reference: [HTTP API](https://github.com/Jamessfks/simpleatom/blob/main/docs/reference/api.md).

## Models

MACE-MPA-0 (default; MIT), MACE-MP-0 (MIT), MACE-OFF23 (Academic Software
License — non-commercial). Only checkpoints whose SHA-256 is pinned in
`contract.json` are ever loaded; uploaded `.model` files are refused here
because loading one executes code from the file.

## Run it yourself

```bash
pip install --require-hashes --no-deps -r requirements.lock.txt   # Linux x86_64, CPU
# or, anywhere: pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 7860 --workers 1
python calculate_local.py ethanol.xyz '{"modelType":"MACE-OFF","modelSize":"small"}'
```

Set `SIMPLEATOM_PROFILE=local` for local limits and custom models, and
`MACE_API_TOKEN` to require the front end's proxy key. Bind to 127.0.0.1 for local or
self-hosted use. With ALLOW_CUSTOM_MODELS=1 the server accepts a checkpoint only from a
loopback peer (`custom_models_local_only`, D173), but ALLOW_CUSTOM_MODELS must still never be
combined with a non-loopback bind such as 0.0.0.0: an uploaded checkpoint runs code. The
Dockerfile's 0.0.0.0 is right inside the Space's container, where uploads are refused.

Units: energy eV, forces eV/Å, distances Å, time fs, temperature K, stress and
pressure GPa.
