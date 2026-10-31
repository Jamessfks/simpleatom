---
status: accepted
date: 2026-08-09
decision-makers: Zicheng Zhao
---

# 0008 — Results are self-describing through an allow-listed params echo

## Context and problem statement

The validator's model-aware energy bounds never fired because results did not say which model produced them, and the UI displayed form state as "what ran" — a single-point showed eight MD parameters.

## Decision outcome

`_build_result()` echoes the *effective* parameters — defaults resolved, CUDA→CPU fallback applied, dispersion reported only if a D3 calculator was really built, precision read off the model, the seed, upstream's model key and the licence — as `result.params`, from an explicit allow-list. The raw request dict is never reflected back.

### Consequences

* Good, because A shared result carries enough to be re-run and to be judged by the right convention.
* Bad, because every new parameter must be added to the echo deliberately.

### Confirmation

`test_provenance.py` (manifest/params tests); `test_science_regressions.py::test_mpa0_is_the_default_and_its_checkpoint_matches_the_pin` reads `params.upstreamModel`.

## More information

* mace-api/calculate.py _build_result()
* c27e0c9
* c2eb6c9
* bc6726f
