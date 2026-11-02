# Structure audit findings: snapshot `audit-next-feature` @ 9bc7e73

- **Method:** run by an independent harness, everything executed.
- **Saved by:** the orchestrator, from the auditor's hand-back. The auditor's own Write call was refused.
- **Where everything lives:** paths below are relative to `review-src`. Raw evidence is in this directory (`raw/`, `parser/`, `extra_checks.json`, `energy_band_probe.json`, `mp_fe_distortion.json`, `adversarial/`), and the per-structure table is `matrix.md`.

**Scope:**
- 79 structures:
  - 14 catalog entries
  - 13 MP entries × (CIF + XYZ)
  - 3 demo files and the hero molecule
  - 10 SMILES examples and 10 converter-test SMILES
  - 9 test-script structures
  - 6 variants that differ on `main`/`v2.2`
- 32 adversarial parser cases.
- About 1,788 counted checks. Everything ran in float64, and the checkpoint SHA-256s matched the contract pins.

## Findings

### F1 HIGH (CRITICAL while `main` is live): non-diamond "diamond" crystals and a mis-stacked Si(111) in `main` and `v2.2`

- **Where:** `main:lib/mlpeg-catalog.ts:128/208/428`, and the same lines in `v2.2`. Fixed in the snapshot (`:129/216/444`, D57).
- **Evidence:**
  - spglib finds space group 166 at every symprec, CN = [1], 80.05 Å³ per atom.
  - With MACE-MP-0, energy per atom is −2.7996 vs −5.3411 for Si, −4.9443 vs −9.0745 for C, and −4.7268 vs −5.0389 for si-111.
  - main's si-111 relaxes by −1.154 eV.
- **Fix:** deploy D57. **Merging #19 (v2.2) alone does not fix this; #20 is required.**
- **Test:** on the deployed branch, assert the expected space group at symprec 1e-3, the conventional and primitive atom counts, and per-atom CN for every bulk entry.

### F2 HIGH: a PDB `CRYST1 1.000 1.000 1.000 90 90 90 P 1` placeholder is computed as a periodic 1 Å cell (= D89)

- **Where:**
  - `mace-api/calculate.py:338,783` has no cell sanity guard.
  - `lib/parse-structure.ts:428` ignores CRYST1.
  - `run-ledger.tsx:155` says "isolated".
- **Evidence:** water comes out periodic (TTT) with a minimum-image distance of 0.480 Å and E = +3.87e15 eV, against −2081.121 eV when isolated.
- **Fix:** treat 1/1/1/90/90/90 (or volume below about 2 Å³/atom) as no cell, and warn. Refuse any periodic cell whose minimum-image distance is below 0.5 Å.
- **Test:** the placeholder fixture gives pbc False and the same energy as the XYZ read (to 1e-6); a real 20 Å CRYST1 stays periodic.

### F3 HIGH: non-canonical-case CIF type symbols are read as the wrong element

- **Where:**
  - `calculate.py:783` has no element check after reading.
  - The client keeps the raw string (`parse-structure.ts:350`).
  - The same holds in `main` and `v2.2`.
- **Evidence:** ASE maps CL→C, NA→N, FE→F, SI→S, CU→C, CO→C, HO→H and BR→B. AU raises KeyError, and "cl" raises AttributeError. Upper-case NaCl becomes N4C4, with E/atom −2.6866 instead of −3.3842.
- **Fix:** normalise type symbols (strip charges and digits, capitalise) before reading, and refuse if the element multiset changes.
- **Test:** NA/CL, Na1+/Cl1− and na/cl all give Na4Cl4 with identical energy.

### F4 HIGH: an origin-choice-2 CIF without symmetry operations is expanded with origin-1 operators

- **Where:** `calculate.py:783`.
- **Evidence:** `si_o2.cif` and its `:2` variant both give 16 atoms, a minimum distance of 1.920 Å, E/atom −0.2420 and P = 237.7 GPa. The origin-1 control gives 8 atoms, 2.352 Å and −5.4125.
- **Fix:** refuse an H-M-only CIF for any group with two origin choices, or honour the setting (`read(setting=2)`). Also refuse duplicate or overlapping sites after expansion.
- **Test:** both origin-2 fixtures are either refused or give 8 atoms with NN 2.3517 Å.

### F5 HIGH: partial occupancy is silently made full

- **Where:** `calculate.py:770-806`. The same holds in `main` and `v2.2`.
- **Evidence:**
  - Disordered Cu0.5Au0.5 (`cuau_disorder.cif`) comes out as Au4, with E/atom −2.4007. The occupancy survives only in `atoms.info`.
  - A 25%-occupied site (`cu_vac.cif`) comes out as Cu4, identical to the ordered crystal.
  - The client shows 8 atoms at 0 Å.
