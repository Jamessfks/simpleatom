# Architecture decision records

Decisions that shape SimpleAtom, in [MADR 4.0](https://adr.github.io/madr/) form ([ADR-0000](0000-record-architecture-decisions.md)). Each record ends with a **Confirmation** naming an executable check — a gate, a test or a guard — that proves the decision still holds.

New decision: copy [`template.md`](template.md) to the next number, and link it here. A reversed decision keeps its file with status `superseded by NNNN`.

| # | Decision | Status | Date |
|---|---|---|---|
| 0000 | [Record architecture decisions as MADR with an executable confirmation](0000-record-architecture-decisions.md) | accepted | 2026-10-20 |
| 0001 | [Run calculations in two modes over one shared engine](0001-dual-mode-execution.md) | accepted | 2026-02-09 |
| 0002 | [Host the backend on Hugging Face Spaces, deployed only by CI](0002-host-backend-on-hf-spaces.md) | accepted | 2026-02-27 |
| 0003 | [The Python backend is the security boundary](0003-backend-is-the-security-boundary.md) | accepted | 2026-08-09 |
| 0004 | [Refuse unsupported requests instead of falling through](0004-refuse-unsupported-requests.md) | accepted | 2026-08-09 |
| 0005 | [Default precision follows upstream; overrides are recorded](0005-precision-follows-upstream.md) | accepted | 2026-08-09 |
| 0006 | [Optimise with BFGS only, positions only, and always report convergence](0006-bfgs-only-report-convergence.md) | accepted | 2026-08-09 |
| 0007 | [Make molecular dynamics reproducible and its temperature honest](0007-reproducible-honest-md.md) | accepted | 2026-08-09 |
| 0008 | [Results are self-describing through an allow-listed params echo](0008-self-describing-results.md) | accepted | 2026-08-09 |
| 0009 | [Attach a reproducibility manifest; never fabricate](0009-reproducibility-manifest.md) | accepted | 2026-08-10 |
| 0010 | [Run the validator on every result, advisory only](0010-advisory-validator.md) | accepted | 2026-08-10 |
| 0011 | [Share results insert-only on Supabase (MACE Link)](0011-insert-only-supabase-sharing.md) | superseded by 0024 | 2026-02-28 |
| 0012 | [Serve embeds at /r/<id>/embed; deny framing elsewhere](0012-embed-route-framing.md) | accepted | 2026-08-10 |
| 0013 | [Keep two 3D viewers: 3Dmol.js and a pinned WEAS](0013-two-3d-viewers.md) | accepted | 2026-02-09 |
| 0014 | [A light, token-driven theme: Fraunces + Inter, Paul Tol data colours](0014-light-token-theme.md) | accepted | 2026-07-11 |
| 0015 | [One chrome width site-wide](0015-one-chrome-width.md) | accepted | 2026-08-10 |
| 0016 | [Judge quality by blind builder/critic rounds against fetched public bars](0016-gauntlet-method.md) | accepted | 2026-08-09 |
| 0017 | [Accumulate daily work on `daily`, never on auto-deploying `main`](0017-daily-branch.md) | accepted, amended by 0027 | 2026-09-11 |
| 0018 | [Scope: MACE potentials only — no electron-density properties, phonons or fine-tuning](0018-scope-mace-only.md) | accepted | 2026-08-09 |
| 0019 | [Read structures so periodicity survives; compare like with like](0019-periodicity-survives-parsing.md) | accepted | 2026-09-11 |
| 0020 | [Unpickle only pinned checkpoints; refuse custom models on the public instance](0020-trusted-checkpoint-loading.md) | accepted | 2026-10-20 |
| 0021 | [One model registry; MACE-MPA-0 is the materials default](0021-model-registry-mpa0-default.md) | accepted | 2026-10-20 |
| 0022 | [One request contract with bounds, shared by Python and TypeScript](0022-shared-request-contract.md) | accepted | 2026-10-20 |
| 0023 | [Long-running calculations are jobs: submit, real progress, cancel](0023-calculations-as-jobs.md) | accepted | 2026-10-20 |
| 0024 | [MACE Link writes go through a validating server route](0024-share-through-a-server-route.md) | accepted | 2026-10-20 |
| 0025 | [Pin the scientific stack exactly; gate upgrades on physics](0025-pin-scientific-dependencies.md) | accepted | 2026-10-20 |
| 0026 | [CI gates every merge; deploys depend on CI](0026-ci-gates-every-merge.md) | accepted | 2026-10-20 |
| 0027 | [Release path: security fixes ship by PR; `daily` is adopted on a cadence](0027-release-path.md) | accepted | 2026-10-20 |
| 0028 | [One documentation source per audience](0028-documentation-architecture.md) | accepted | 2026-10-20 |
| 0029 | [App-surface finish bar: schrodinger.com discipline, landing layout frozen](0029-app-finish-bar.md) | accepted | 2026-10-20 |
