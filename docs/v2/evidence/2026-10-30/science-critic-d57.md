# science-critic: D57 periodic catalog fix (commit 31a20f1)

## Environment
- Python 3.11.15, ase 3.27.0, numpy 2.4.2, torch 2.10.0, mace-torch 0.3.16
- Apple M4 Pro, CPU. torch threads set to OMP_NUM_THREADS = 1 and 2 (separate runs); 3 repeats each
- Checkpoint ~/.cache/mace/macempa0mediummodel sha256 75428afe3a1d7d8062e19bcaabd5c433623cabf308242ec9fb493e38604fb638
  = contract.json MACE-MPA-0/medium = CLI provenance.model.checkpoint.sha256
- Scripts (scratchpad/critic-d57/): catalog_parse.py (stdlib `re` text parser of lib/mlpeg-catalog.ts),
  geom.py, slabmap.py, energy.py, slab_energy.py. Outputs: geom.out, slabmap.out, energy_t1.out,
  energy_t2.out, slab_energy.out, cli_*_t{1,2}.json. Imports checked with `grep -nE '^(from|import) '`:
  only os/sys/io/itertools/re/json/platform/subprocess/hashlib, numpy, torch, ase, mace, and the local parser.
  Nothing from mace-api/, test_scripts/ or lib/. The repo test was not run or relied on.

## Verdict on the D57 claim: CONFIRMED
No disagreement with any D57 claim. The disagreements below concern entries D57 left alone, plus metadata.

### Geometry (geom.py, slabmap.py)
| entry | N (meta) | V/atom Å³ (ref) | NN Å (ref) | coordination | same crystal as ASE ref |
|---|---|---|---|---|---|
| si-diamond | 8 (8) | 20.0129 (20.0129) | 2.3513 (2.3513) | all 4, angles 109.4712° | yes: translation+permutation map onto bulk('Si','diamond',5.43,cubic=True) within 2e-3 Å; ≤5 Å pair spectrum identical to the FCC 2-atom primitive cell |
| c-diamond | 8 (8) | 5.6731 (5.6731) | 1.5446 (1.5446) | all 4, angles 109.4712° | yes (same tests, a = 3.567) |
| cu-fcc | 4 (4) | 11.8104 | 2.5562 | 12 | yes |
| nacl-rocksalt | 8 (8) | 22.4258 | 2.8200 | 6 | yes (species-aware mapping) |
| fe-bcc | 2 (2) | 11.8200 | 2.4855 | 8 | yes |
| si-111 | 4 (4) | n/a | 2.3513 | [3,4,4,3] bottom→top; every angle 109.471° | yes: exactly layers 1–4 of diamond111('Si',(1,1,12),a=5.43), same orientation, within 2e-3 Å |
| cu-111 | 3 (3) | n/a | 2.5555–2.5560 (ideal 2.5562) | [9,12,9] | yes only to 1e-3 Å (fails at 5e-4 Å), see D1 |

si-111 detail: |a1| = |a2| = 3.839590 (a/√2 = 3.839590), γ = 60°. dz = [0.783753, 2.351259, 0.783753] Å
(a/(4√3) = 0.783753, a√3/4 = 2.351259). Stacking bottom→top B C | C A, which is valid diamond (111)
stacking. Vacuum is 21.08 Å inside the 25 Å cell. Note that ASE's own diamond111('Si',(1,1,4)) is a different
termination: coordination [1,4,4,1], cut through the vertical bonds. The catalog uses the standard
one-dangling-bond termination. For the record, the old si-111 had dz [1.246, 1.892, 1.246], ABAB stacking,
NN 2.543 Å and coordination [3,3,3,3]: not diamond.
For the record, the old 2-atom cubic cells gave coordination 1 (isolated dimers) and V/atom 80.05 (Si) or 22.69 (C) Å³.

### Energies, MACE-MPA-0 medium (energy.py). Tolerance = max(5×spread, 64·eps·|E|)
Repeat spread was 0 in every case, and threads 1 and 2 matched bitwise. As spread I used the
"representation spread": the same catalog cell translated by 10 and 100 Å, permuted, and randomly rotated
(QR of a seeded numpy matrix).
| dtype | system | catalog E/atom eV | ASE cubic (8) Δ | FCC-prim (2) Δ | prim 2×2×2 (16) Δ | spread / tol | old 2-atom cubic |
|---|---|---|---|---|---|---|---|
| f64 | Si | −5.4123823136 | 0 | 0 | +8.9e-16 | 1.8e-15 / 7.7e-14 | −2.757924 (Δ +2.6545) |
| f32 | Si | −5.4123821259 | 0 | −2.86e-6 | 0 | 1.4e-6 / 4.1e-5 | −2.757931 (Δ +2.6545) |
| f64 | C | −9.0811746926 | 0 | 0 | 0 | 3.6e-15 / 1.3e-13 | −4.774983 (Δ +4.3062) |
| f32 | C | −9.0811748505 | 0 | +9.5e-7 | −9.5e-7 | 1.9e-6 / 6.9e-5 | −4.774982 (Δ +4.3062) |
All of these pass. This confirms the old value of −2.758 eV/atom. All E/atom values fall inside the MP "typical" range of −15 to −1.

