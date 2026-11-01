---
status: accepted
date: 2026-10-20
decision-makers: Zicheng Zhao
---

# 0025 — Pin the scientific stack exactly; gate upgrades on physics

## Context and problem statement

Every Python requirement was `>=`. Upstream MACE v1.0 is a rewrite with no code or checkpoint compatibility (ACEsuit/mace #1699, #1715); an unpinned rebuild would pull it the day it reaches PyPI. Unpinned torch pulled CUDA wheels into a CPU-only image. Upstream `develop` also carried, for seven weeks, a neighbour-list bug that made a displaced molecule come out ~10 eV high with zero forces (#1533 → #1726) — no release shipped it, but the next one could have.

## Decision outcome

`mace-api/requirements.in` pins the science stack with `==` (mace-torch 0.3.16, torch 2.10.0 CPU, ase 3.27.0, e3nn 0.4.4, numpy 2.4.2); `requirements.lock.txt` is a hashed Linux lock installed with `--require-hashes --no-deps`. The image bakes the MIT checkpoints with pin verification. Stay on mace-torch 0.3.x until a separate v1.0 migration ADR. A bump merges only when the validator, provenance golden energies and the translation-invariance test pass. Dependabot never touches this stack.

### Consequences

* Good, because the image is reproducible; MACE v1.0 cannot arrive unannounced.
* Bad, because upgrades are manual and deliberate.

### Confirmation

`test_science_regressions.py::TestTranslationInvariance` (offsets 0, −10, +100 Å; |ΔE|, |ΔF| < 1e-6); CI installs the hashed lock.

## History

2026-11-01 (D83, D88): "the image is reproducible" was not yet true. The base was
a floating tag, `pip install --upgrade pip` ran unpinned, and the two sdist-only
pins (bibtexparser, python-hostlist) were built under build isolation with a
setuptools fetched unhashed. Now:

* the base image is pinned by digest and pip is not upgraded;
* everything installs with `--only-binary=:all:` except those two named sdists,
  which build with `--no-build-isolation` against `build-requirements.lock.txt`
  (setuptools pinned by hash), so a new sdist fails the build;
* no compiler is in the image;
* CI recompiles both locks with uv 0.11.6 and fails on a diff, so the index lines
  `pip` needs for `torch==2.10.0+cpu` cannot be dropped by a hand regeneration (D31);
* docker-smoke runs MACE-MPA-0 inside the image with no network against
  `test_scripts/golden_energies.json`.

## More information

* mace-api/requirements.in
* mace-api/requirements.lock.txt
* mace-api/build-requirements.in, mace-api/build-requirements.lock.txt
* mace-api/Dockerfile
* mace-api/prefetch_checkpoints.py
