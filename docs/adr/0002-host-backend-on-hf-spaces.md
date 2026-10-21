---
status: accepted
date: 2026-02-27
decision-makers: Zicheng Zhao
---

# 0002 — Host the backend on Hugging Face Spaces, deployed only by CI

## Context and problem statement

The backend needs a container with PyTorch and enough RAM for MACE models; a free tier was required. Railway builds timed out (28510f5). For a month in 2026 production ran code from an unmerged branch, because the Space could also be written by hand-pushes and the deploy workflow copied a hand-written file list (it never shipped `smiles_to_xyz.py`, and once shipped `calculate.py` without `provenance.py`, leaving the Space in RUNTIME_ERROR for 13 days).

## Decision outcome

Host on a Hugging Face Docker Space (cpu-basic). The Space is written **only** by `.github/workflows/deploy-hf-space.yml`, called from CI after every gate passes on `main` (ADR-0026). `scripts/stage-hf-space.sh` stages every tracked file under `mace-api/` (tests excluded) plus `test_scripts/validate_calculation.py` and a `GIT_COMMIT` file, and the workflow mirrors that tree with `rsync --delete`, then waits until `/health` reports the pushed SHA.

### Consequences

* Good, because the Space is exactly the backend at the deployed commit — no more, no less.
* Good, because A deploy that did not take effect fails the job instead of passing silently.
* Bad, because the Space's flat build context means files from elsewhere in the repo must be staged explicitly.

### Confirmation

CI `python-unit` checks the staged tree contains every backend module; `docker-smoke` builds it and asserts `/health.gitCommit == $GITHUB_SHA`.

## History

Supersedes Railway hosting (removed in 28510f5 after repeated build timeouts).

## More information

* scripts/stage-hf-space.sh
* .github/workflows/deploy-hf-space.yml
* 1b279ed (D2)
* ffd8671 (D3)
