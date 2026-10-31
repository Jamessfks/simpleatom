---
status: accepted
date: 2026-09-11
decision-makers: Zicheng Zhao
---

# 0019 — Read structures so periodicity survives; compare like with like

## Context and problem statement

Three bugs crossed conventions silently: `.xyz` was read with ASE's plain reader, discarding `Lattice=` (copper came out at −0.93 instead of −4.08 eV/atom); CIF fractional coordinates were never multiplied through the cell (silicon nearest neighbour 0.433 Å instead of 2.3516 Å); and the foundation-model comparison picked its baseline by matching the *filename* against "off" (D1).

## Decision outcome

`.xyz`/`.extxyz` are read as extended XYZ (falling back to plain XYZ with a warning); bare POSCAR/CONTCAR are VASP; the first frame of a multi-frame file is computed, matching the preview (D16). Comparison baselines come from the parsed structure (`foundationModelFor()`), never from a name. A structure with a defined cell must come back periodic, or the benchmark rejects the result.

### Consequences

* Good, because A crystal is never computed as a gas-phase cluster without saying so.
* Bad: none recorded.

### Confirmation

`test/parse-structure.test.ts` (TypeScript parser: silicon NN 2.3516 Å); daily gate `fixture:silicon` (ASE); `test_science_regressions.py::test_d16_multiframe_file_computes_the_first_frame`.

## More information

* mace-api/calculate.py detect_format(), _read_structure()
* lib/model-domain.ts
* 88aa676
* 2698662
