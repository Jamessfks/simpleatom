---
status: proposed
date: 2026-10-21
decision-makers: Zicheng Zhao
---

# 0030 — Stay on mace-torch 0.3.x until a published v1.0 passes the engine-parity gate

## Context and problem statement

[ADR-0025](0025-pin-scientific-dependencies.md) pins mace-torch 0.3.16 and defers the v1.0 question to a separate ADR. This is that ADR: when does the backend move from the legacy `mace` package to MACE v1.0, and what must a move prove? Facts below were read from upstream primary sources on 2026-10-21; the evidence section has the links.

* **v1.0 is not released.** The latest GitHub release and the latest PyPI version are both 0.3.16 (2026-05-10); no 1.x release, pre-release or tag exists. v1 is developed on the `mace-reforge` branch, whose PyTorch package is still described upstream as a scaffold, and the tickets that build its loaders, converter and calculator are open.
* **It is a rewrite, not an upgrade.** Upstream states that v1.0 keeps neither code nor checkpoint compatibility. `mace_mp`, `mace_off` and `MACECalculator` are replaced by a new API, and v0.3 checkpoints do not load in v1 at all.
* **Everything the trust model rests on changes.** The unpickling guard ([ADR-0020](0020-trusted-checkpoint-loading.md)), the SHA-256 pins ([ADR-0021](0021-model-registry-mpa0-default.md)) and the provenance manifest's way of identifying the checkpoint ([ADR-0009](0009-reproducibility-manifest.md)) are all built around legacy pickles opened by `torch.load`.

## Considered options

* **A. Stay on 0.3.x.** Keep the exact pins. Patch bumps inside 0.3.x go through the ADR-0025 gate. Revisit when explicit entry conditions hold.
* **B. Migrate to v1.0 now.** Not possible: there is no release to install, no published loader or converted checkpoint to load, and no calculator to call.
* **C. Dual-support.** Run both engines behind one backend, selected per request.

## Decision outcome

Chosen option: "A. Stay on 0.3.x", because the migration cannot be performed today and, when it can, ADR-0025's rule that a bump merges only on physics needs a bar written before the pressure to migrate arrives.

1. The pins in `mace-api/requirements.in` and `requirements.lock.txt` stay as they are. A move to another 0.3.x release (for example 0.3.17, which exists upstream but was never published) is an ordinary ADR-0025 bump and needs no new ADR.
2. No code or dependency in this repository may import `mace_core` or `mace_torch`, or depend on `mace-torch>=1`, until all five entry conditions below hold.
3. When they hold, the migration is a **single-engine cutover**, merged only if the migration gate passes. Both engines are never installed together at run time. The old engine is represented in CI by frozen reference outputs.
4. Whether the `custom` model type survives is decided in the migration PR. Upstream will not convert arbitrary user checkpoints, so it is either removed or rebuilt around converted artifacts. No v1 path may accept a pickle.

Why not B or C:

* **B** has nothing to migrate to. FM-1 to FM-4, DEP-1 and the migration guide REL-1 are open upstream, and the v1 PyTorch package has no calculator or foundation-model loader yet.
* **C** cannot share an environment. v1.0.0 will publish under the existing `mace-torch` name once the legacy package is retired, so the two lines cannot both be installed from PyPI. The side-by-side distribution `mace-torch-v1` is, by upstream's own plan, never published; it is a 404 on PyPI today. A dual backend therefore means two virtualenvs or two images, which cannot be built from one hashed lock ([ADR-0025](0025-pin-scientific-dependencies.md)), and it needs an `engine` field in the contract and manifest, doubled validator and golden suites, and doubled CI. Parity is a CI-time need, and frozen reference outputs meet it without a second engine in production.

### Entry conditions (all five, before a migration PR is opened)