- **Fix:** refuse any occupancy ≠ 1.
- **Test:** both fixtures return an error, never success.

### F6 MEDIUM: the converter drops formal charge

- **Where:** `mace-api/smiles_to_xyz.py:43,83`. `test_smiles_to_xyz.py:152` asserts success.
- **Evidence:** `[NH4+]` becomes neutral NH4 with 11 electrons. `DetermineBonds(q=0)` fails, yet MACE-OFF still returns E = −1555.168 eV.
- **Fix:** refuse a non-zero net charge or a radical.
- **Test:** `[NH4+]` raises; a net-zero zwitterion passes.

### F7 MEDIUM: the MACE-OFF energy bands are wrong (extends D52)

- **Where:** `contract.json:320-345`. Consumers: `validate_calculation.py:118-121` (warning text) and `metrics-dashboard.tsx:466,569` (amber warning). `CLAUDE.md` carries the same −100 to −600 band.
- **Evidence** (`energy_band_probe.json`):
  - **Below the enforced −800 floor:** aspirin −841.147 (catalog) and −841.153 (SMILES), CO2 −1711.7, O2 −2046.1, H2O2 −1031.7, HCl −6270.3, CH3Cl −2722.2.
  - **Outside only the typical [−600, −100] band:** water −693.705, water dimer −693.743, demo water −693.707, acetic acid −779.75, alanine −678.13, caffeine −771.94, glucose −779.67, pyridine −614.62, H2 −15.93.
- **Fix:** drop the band, or use a composition-aware band on (E − ΣE0)/N.
- **Test:** no energy warning for any catalog molecule or SMILES example; add HCl and CO2 as regressions.

### F8 MEDIUM: slabs are declared `pbc="T T T"` (= D70)

- **Where:**
  - `lib/mlpeg-catalog.ts:435,452`
  - `calculate.py:552` (stress gate) and `:950` (NPT gate)
  - `parameter-panel.tsx:210,603`
- **Evidence:**
  - cu-111 stress is [0.751, 0.741, −0.067, 0.0015, 0, 0] GPa, with P −0.475. si-111 gives P −0.146.
  - E(TTF) − E(TTT) = 0.
  - Vacuum is 15.83 and 21.08 Å.
  - NPT was not executed.
- **Fix:** write `pbc="T T F"`, and treat vacuum > 8 Å along an axis as non-periodic for stress and NPT.
- **Test:** the surfaces have pbc TTF, vacuum ≥ 10 Å and `stress=None`, and NPT is refused.

### F9 MEDIUM: reference energy and forces are lost on the server (= D91)

- **Where:** `calculate.py:495-520`, consumed by `metrics-dashboard.tsx:173-232`.
- **Evidence:** `info` is `{}`, and `arrays` holds only numbers and positions. The data sit in `calc.results` (`{energy: −12.5, forces}`), so the extracted reference data is `{}`. The client still shows −12.5.
- **Fix:** also read `atoms.calc.results` when a SinglePointCalculator is attached.
- **Test:** an `ase.io.write`-produced fixture round-trips `referenceEnergy` and `referenceForces`.

### F10 MEDIUM: the preview disagrees with what the server computes

`adversarial/` holds the fixtures. All shipped structures agree on species, positions (≤1e-6 Å), cell and pbc.

- **(a) CIF** (`parse-structure.ts:281-375`):
  - Symmetry is not expanded (2 vs 8 atoms). D62 is now fixed by `d0a6f39`; verify it.
  - An aniso loop is parsed as atoms, because the loop state isn't reset at `loop_` (`:315-330`). That gives 16 vs 8 atoms and a false 0.017 Å overlap.
  - Two data blocks are concatenated, using the last block's 4.05 Å cell.
  - Species are shown as C1A, N1x, Fe2+ and O2−.
- **(b) POSCAR** (`:465-515`):
  - Cartesian coordinates aren't scaled (NN 1.176 vs 2.351 Å).
  - A negative scale is used as a multiplier (cell −160.1 Å).
  - Only the first of three scale factors is used (c 5.43 vs 10.86).
  - VASP-4 files give 0 atoms vs 8.
- **(c) Periodicity and distances** (`:135,150,572`):
  - `F F F` plus a Lattice is shown as periodic, and NPT is offered. `T T F` is shown as fully periodic.
  - The preview's minimum distance ignores periodic images. NiTi shows 2.517 vs 2.501, AlTi 2.843 vs 2.811, Fe 2.481 vs 2.478, and 1-atom cells show nothing.
  - A 0.20 Å contact across a boundary is shown as 2.54 Å, so the overlap warning (`structure-info.tsx:155`) never fires.
