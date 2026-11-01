---
status: accepted
date: 2026-10-20
decision-makers: Zicheng Zhao
---

# 0020 — Unpickle only pinned checkpoints; refuse custom models on the public instance

## Context and problem statement

A MACE `.model` file is a pickled torch module; loading it runs code from the file. SimpleAtom patched `torch.load` to `weights_only=False` for the whole process, accepted custom `.model` uploads on the public Space, and passed `modelSize` unvalidated to upstream loaders that treat unknown strings as a URL or path. Together: anyone could make the server execute a file of their choosing. Upstream MACE also sets `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` at import, which makes every later implicit `torch.load` permissive.

## Decision outcome

Remove the global patch. `safe_load.trusted_checkpoints()` scopes permissive loading to the moment a calculator is built and only for files whose SHA-256 is pinned in `contract.json` (or an uploaded file where the deployment allows custom models); any other checkpoint-like file is refused before it is opened, and everything else loads with an explicit `weights_only=True` (explicit, so upstream's environment variable cannot override it). Custom checkpoints are refused on the hosted profile unless `ALLOW_CUSTOM_MODELS=1`; local mode keeps them.

### Consequences

* Good, because A planted pickle in the model cache is refused on its hash and its payload never runs.
* Good, because A re-published or corrupted upstream file fails loudly with its digest.
* Bad, because re-publishing a checkpoint upstream requires updating its pin.
* Bad, because custom models need a local or self-hosted instance.

### Confirmation

`test_backend_contract.py::TestCheckpointTrust::test_untrusted_checkpoint_is_refused_before_it_is_unpickled`; CI `docker-smoke` expects 403 for a custom model upload.

## History

Supersedes the process-wide `torch.load` patch in main.py and calculate_local.py (2026-02).

2026-10-30 (D40): custom checkpoints are opt-in on the local profile too. `next dev`
listened on 0.0.0.0, and no route checked Origin, so a LAN peer or any page the
developer visited could POST a pickle to a local server. Now:

* `npm run dev` binds 127.0.0.1;
* every POST route refuses a cross-origin browser request (`cross_origin`);
* with `ALLOW_CUSTOM_MODELS=1`, local mode accepts an upload only through a loopback
  host name (`custom_models_local_only`), which defeats DNS rebinding.

2026-10-31 (D94): `npm start` binds 127.0.0.1 as well. The Host header that the loopback
check reads can be forged by a LAN client, so loopback binding is the boundary; serving
local mode on a network address with `ALLOW_CUSTOM_MODELS=1` is unsupported and documented.

## More information

* mace-api/safe_load.py
* mace-api/contract.json models[].sizes[].sha256
* docs/audits/2026-10-20.md S3/S3b