* **E1.** PyPI has a final (non-pre-release) `mace-torch` 1.x.
* **E2.** The v1 loaders and ASE calculator are released, with equivalents of `mace_mp` and `mace_off`.
* **E3.** Converted safetensors + JSON artifacts for all seven registry checkpoints are published. SimpleAtom computes their SHA-256 itself from the downloaded assets and does not copy a hash from a release note.
* **E4.** Upstream's migration guide is published.
* **E5.** A hashed CPU lock for Python 3.11 resolves with the v1 dependency closure, using the `uv pip compile` command recorded in `requirements.in`.

### Consequences

* Good, because nothing churns while v1 cannot be built or tested, and the hashed pins and the unpickling guard stay meaningful.
* Good, because the migration bar is fixed in advance and every item in it is a command.
* Good, because no floor forces a change: upstream's next Python and torch floors (3.11, torch 2.5) are already met by the Space (Python 3.11, torch 2.10.0).
* Bad, because the pin may stay at 0.3.16 for as long as v1 takes. Upstream's plan treats 0.3.16 as the last published 0.3.x, so fixes that exist only on `develop` (such as the #1726 neighbour-list fix) may never reach PyPI. Taking a git-sourced build into the hashed lock would need its own ADR.
* Bad, because the migration is large when it comes (touch-point table below).

### Confirmation

Run from the repository root. Part 1 proves the decision holds today. Part 2 is the bar for lifting it.

**Part 1. The decision holds.**

```bash
# 1a. The pin is a 0.3.x release and agrees across .in, .txt and the hashed lock (offline).
python3 -I - <<'PY'
import re, pathlib
root = pathlib.Path('.')
lock = (root / 'mace-api/requirements.lock.txt').read_text()
ver = re.search(r'^mace-torch==(\S+) \\$', lock, re.M).group(1)
assert re.fullmatch(r'0\.3\.\d+', ver), f'mace-torch {ver} is not a 0.3.x pin'
for f in ('requirements.in', 'requirements.txt'):
    assert f'mace-torch=={ver}' in (root / 'mace-api' / f).read_text(), f
print('mace-torch', ver, 'pinned in lock, .in and .txt')
PY

# 1b. Review trigger (network). Exits non-zero the moment any 1.x, final or pre-release, reaches PyPI.
python3 -I - <<'PY'
import json, urllib.request
d = json.load(urllib.request.urlopen('https://pypi.org/pypi/mace-torch/json', timeout=30))
v1 = sorted(v for v in d['releases'] if v.split('.')[0] != '0')
print('PyPI mace-torch latest:', d['info']['version'], '| major >= 1:', v1 or 'none')
raise SystemExit('v1 is on PyPI: this ADR is due for review' if v1 else 0)
PY
```

CI enforces the pin on every push: `pip install --require-hashes --no-deps -r mace-api/requirements.lock.txt` fails on any drift, and the `python-models` job runs the translation-invariance test that ADR-0025 requires. Today 1a prints `mace-torch 0.3.16 pinned in lock, .in and .txt` and 1b prints `PyPI mace-torch latest: 0.3.16 | major >= 1: none`.

**Part 2. Entry conditions (a migration PR may not be opened until each command succeeds).**

```bash
# E1: a final 1.x exists on PyPI (fails today, by design).
python3 -I - <<'PY'
import json, re, urllib.request
d = json.load(urllib.request.urlopen('https://pypi.org/pypi/mace-torch/json', timeout=30))
finals = sorted(v for v in d['releases'] if re.fullmatch(r'[1-9]\d*(\.\d+)+', v))
assert finals, 'E1 not met: no final 1.x release of mace-torch on PyPI'
print('E1 met:', finals[-1])
PY

# E2-E4: every ticket this ADR depends on is closed (DEP-1, FM-1, FM-2, FM-3, REL-1, FM-4).
for n in 1583 1586 1587 1588 1603 1636; do
  gh issue view "$n" --repo ACEsuit/mace --json number,state --jq '"#\(.number) \(.state)"'
done

# E2 (after installing the candidate in a scratch venv): the loaders import. The module path is the
# one upstream's FM-3 plan names; use the released path if it differs.
python -c "from mace_torch.calculators.foundations import mace_mp, mace_off"

# E5: after editing requirements.in for the v1 closure, the hashed CPU lock resolves.
uv pip compile mace-api/requirements.in --python-version 3.11 \
  --python-platform x86_64-manylinux_2_28 \
  --extra-index-url https://download.pytorch.org/whl/cpu \
  --index-strategy unsafe-best-match --generate-hashes -o /tmp/v1.lock.txt
```