- **(d) Other:**
  - Two PDB MODELs are concatenated (6 vs 3 atoms). `main` computes the last model, because it lacks `index=0`.
  - FE and CL in PDB and XYZ aren't normalised.
  - An extxyz file with `pos` before `species` gives 0 atoms.
  - `free_energy=` is read as `energy=`.
- **Fix:** feed the preview from one server-side parser, or fix each point above.
- **Test:** a parity test over `adversarial/`.

### F11 LOW: the UFF fallback in the converter is dead code

- **Where:** `smiles_to_xyz.py:69-75,83`.
- **Evidence:** for `OB(O)O` and `CB(C)C`, MMFF returns −1 and UFF returns 0, yet the output equals the raw ETKDG coordinates and is still labelled "MMFF94".
- **Fix:** branch on the return code, and record which force field was actually used.

### F12 LOW: stereo left unspecified is filled arbitrarily (= D109)

- **Evidence:** "Alanine" comes out R (D-alanine), Ibuprofen R, and the glucose anomeric carbon S.
- **Fix:** specify every stereocentre, or report the ones left unassigned.
- **Test:** no `?` centres in any example, and the CIP labels in 3D equal those in the input.

### F13 LOW: rounding-level distortions (extends D71)

- cu-111 has γ = 59.994°, which reads as C2/m at symprec ≤ 1e-4. Its stress has σxx 0.751 vs σyy 0.741 GPa.
- Benzene's C–H bonds are 1.0869 Å ×4 and 1.0880 Å ×2.
- MP Fe reads as Fmmm up to symprec 1e-3 (energy effect +0.023 meV/atom).
- Al3Ni reads as P2₁/m at symprec 1e-5.
- **Fix:** build cells programmatically with ≥ 6 decimals. Symmetrise the MP cells, or document that they aren't.

### F14 LOW: the demo ethanol (also the hero) is strained

- **Evidence:** C–C 1.478 Å, max|F| 2.04 eV/Å. BFGS lowers it by 0.296 eV, with an RMSD of 0.464 Å.

### F15 LOW: a test fixture has a Lattice but no `pbc`

- **Where:** `test_scripts/verify_rms_force.py:59-64`.
- **Evidence:** ASE reads it as periodic, and P = 0.0096 GPa. E and F are unchanged vs the isolated molecule.
- **Fix:** add `pbc="F F F"`.

### F16 LOW: a stale header comment

- **Where:** `lib/mp-reference-data.ts:21-25`, and the generator `fetch_mp_reference.py:282,471`.
- **Evidence:** the header says the `.xyz` is read as plain xyz. In fact each MP XYZ and CIF describe the same structure: |ΔE| ≤ 3.3e-9 eV, Δfrac ≤ 1.8e-9.

### F17 LOW: an unquoted SMILES value is mangled

- **Where:** `smiles_to_xyz.py:83`.
- **Evidence:** extxyz strips the brackets from `SMILES=` in `atoms.info`.
- **Fix:** write `SMILES="…"`.

### Also noted

- `validate_calculation.py:350,365` runs MACE-OFF geometry optimisation in float32, against the float64-for-optimisation rule. Re-check after D38 (`3ee1d64`).
- `main` reads structures without `index=0`, so production computes the last frame of a multi-frame file. D16 is fixed in v2.2.

## Passed

- **Composition:** every formula, atomCount, element list and composition claim matches.
- **Symmetry:** the snapshot's space groups are correct.
- **Molecules:** RDKit reproduces every intended molecule, and all stereo the input specifies is preserved.
- **Optimisation:** all 64 BFGS runs converged, space groups survived relaxation, and no connectivity changed.
- **Invariants** (20 sampled structures):

  | Check | Worst result |
  |---|---|
  | translation, rotation, permutation | \|ΔE\| 7.3e-12 eV (tolerance 2.5e-10) |
  | finite-difference forces | 6.2e-5 eV/Å, within truncation |
  | finite-difference stress | 9.5e-6 GPa |
  | 2×2×2 supercell vs 1×1×1 | ≤ 1.1e-14 eV/atom |
  | net force on molecules | \|ΣF\| ≤ 1.1e-15 |

- **Run-to-run spread:** 0.
- **Formation energies:** MPA-0 matches MP to within 15 meV/atom.

## Not checked

- The catalog's experimental values were not re-fetched; the separate research agent covered those.
- NPT on the slabs was not executed.
- `main`'s server reading path was inspected, not executed.
