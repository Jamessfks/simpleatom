---
status: accepted
date: 2026-08-09
decision-makers: Zicheng Zhao
---

# 0006 — Optimise with BFGS only, positions only, and always report convergence

## Context and problem statement

The docs advertised a FIRE optimiser that was never wired up, and `BFGS.run()`'s convergence boolean was discarded, so a run that exhausted `maxOptSteps` was reported as "completed".

## Decision outcome

Geometry optimisation uses ASE's BFGS on atomic positions only (no cell). `converged`, `optSteps` and `finalFmax` are recorded in `params`, at the top level and in the message (the message survives PDF export and MACE Link). A run stopped by the deployment's time budget is reported as not converged with `stoppedEarly`. Trajectory frames are recorded once per step — ASE already calls observers at step 0.

### Consequences

* Good, because no result can claim a relaxed minimum it did not reach.
* Bad, because no cell relaxation yet (FrechetCellFilter) — a known gap, not a hidden one.

### Confirmation

`test_science_regressions.py::test_d5_geometry_opt_records_each_step_once`; the validator's ethanol optimisation test.

## More information

* mace-api/calculate.py _run_geometry_opt()
* CLAUDE.md Geometry Optimization
