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

## More information

* mace-api/requirements.in
* mace-api/requirements.lock.txt
* mace-api/Dockerfile
* mace-api/prefetch_checkpoints.py