### SimpleAtom CLI (mace-api/calculate_local.py, '{"modelType":"MACE-MPA-0","modelSize":"medium"}', threads 1 and 2 identical)
- si-diamond: E = −43.29905700683594 eV → −5.412382125854 eV/atom, params.precision float32. Matches my float32 value (Δ < 1e-10).
  Pressure 1.85245 GPa, stress [−1.85245, −1.85243, −1.85246, 5e-5, 2e-5, 2e-6] GPa. My float32 gives 1.85245.
- c-diamond: −9.081174850 eV/atom (mine: −9.0811748505). si-111: −4.961123943 (mine: −4.9611239433).
- The float32 dtype is recorded in params and named in warnings.

### Forces and stress on the ideal cells
- Bulk catalog cells: max|F_i| ≤ 6.5e-15 eV/Å (f64) and ≤ 1.3e-5 eV/Å (f32).
- Stress is hydrostatic. Off-diagonals are ≤ 9e-14 GPa (f64) and ≤ 5e-5 GPa (f32).
- f64 analytic stress agrees with numerical stress (d = 1e-5) to ≤ 6.8e-10 eV/Å³ for si-diamond, c-diamond and fe-bcc.
- Rotation covariance: max|Q σ Qᵀ − σ_rot| ≤ 2.2e-15.
- The raw 3×3 stress (captured before Voigt symmetrisation) is exactly symmetric. That holds by construction:
  mace/modules/utils.py:96 symmetrises the displacement. So the symmetry check carries no information;
  the hydrostatic form and the agreement with numerical stress do.
- f64 pressures at the catalog lattice constants: Si 1.852, C 3.340, Cu 2.802, NaCl 0.873, Fe 1.435 GPa.
- si-111 in-plane forces are 1e-6 eV/Å (6-dp rounding). Fz bottom→top is [−0.190, −0.222, +0.222, +0.190] eV/Å
  (unrelaxed slab, symmetric about the centre). E/atom is within 1.8e-8 of the exact slab.

## DISAGREEMENTS (minor, none caused by D57)
1. **cu-111 is "claimed correct" but is the ideal slab rounded to 3 dp.** a2 = (1.278, 2.213) where the ideal is (1.278096, 2.213726).
   This gives |a2| = 2.55551 against |a1| = 2.55600 (ideal 2.556191) and γ = 59.9937°, which breaks the 3-fold symmetry.
   Recomputed (f64, slab_energy.py) against the exact fcc111(1,1,3,a=3.615) slab at the same c = 20 Å:
   - in-plane forces: 2.6e-4 eV/Å, against 4e-15
   - σxx−σyy: 1.04e-2 GPa, against 1e-13
   - σyz: 1.55e-3 GPa, against 0
   - E/atom: −3.8117152420, against −3.8116444488 (Δ −7.1e-5 eV/atom)
   - surface Fz: ±0.01131 eV/Å, against ±0.00953
   Every delta is well above tol = 64·eps·|E| ≈ 5e-14, because f64 spread = 0. Fix: regenerate the entry at 6 dp with ase.build.fcc111.
2. **Both slabs declare pbc="T T T", so the app reports a vacuum-padded stress and pressure for them.**
   The CLI gives si-111 pressure −0.14604 GPa and stress [0.537, 0.537, −0.635, …] GPa. I computed cu-111 at −0.475 GPa.
   mace-api/calculate.py:489–494 says a slab's stress is a padding-box artefact and must not be reported (D6).
   With pbc="T T F", energies and forces are identical (Δ = 0 for both slabs, slab_energy.py), and the backend would then suppress the stress.
3. **The cu-111 comment says "20 Å vacuum".** The cell height is 20 Å; the vacuum gap is 15.83 Å.
4. **si-diamond's reference latticeConstant is 5.431 Å, while the cell uses 5.43 Å** (Δ 0.001 Å). It is harmless as an
   experimental reference, but the leaderboard displays it beside a result computed at 5.43. Every other entry matches its cell exactly.
5. **Scope caveat, not an error.** The slabs are 2 bilayers (Si) and 3 layers (Cu), unrelaxed, with no bulk-like interior.
   The "Surfaces" category text says "surface energy benchmarks", which these slabs cannot give converged values for.

## UNVERIFIED
- The experimental reference values (Kittel and CRC lattice constants and cohesive energies) were not fetched this session.
- The space group was not computed (spglib is not allowed). Crystal identity rests on explicit translation+permutation
  mapping onto ASE references and on matching ≤5 Å pair-distance spectra.
- The hosted Space (2 vCPU, Linux) was not run. Threads 1 and 2 were tested locally on macOS.
- test/mlpeg-catalog.test.ts was not run, as instructed.