**Part 3. The migration gate (every item must pass before the migration PR merges).**

Existing gates, unchanged and reproduced from `.github/workflows/ci.yml` at v2.2.0. A migration PR may add to them but may not weaken them:

```bash
# Install exactly what ships
pip install --require-hashes --no-deps -r mace-api/requirements.lock.txt

# python-unit: registry, pins, checkpoint trust, refusal guards, fixtures (20 tests)
python -m unittest discover -s test_scripts -p "test_backend_contract.py" -v
(cd mace-api && python -m unittest test_geometry_opt test_smiles_to_xyz)

# python-models: validator self-test, golden energies and manifest (40 tests),
# science regressions incl. translation invariance (9 tests)
python test_scripts/validate_calculation.py --test | tee validator.json
python -c "import json,sys; t=open('validator.json').read(); d=json.loads(t[t.index('{'):]); sys.exit(0 if d['all_passed'] else 1)"
python -m unittest discover -s test_scripts -p "test_provenance.py" -v
python -m unittest discover -s test_scripts -p "test_science_regressions.py" -v

# docker-smoke: the staged image builds (prefetch_checkpoints.py fails the build on a pin
# mismatch) and passes the serve-and-curl assertions in ci.yml
scripts/stage-hf-space.sh /tmp/stage && docker build -t simpleatom-api /tmp/stage

# Everything together, and the frontend gates if contract.json changed shape (it will)
python test_scripts/daily_gate.py
npm run check:contract && npm run typecheck && npm test && npm run build
mkdocs build --strict
```

The physics anchors may not move to make the migration pass. The `GOLDEN` energies and tolerances in `test_scripts/test_provenance.py` must be identical on the migration branch (set `BASE` to the branch it merges into):

```bash
BASE=origin/main python3 -I - <<'PY'
import ast, os, subprocess
def golden(ref):
    src = subprocess.check_output(['git', 'show', f'{ref}:test_scripts/test_provenance.py'], text=True)
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], 'id', None) == 'GOLDEN':
            return ast.literal_eval(node.value)
assert golden(os.environ['BASE']) == golden('HEAD'), 'GOLDEN changed'
print('GOLDEN identical')
PY
```

Gates the migration PR must **add**. They do not exist today; each is a named test that must be green:

* **Engine parity** (`test_scripts/test_engine_parity.py`). The v1 engine, run in float64 on CPU, must agree with frozen reference outputs for all seven registry checkpoints on at least ethanol and silicon. Tolerance is |ΔE| and max |ΔF| of 1e-6 (eV, eV/Å), upstream's own fp64 parity row. The references are JSON files generated once under the 0.3.16 lock by a script committed beside them, so CI never needs the old engine installed. Stress is compared for the periodic structure.
* **Translation invariance on v1.** `TestTranslationInvariance` passes unchanged on the new engine: offsets 0, −10 and +100 Å, |ΔE| and |ΔF| below 1e-6, for MACE-OFF small and MACE-MPA-0 medium. v1 has its own graph construction, so the neighbour-list bug class of #1533 and #1726 has to be re-excluded and cannot be assumed away.
* **No unpickling on the v1 path.** A test that makes `torch.load` raise and shows a v1 foundation calculation still succeeds, and a test that a pickled `.model` upload is still refused with 403 on the hosted profile (`docker-smoke` already checks the 403).
* **Pins for both files.** `contract.json` carries the pin for each file of every converted artifact. `TestRegistry.test_every_foundation_size_has_a_sha256_pin` is extended to cover every file, and `prefetch_checkpoints.py` bakes the v1 artifacts and fails the build on any mismatch.
* **Provenance without `torch.load`.** The manifest identifies the checkpoint from the artifact the resolver returned, and records both files of the pair. `PROVENANCE_SCHEMA_VERSION` is bumped. `test_checkpoint_digest_is_the_hash_of_the_real_file_on_disk` and `test_library_versions_are_populated` still pass.
* **Contract version.** `contractVersion` in `contract.json` is bumped (ADR-0022), `lib/generated/contract.ts` is regenerated, and `npm run check:contract` passes.

