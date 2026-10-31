---
status: accepted
date: 2026-08-09
decision-makers: Zicheng Zhao
---

# 0007 — Make molecular dynamics reproducible and its temperature honest

## Context and problem statement

Unseeded MD cannot be verified by anyone. Separately, the reported temperature was wrong twice over: ASE's `get_temperature()` divides by 3N even with the centre-of-mass momentum pinned (D8), and ASE's default `Langevin(fixcm=True)` mass-weights its centre-of-mass correction incorrectly for mixed masses, so NVT on ethanol equilibrated at 417 K for a 300 K target (D18).

## Decision outcome

One `numpy` generator seeded from `params.seed` (default 42) feeds both stochastic sources (Maxwell-Boltzmann and Langevin); the seed is in `params` and the message. COM momentum is removed after the velocity draw without rescaling. NVT uses `Langevin(fixcm=False)`, which thermalises all 3N degrees of freedom; temperatures are reported over 3N for NVT and 3N−3 for NVE and NPT, recorded as `temperatureDegreesOfFreedom`. NPT uses `MelchionnaNPT` with `pfactor = (75 fs)² × 100 GPa`, as ASE documents.

### Consequences

* Good, because same seed → identical trajectory.
* Good, because NVT ethanol now equilibrates at 298.8 K for a 300 K target.
* Bad, because under NVT the molecule's centre of mass now diffuses (physical Brownian motion in the implicit bath).

### Confirmation

`test_science_regressions.py::test_d18_nvt_equilibrates_at_the_target_temperature` and `test_nve_reports_temperature_over_3n_minus_3`; `test_provenance.py::test_md_records_its_seed_in_the_manifest`.

## More information

* mace-api/calculate.py _run_md()
* c27e0c9
* 76febbb
