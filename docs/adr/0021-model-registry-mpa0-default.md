---
status: accepted
date: 2026-10-20
decision-makers: Zicheng Zhao
---

# 0021 — One model registry; MACE-MPA-0 is the materials default

## Context and problem statement

Model metadata was scattered across calculate.py, model-domain.ts, the parameter panel, the validator and the docs, and they disagreed. Upstream made MACE-MPA-0 its `mace_mp()` default in v0.3.10; Matbench Discovery scores it F1 0.852 / MAE 0.028 eV/atom against MACE-MP-0's 0.669 / 0.057. Code and checkpoint are MIT. Newer families (OMAT-0, MATPES, MH-1, OMOL, POLAR-1) are ASL — non-commercial.

## Decision outcome

`mace-api/contract.json` `models[]` is the single registry: id and aliases, loader and upstream model key per size with SHA-256 pin, elements, energy convention, licence and notice, upstream default dtype, D3 availability, benchmark numbers, and whether the hosted instance offers it. **MACE-MPA-0 (medium) is the default** for requests without a `modelType`; MACE-MP-0 stays selectable so earlier results can be reproduced; MACE-OFF (alias MACE-OFF23) results carry its ASL notice in `licenseNotice`. The UI, routes, validator and comparison baseline all read the registry.

### Consequences

* Good, because adding a model is one JSON entry plus a pin.
* Good, because the default is the better-scoring model upstream itself recommends.
* Bad, because results without an explicit `modelType` change from MP-0 to MPA-0 numbers in v2.2.0 (stated in CHANGELOG).

### Confirmation

`test/contract.test.ts` (registry), `test_science_regressions.py::test_mpa0_is_the_default_and_its_checkpoint_matches_the_pin`, `mace-api/prefetch_checkpoints.py` (image build fails on a pin mismatch).

## More information

* mace-api/contract.json
* lib/contract.ts
* Matbench Discovery models/mace/*.yml