## Evidence

All queries were run on 2026-10-21 against the GitHub REST API and PyPI. Upstream's v1 plan is written as tickets, so those describe intended behaviour and not released behaviour. Statements about v1 below are marked as plan where that matters.

### Is v1.0 released? No

* GitHub: the [latest release is v0.3.16](https://github.com/ACEsuit/mace/releases/tag/v0.3.16) (2026-05-10). The [tag list](https://github.com/ACEsuit/mace/tags) has no `v1*`, `mace-core-v*`, `mace-torch-v*`, `mace-launcher-v*` or `mace-jax-v*` tag.
* PyPI: the [mace-torch metadata](https://pypi.org/pypi/mace-torch/json) lists 0.3.16 as latest, with no 1.x release or pre-release. `mace-core`, `mace-torch-v1`, `mace-launcher` and `mace-jax` all return 404.
* Naming plan: per the [v1 packages README](https://github.com/ACEsuit/mace/blob/96935426b5ae8362f5568861e33d69e931494989/packages/README.md), `mace-torch-v1` and `mace-launcher` are never published, and v1.0.0 publishes under the `mace-torch` name once the legacy package is retired.
* Unpublished 0.3.17: `develop` and `main` report [0.3.17](https://github.com/ACEsuit/mace/blob/develop/mace/__version__.py), 127 commits past v0.3.16, never published. [FM-1 (#1586)](https://github.com/ACEsuit/mace/issues/1586) calls 0.3.16 the last published release and notes that a 0.3.17 pin cannot be installed.
* Progress: v1 is developed on [`mace-reforge`](https://github.com/ACEsuit/mace/tree/mace-reforge). Its [PyTorch package README](https://github.com/ACEsuit/mace/blob/96935426b5ae8362f5568861e33d69e931494989/packages/mace-torch/README.md) says "Scaffold only for now", and the package contains `backends/`, `kernels/` and `nn/` only. There are [61 open and 12 closed issues labelled `reforge`](https://github.com/ACEsuit/mace/issues?q=label%3Areforge), and nine commits to the branch in the 30 days to 2026-10-21. Open at the time of writing: [DEP-1 #1583](https://github.com/ACEsuit/mace/issues/1583), [FM-1 #1586](https://github.com/ACEsuit/mace/issues/1586), [FM-2 #1587](https://github.com/ACEsuit/mace/issues/1587), [FM-3 #1588](https://github.com/ACEsuit/mace/issues/1588), [REL-1 #1603](https://github.com/ACEsuit/mace/issues/1603), [FM-4 #1636](https://github.com/ACEsuit/mace/issues/1636).

### What breaks

* **Compatibility statement.** [PR #1699](https://github.com/ACEsuit/mace/pull/1699) adds a README status section saying v0.3.x remains the supported line and that v1.0 will not keep code compatibility. Checkpoints migrate through an explicit converter and do not load directly. [PR #1715](https://github.com/ACEsuit/mace/pull/1715) adds `FutureWarning`s, on `develop` and so only in the unpublished 0.3.17, for the surfaces v1 drops or merges. This repository would trigger none of them: in the calculator and foundation-model code the only warning sites are the singular `model_path` parameters, and `calculate.py` passes `model_paths`.

| SimpleAtom uses | 0.3.16 | v1.0 (plan, from [FM-3](https://github.com/ACEsuit/mace/issues/1588), [DEP-1](https://github.com/ACEsuit/mace/issues/1583), [REL-1](https://github.com/ACEsuit/mace/issues/1603)) |
|---|---|---|
| `from mace.calculators import mace_mp, mace_off` | functions in [`foundations_models.py`](https://github.com/ACEsuit/mace/blob/v0.3.16/mace/calculators/foundations_models.py) | Equivalents in `mace_torch.calculators.foundations`, returning the new ASE calculator. The `model`, `device`, `default_dtype` and `return_raw_model` kwargs are kept, with the same per-family dtype defaults (float32 for MP, float64 for OFF) and the D3 kwargs including the `damping` alias. An omitted `model` resolves to the family default and is logged. |
| Model keys such as `medium-mpa-0` | URL dictionaries | Canonical ids of the form `<label>-[data-]<hyperparam>`, for example `mace-mpa-0-medium`. Old aliases resolve but emit a runtime warning naming the replacement. |
| `MACECalculator(model_paths=...)` for uploaded checkpoints | loads any pickled `.model` | The class does not exist in v1. Arbitrary user checkpoints are out of scope for conversion. |
| `calc.models[0]`, `calc.mixer.calcs`, `type(calc).__name__ == "SumCalculator"` | legacy attribute layout | Not specified. DEP-1 fixes the result keys (`energy`, `forces`, `stress`) and not these attributes, so `calculate.py` must be re-verified. |
| `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD`, `torch.load` interception | pickles | v1 never unpickles, and the environment variable is a recorded drop. |

* **Checkpoint format.** A 0.3 checkpoint is a full pickle of a `torch.nn.Module`, and loading it executes class definitions from the file. v1 artifacts are a safetensors file plus a JSON sidecar with no pickle. A v1 loader given a legacy pickle refuses it and points at the converter.
  * Published foundation models are converted once, offline, by the FM-1 tool. Its end-user mode runs the unpickling step in a venv pinned to `mace-torch==0.3.16`.
  * Conversion preserves the function, not the weights. A full-to-reduced Clebsch–Gordan projection removes 8.9 % of MP-0 small's parameters, 9.1 % of MPA-0 medium's and 6.5 % of OFF23 medium's. The gate is energy, force and stress goldens at the fp64 tolerance row (1e-6), never weight equality ([FM-2 #1587](https://github.com/ACEsuit/mace/issues/1587), items 4 to 6). The artifacts that need a looser float32 row (MH-0, MH-1, OMOL and MP-0b medium) are not in this repository's registry.
* **Foundation-model URLs.** v0.3.16 hard-codes them in `mace_mp_urls` (12 of the 16 MP aliases on `ACEsuit/mace-mp` releases, the other four on `ACEsuit/mace-foundations`) and `mace_off_urls` (a file on the `main` branch of `ACEsuit/mace-off`, served from `raw.githubusercontent.com`). FM-2 (task 7) leaves every v0.3 artifact byte-identical and publishes each converted pair as a release asset on the same repository under a new tag, resolved through a single download-and-cache path that keeps `~/.cache/mace` and adopts both legacy cache filename schemes (FM-4 #1636). The new URLs do not exist yet.
* **Floors.** No floor forces a change.

| | Python | torch | Source |
|---|---|---|---|
| mace-torch 0.3.16 (pinned) | ≥ 3.9 | ≥ 1.12 | [PyPI metadata](https://pypi.org/pypi/mace-torch/0.3.16/json) |
| 0.3.17 candidate (`develop`, unpublished) | ≥ 3.11 | ≥ 2.5 | [PR #1759](https://github.com/ACEsuit/mace/pull/1759), merged 2026-10-15 ([setup.cfg](https://github.com/ACEsuit/mace/blob/f89bb921870d88aca1d77feb6a53d7e31806ca40/setup.cfg)) |
| v1 `mace-torch-v1`, `mace-core` | ≥ 3.11 | ≥ 2.5; also pydantic ≥ 2.7, pyyaml ≥ 6, numpy ≥ 1.23, ase ≥ 3.23 | [pyproject](https://github.com/ACEsuit/mace/blob/96935426b5ae8362f5568861e33d69e931494989/packages/mace-torch/pyproject.toml), [PR #1760](https://github.com/ACEsuit/mace/pull/1760) |
| SimpleAtom Space | 3.11 (`python:3.11-slim`) | 2.10.0 CPU | `mace-api/Dockerfile`, `requirements.lock.txt` |

  PR #1759 raised the torch floor because `torch.compiler.is_compiling` needs 2.3 and `add_safe_globals` needs 2.4, and it dropped Python 3.10. At the cited commit `mace-torch-v1` declares `mace-core`, `torch` and `ase`, and `mace-core` declares `pydantic`, `pyyaml`, `numpy` and `ase`. Neither lists `e3nn`, `torch-ema`, `matscipy`, `h5py` or `lmdb`, so the lock would shrink and `e3nn==0.4.4` would leave `requirements.in`. The scaffold may add dependencies as tickets land.
* **Do the SHA-256 pins survive?** For the 0.3.x path, yes. For v1, no, and they do not need to.
  * The v0.3 files stay byte-identical (FM-2, task 7). Checked: all seven `contract.json` pins (MPA-0 medium, MP-0 small, medium and large, OFF23 small, medium and large) match the SHA-256 of the files in a local `~/.cache/mace`, and each upstream URL answers HTTP 200 with a `Content-Length` equal to the pinned `bytes`. `prefetch_checkpoints.py` repeats that check at every image build.
  * v1 loads only the converted artifacts, which are new files in a new format, so they need new pins (one per file, two files per artifact) that cannot exist until FM-2 publishes them. Neither the `sha256` nor the `bytes` field carries over, nor do the `upstreamModel` keys.
  * The old pins keep one job under v1: the converter unpickles the original files in a pinned venv, so the pin still guards that step if SimpleAtom converts checkpoints itself.

### Touch points in this repository

Line numbers are at v2.2.0 (`ae2b6cf`).

| Where | What it couples to | On migration |
|---|---|---|
| `mace-api/calculate.py:387-417` `get_mace_calculator` | imports `mace_mp` and `mace_off` from `mace.calculators`; passes registry keys, `device`, `default_dtype`, `dispersion` | import path, model keys and returned calculator type change |
| `calculate.py:420-435` `get_custom_calculator` | `MACECalculator(model_paths=...)` | no v1 equivalent: remove or rebuild the `custom` model type |
| `calculate.py:263-291`, `325-335`, `294-322` | `calc.models[0]`, `calc.mixer.calcs`, class name `SumCalculator`, `torch_dftd` import | reads legacy layout; `precision` and `dispersion` honesty must be re-proved on v1 |
| `calculate.py:237-261`, `861-931` | warnings captured from upstream logging; `torch.set_default_dtype` workaround for the process-global dtype (upstream #1659, unreleased) | v1 behaviour unknown; re-verify with two requests of different precision in one process |
| `calculate.py:164-192`, `contract.json` `upstreamDefaultDtype` | float32 for MP, float64 for OFF ([ADR-0005](0005-precision-follows-upstream.md)) | v1 plans to keep both defaults; verify |
| `mace-api/safe_load.py:61-105` | scoped patch of `torch.load`, SHA-256 allow-list | unnecessary for v1 artifacts (no pickle); still needed while any pickle path exists |
| `mace-api/provenance.py:197-240`, `:61` | `capture_checkpoint_loads` finds the checkpoint by watching `torch.load`; `mace_cache_dir()` imports `mace.calculators.foundations_models.get_cache_dir`; tracked distributions | v1 reads safetensors, so `torch.load` never fires and the manifest would record no checkpoint; needs the resolver's path, handles a two-file artifact, and bumps the schema |
| `mace-api/contract.json` `models[]` | `loader`, `sizes[].upstreamModel`, `sha256`, `bytes`, `license`; `contractVersion` | second pin set and new keys; generated `lib/generated/contract.ts` and the CI `check:contract` step follow |
| `mace-api/prefetch_checkpoints.py:24` | legacy `download_mace_mp_checkpoint` | replaced by the v1 resolver; stays the pin-or-fail-build step |
| `mace-api/requirements.in`, `requirements.txt`, `requirements.lock.txt`, `Dockerfile` | `mace-torch==0.3.16`, `torch==2.10.0`, `e3nn==0.4.4`, `ase==3.27.0`, `numpy==2.4.2`; `uv pip compile` for Python 3.11, manylinux 2.28; `--require-hashes --no-deps` | new closure; same install discipline. Lines 14-15 of both requirements files name `test_scripts/test_translation_invariance.py`, which does not exist: the gate is `test_science_regressions.py::TestTranslationInvariance` |
| `test_scripts/validate_calculation.py:329` | imports `mace_mp`, `mace_off` for `--test`; also staged into the Space | new import path |
| `test_scripts/test_provenance.py` | `GOLDEN`: OFF small float64 E = −4221.322391557846 eV, max force 2.004692023917517 eV/Å, silicon MP-0 small float32 E = −42.954566955566406 eV, all at atol 1e-3; the header says recorded on 0.3.15, and the [audit](../audits/2026-10-20.md) records them passing under the 0.3.16 pin | must pass unmodified (migration gate) |
| `test_scripts/test_science_regressions.py` | `TestTranslationInvariance` (offsets 0, −10, +100 Å; 1e-6; OFF small and MPA-0 medium), the MPA-0 pin test, D5, D6, D16, D18, NVE | must pass on v1 |
| `test_scripts/test_backend_contract.py` | `TestCheckpointTrust` (4 tests), pin presence test | extended for two-file pins |
| `test_scripts/daily_gate.py` | expected test counts (provenance 40, science 9) and the CLI refusal guards | counts change with the added gates |
| `.github/workflows/ci.yml` | `~/.cache/mace` cache keyed on `hashFiles('mace-api/contract.json')`; `python-models` and `docker-smoke` | cache key rotates with the new pins; add the parity job |

## More information

* mace-api/calculate.py
* mace-api/safe_load.py
* mace-api/provenance.py
* mace-api/contract.json
* mace-api/prefetch_checkpoints.py
* mace-api/requirements.in
* mace-api/Dockerfile
* test_scripts/test_provenance.py
* test_scripts/test_science_regressions.py
* .github/workflows/ci.yml
* [ADR-0025](0025-pin-scientific-dependencies.md) (this ADR is the migration ADR it defers to; its pins and physics gate stay in force)
* Upstream: [PR #1699](https://github.com/ACEsuit/mace/pull/1699), [PR #1715](https://github.com/ACEsuit/mace/pull/1715), [PR #1759](https://github.com/ACEsuit/mace/pull/1759), [PR #1533](https://github.com/ACEsuit/mace/pull/1533), [PR #1726](https://github.com/ACEsuit/mace/pull/1726), [issue #1603](https://github.com/ACEsuit/mace/issues/1603)

Follow-ups this ADR does not make, because they change code:

* Run the Part 1 probes from `daily_gate.py`, so the trigger fires without anyone remembering to look.
* Correct the stale test path in `requirements.in` and `requirements.txt`.
* Make provenance identify the checkpoint through the registry or resolver, so it stops depending on watching `torch.load`.
