# science-critic: SimpleAtom v2.2.0 golden cases (commit daed8bc)

## Stack, machine, threads, scripts
- Python 3.11.15, ase 3.27.0, numpy 2.4.2, torch 2.10.0, mace-torch 0.3.16 (the pinned venv311). CPU only.
- Machine: Apple M4 Pro, 12 logical CPUs, macOS 15.6.1. `KMP_DUPLICATE_LIB_OK=TRUE`.
- Threads: every recomputation ran at `OMP_NUM_THREADS=1` and `=2`, with `torch.set_num_threads` matched. The printed `torch.get_num_threads()` was 1 and 2.
- Scripts are in `scratchpad/critic/` and were run with `python -I`. Their imports are only the stdlib (sys, os, json, hashlib, subprocess, time, glob, importlib.metadata) plus `numpy`, `torch`, `ase` and `mace.calculators` (`mace_mp`, `mace_off`). The `grep -nE '^(from|import) '` output for each script is in the session log. None imports `mace-api/`, `test_scripts/` or `lib/`.
  - `sp_invariants.py`: single points, stress, finite differences, extensivity, translation and rotation, model E0s. Outputs `sp_t1.json` and `sp_t2.json`.
  - `cif_si_extra.py`: CIF parse and nearest-neighbour distances, rattled-Si covariance in float32 and float64, float64 finite-difference stress. Output `cif_si_extra.json`.
  - `opt_check.py`: final-geometry forces, trajectory bookkeeping (D5), an independent BFGS re-run. Outputs `opt_t1.json` and `opt_t2.json`.
  - `md_run.py`: independent NVE, NVT and NPT runs (plus `launch_md.sh` and `launch_md2.sh`). `md_analyze.py` and `md_replicas.py` compute the statistics. Outputs `md_*_s42_t{1,2}.json`, `extra/`, `md_stats.json`.
  - `band_check.py`: MACE-OFF E/atom against the contract bands (CO2, CH3Cl, water).
  - SimpleAtom's CLI was run only to reproduce claims or probe parameter handling, never as the recomputation. Results are in `critic/sa_cli/*.json`.

## Checkpoints (rule 2)
I logged every path `torch.load` opened and hashed that file.
| Model | File loaded | SHA-256 (mine) | Manifest | Match |
|---|---|---|---|---|
| MACE-OFF small (`mace_off("small")`) | ~/.cache/mace/MACE-OFF23_small.model | 165cce4c…c46f | 165cce4c…c46f | yes |
| MPA-0 medium (`mace_mp("medium-mpa-0")`) | ~/.cache/mace/macempa0mediummodel | 75428afe…b638 | 75428afe…b638 | yes |
| MP-0 medium (`mace_mp("medium")`) | ~/.cache/mace/20231203mace128L1_epoch199model | 01bfe221…5845 | 01bfe221…5845 | yes |
The loaded model dtype (`next(calc.models[0].parameters()).dtype`) equalled `result.params.precision` in every case.

## Noise and tolerance
- SimpleAtom's own noise files give a spread of 0.0 for every single-point and opt quantity: n=6, or n=5 for MPA-0, where one run failed on "No usable temporary directory", an environment error.
- My runs, 3 repeats × {1, 2} threads, are bitwise identical (spread 0, n=6).
- MD: SimpleAtom's run (2 threads), mine at 1 thread and mine at 2 threads give identical statistics to every printed digit (n=3).
- So the tolerance is the 64·eps·|value| floor: eps = 1.19e-7 for float32, 2.22e-16 for float64. MD is judged on block-averaged standard errors instead.

## Per-case results
Δ = SimpleAtom − independent. Spread(n) is the measured run-to-run spread over n runs.

### sp_ethanol_off (MACE-OFF small, float64)
| Quantity | SimpleAtom | Independent | Δ | Tol | Spread(n) | Verdict |
|---|---|---|---|---|---|---|
| E (eV) | -4221.322391557846 | -4221.322391557846 | 0 | 6.0e-11 | 0 (6) | PASS |
| E/atom (eV) | -469.03582128420504 | -469.03582128420504 | 0 | 6.7e-12 | 0 (6) | PASS (inside typical −600…−100) |
| max\|F\| (eV/Å) | 2.004692023917517 | 2.004692023917517 | 0 | 2.9e-14 | 0 (6) | PASS |
| RMS F, √(Σ\|F\|²/N) | 0.8946566470917521 | 0.8946566470917522 | 1e-16 | 1.3e-14 | 0 (6) | PASS (the /3N formula would give 0.5165; SimpleAtom uses /N) |
| \|ΣF\| (eV/Å) | 3.33e-16 | 3.33e-16 | 0 | ≈0 | 0 (6) | PASS |
| forces, per component | — | — | max 0.0 | — | 0 | PASS |
| translation by 10 / 100 Å: ΔE; max ΔF | — | 0.0 / 0.0; 2.6e-14 / 4.2e-13 | — | eps64·100 Å·k ≈ 1e-12 | 0 | PASS |
| rotation (QR of rng(0), det +1): ΔE; covariance residual | — | 0.0; 2.2e-14 (an unrotated F would give 1.48) | — | 2.9e-14 | 0 | PASS |

### sp_water_off (MACE-OFF small, float64)
| Quantity | SimpleAtom | Independent | Δ | Tol | Spread(n) | Verdict |
|---|---|---|---|---|---|---|
| E (eV) | -2081.120942958373 | -2081.120942958373 | 0 | 3.0e-11 | 0 (6) | PASS |
| E/atom | -693.7069809861242 | -693.7069809861242 | 0 | 9.9e-12 | 0 (6) | Number PASS. It sits outside contract `off.typical` (−600…−100), so the UI shows a warning on a correct number. See D1 |
| max\|F\| / RMS | 0.07008782727238579 / 0.0572305589670178 | same | 0 | 1e-15 | 0 (6) | PASS |
| \|ΣF\| | 3.1e-17 | 3.1e-17 | 0 | ≈0 | 0 | PASS |
| translation 10 / 100 Å; rotation | — | ΔE 0, ΔF ≤ 1.2e-13; ΔE 0, covariance residual 8.5e-15 | — | — | 0 | PASS |

### sp_si_mpa0 (MPA-0 medium, float32; public/demo/silicon.cif)
| Quantity | SimpleAtom | Independent | Δ | Tol | Spread(n) | Verdict |
|---|---|---|---|---|---|---|
| E (eV) | -43.299949645996094 | -43.299949645996094 | 0 | 3.3e-4 | 0 (6) | PASS |
| E/atom | -5.412493705749512 | same | 0 | 4.1e-5 | 0 | PASS (typical −15…−1) |
| max\|F\| / RMS | 7.76e-6 / 6.33e-6 | same | 0 | float32 noise | 0 | PASS. Zero by symmetry |
| stress, Voigt (GPa) | [-1.8060235, -1.8060246, -1.8060218, 3.4e-6, 3.1e-6, 5.1e-6] | identical | 0 | 1.4e-5 | 0 | PASS |
| symmetry, Voigt order | — | \|σ−σᵀ\| = 0. ASE Voigt equals [xx,yy,zz,yz,xz,xy] built by hand (Δ 0) | — | — | — | PASS |
| pressure (GPa) | 1.8060232400894165 | 1.806023359298706 (−tr/3 in float64) | -1.2e-7 | 1.4e-5 | 0 | PASS |
| sign (ASE: positive = tensile) | compressive | +1 % expansion lowers E by 13.9 meV. FD σxx in float64 = −1.805858 vs analytic −1.805845 GPa | 1.3e-5 | O(h²) | — | PASS |
| eV/Å³ → GPa | ÷ units.GPa | units.GPa = 0.006241509125883258 eV/Å³ | — | — | — | PASS |
| extensivity: E(2×2×2) − 8E; E(conventional) − 4E(primitive) | — | 0.0; 0.0 | 0 | 2.6e-3 | 0 | PASS |
| translation 10 / 100 Å, unwrapped | — | ΔE −3.8e-6 / −1.9e-5; ΔF ≤ 4.4e-5 | — | 3.3e-4 | 0 | PASS |
| rotation, rattled cell (σ = 0.05 Å, rng 1) | — | float32: ΔE 3.8e-6, F residual 1.4e-5 (unrotated: 1.28), σ residual 1.6e-5 GPa. float64: 2e-14 | — | 3.3e-4 / float32 | 0 | PASS |
| float32 vs float64 (information only) | — | E differs by 1.8e-5 eV, P by 1.8e-4 GPa | — | — | — | — |

### sp_si_mp0 (MP-0 medium, float32)
| Quantity | SimpleAtom | Independent | Δ | Tol | Spread(n) | Verdict |
|---|---|---|---|---|---|---|
| E (eV) | -42.72925567626953 | same | 0 | 3.3e-4 | 0 (6) | PASS |
| E/atom | -5.341156959533691 | same | 0 | 4.1e-5 | 0 | PASS |
| stress (GPa) | diagonal −1.05139, off-diagonal ≤ 1.4e-6 | identical | 0 | 8e-6 | 0 | PASS |
| pressure (GPa) | 1.0513944625854492 | 1.0513944625854492 | 0 | 8e-6 | 0 | PASS |
| FD tr σ (float32) | — | −3.1516 vs analytic −3.1542 | 0.08 % | float32 FD | — | PASS (sign correct) |
| E(2×2×2) − 8E | — | 6.1e-5 eV | — | 2.6e-3 | 0 | PASS |
| invariants | — | ΔE ≤ 3.8e-6, ΔF ≤ 3.3e-5 | — | 3.3e-4 | 0 | PASS |

### silicon.cif parsing (task 3)
`ase.io.read` returns 8 atoms. Every nearest-neighbour distance is 2.351648682706454 Å, which is exactly a·√3/4, and every atom has coordination 4 within 2.4 Å. SimpleAtom's lattice and positions match ASE's parse with a 0.0 Å deviation (order-independent fractional match). PASS. One nit: the CIF header comment says "2.3517 A", but a·√3/4 = 2.351649 rounds to 2.3516.

### opt_ethanol_off (BFGS, fmax 0.01, float64)
| Quantity | SimpleAtom | Independent | Δ | Tol | Spread(n) | Verdict |
|---|---|---|---|---|---|---|
| final E (eV) | -4221.6023184968335 | -4221.6023184968335 | 0 | 6.0e-11 | 0 (6) | PASS |
| final max\|F\| (eV/Å) | 0.009225306843237297 | 0.009225306843237297 at the claimed geometry | 0 | 1.3e-16 | 0 | PASS: below 0.01, so converged=true is correct |
| independent BFGS re-run | 61 steps, converged | 61 steps, converged. E identical, fmax 0.00922530684367625, positions within 5.0e-13 Å | 4.4e-16 | float64 accumulation over 61 steps | — | PASS |
| D5 frame bookkeeping | 62 frames, steps 0…61 | frame 0 = input (0.0 Å), frame 1 − frame 0 = 0.024 Å, no consecutive duplicate frames, last frame = final geometry, every frame's E recomputes exactly (max Δ 0) | — | — | — | PASS. D5 is fixed |
| monotonicity | — | one rise, step 24→25, +5.77 meV, against a total drop of 279.9 meV. Plain ASE BFGS reproduces it | — | noise 0 | — | Noted. This is BFGS behaviour, not a SimpleAtom defect |

### md_nve_ethanol (VelocityVerlet, 0.5 fs, 2000 steps, seed 42)
| Quantity | SimpleAtom | Independent | Δ | Tol | Spread(n) | Verdict |
|---|---|---|---|---|---|---|
| drift, linear fit (eV/atom/ps) | not reported. Message says "drift +0.0009 eV" (last − first) | −5.16e-6 (claimed trajectory and mine are identical) | — | — | 0 (3) | Conservation PASS. The label is wrong: see D4 |
| σ(E_tot) / peak-to-peak | — | 0.39 meV / 1.78 meV | — | — | 0 | PASS |
| DOF | 24 (3N−3) | 24. COM KE after Stationary is 1e-29 eV | 0 | — | — | PASS |
| mean T | 221.6 K (all frames) | 220.8 ± 7.9 K after 20 % | — | — | 0 | Consistent. NVE does not target 300 K: the 9-atom MB draw gave 190 K at frame 0 (force_temp False), and the 0.477 eV excess above the minimum predicts about 230 K at equipartition |
| T array = 2KE/(dof·kB); E_tot = PE + KE | — | max Δ 0.0; 4.5e-13 | — | — | — | PASS |

### md_nvt_ethanol (Langevin 300 K, 0.01/fs, 0.5 fs, 4000 steps, stride 2, seed 42)
| Quantity | SimpleAtom | Independent | Δ | Tol | Spread(n) | Verdict |
|---|---|---|---|---|---|---|
| ⟨T⟩ (3N = 27 DOF), first 20 % discarded | 290.18 ± 18.6 K (from its trajectory) | 290.21 ± 18.6 K (mine, every step) | 0.03 | 2·SE = 37 K | 0 (3) | PASS: −0.53 SE from 300 K |
| ⟨T⟩ as reported | "299.1 K" (all frames including the warm-up from 169 K, no SE) | — | — | — | — | See D5 |
| DOF 3N justified (fixcm=False) | 27 | ⟨KE_com⟩/(1.5 kT) = 0.88 after 20 %, so the COM mode is thermalised | — | — | — | PASS |
| σ_T against canonical | — | 87.6 K vs 300·√(2/27) = 81.6 K | ratio 1.07 | — | — | PASS |
| 5 seeds (42–46) | — | 290.2, 279.4, 295.8, 317.8, 308.2 → 298.3 ± 6.7 K | — | — | — | PASS |
| D18 check, fixcm=True with seed 42 | — | 430.9 ± 11.7 K (3N−3). The code comment says 417 K | — | — | — | D18 confirmed: fixcm=False is right |
| same rng feeds MB and Langevin; fixcm=False | calculate.py:1256, 1299 | code-read and reproduced by execution | — | — | — | PASS |

### md_npt_si (MelchionnaNPT, MPA-0 float32, 300 K, 0 GPa, 1 fs, 500 steps, seed 42)
| Quantity | SimpleAtom | Independent | Δ | Tol | Spread(n) | Verdict |
|---|---|---|---|---|---|---|
| pfactor | built from nptBarostatTimeFs 75 and nptBulkModulusGPa 100 (calculate.py:1308). The number itself is not recorded | (75·units.fs)²·(100·units.GPa) = 33.874542 ASE units, matching the ASE docstring "ptime^2 * B" | — | — | — | PASS |
| ttime | 25 fs | 25·units.fs | — | — | — | PASS. DOF 21 matches ASE's desiredEkin = 1.5(N−1)kT |
| cell fully periodic | pbc TTT (NPT refuses anything else) | TTT | — | — | — | PASS |
| final V (Å³), final virial P (GPa) | 161.97877407513522 / 0.30311813950538635 | identical | 0 | 1.2e-3 / 2e-6 | 0 (2) | PASS |
| ⟨V⟩, ⟨P_total⟩ over the last half (500 steps) | not reported | 163.58 Å³; 0.025 ± 0.48 GPa | — | — | — | Sane |
| 4 ps run (4000 steps), after 20 % | — | ⟨T⟩ 300.3 ± 10.6 K. ⟨P_total⟩ 0.041 ± 0.041 GPa. ⟨V⟩ 163.23 ± 0.08 Å³ (a = 5.465 Å). σ_V 2.71 Å³ vs √(kTV/B) = 2.60 Å³ for B = 100 GPa | — | — | — | Barostat PASS |
| σ_T against canonical | — | 248 K at 0.5 ps and 210 K at 4 ps, vs 300·√(2/21) = 92.6 K (2.3–2.7×). T ranges 34–1064 K | — | — | — | FLAG, see D6 |
| ⟨T⟩ as reported | "308.4 K" (all frames, no SE) | 317.9 ± 74.6 K after 20 % | — | — | — | within SE. See D5 |

## Units chain (task 6)
The trace runs from engine to `_build_result` to JSON to UI label.
- **Energy:** `get_potential_energy()` (eV) → `energy`, shown in the UI as "eV" and "eV/atom". OK.
- **Forces:** eV/Å → `forces`. The UI shows max and RMS in "eV/Å". `lib/utils.ts computeRmsForce` uses /N. OK.
- **Positions and volume:** Å and Å³ → "Å³". OK.
- **Stress:** `get_stress(voigt=True)/units.GPa` gives `properties.stress` in GPa, Voigt xx,yy,zz,yz,xz,xy (calculate.py:498). Pressure is −mean(diagonal) (line 500). `types/mace.ts:143-149` says GPa. OK. Stress and pressure are not rendered anywhere in `components/` or `app/`. They appear only in the raw JSON, and `app/docs/units/page.tsx:57-58` documents stress as eV/Å³ (D9).
- **Input pressure:** GPa × units.GPa → externalstress in eV/Å³. OK.
- **Timestep:** fs × units.fs. OK.
- **Friction:** 1/fs ÷ units.fs, which converts to 1/ASE-time. OK.
- **Temperature:** 2KE/(dof·units.kB), with dof recorded (3N−3 for NVE/NPT, 3N for NVT). The UI labels it "K". OK. Every reported T equals 2KE/(dof·kB) exactly.
- **Trajectory x-axis:** labelled "MD Step" or "Step", not time. With a 0.5 fs step this is correct as labelled, and stride-2 frames carry their true step numbers.
- **Energy charts:** "Energy (eV)". The total, potential and kinetic arrays are self-consistent (≤ 4.5e-13 eV).

No engine-to-UI unit conversion is missing. The problems are definitional or in the docs: D4, D5, D7, D9.

## DISAGREEMENTS
1. **D1: MACE-OFF energy bands in `contract.json` → `energyConventions.off` are wrong, not the numbers.**
   - Water: claimed −693.7069809861242 eV/atom, recomputed the same (Δ 0, tolerance 9.9e-12). It falls outside `typical` (−600…−100), so the UI shows "outside typical −600 to −100 eV/atom" on the shipped demo (metrics-dashboard.tsx:563-569).
   - CO2: I computed −1711.668 eV/atom. SimpleAtom's validator gives the same number and warns "Energy/atom = -1711.6676 eV/atom is unusually low (< -800 eV/atom for MACE-OFF). Check structure."
   - Evidence: the model's own free-atom E0s (H −13.572, O −2043.934, Cl −12522.649, Br −70045.284 eV) put the free-atom sum alone at −690.36 eV/atom for water, −1706.15 for CO2 and −2718.79 for CH3Cl.
   - The bands have to depend on composition (for example E − ΣE0 per atom), or be dropped for MACE-OFF.
   - Command: `python -I critic/band_check.py co2.xyz ch3cl.xyz water.xyz`, plus `calculate_local.py co2.xyz {SP, MACE-OFF small}`.
2. **D2: a request for device "cuda" ran on cpu with no warning (ADR-0004).**
   - `calculate_local.py water.xyz {"device":"cuda",…}` returned `params.device = "cpu"`, `provenance.runtime.device = "cpu"`, `warnings = None`.
   - `resolve_device` (calculate.py:374-383) falls back silently.
3. **D3: precision override for MP-family geometry-opt is not warned.**
   - `calculate_local.py silicon.cif {"calculationType":"geometry-opt","modelType":"MACE-MPA-0"}` gives `params.precision = "float64"` and `warnings = None`.
   - `mace_mp()`'s default is float32. CLAUDE.md requires such an override to be recorded in `params` and in `warnings`. Only `params` has it.
   - Using float64 follows upstream's printed advice. The missing warning is the finding.
4. **D4: "drift" is last − first, not a drift.**
   - NVE claims "drift +0.0009 eV" (message, from calculate.py:1342) and the UI row "Total energy drift" (metrics-dashboard.tsx:1997).
   - The linear-fit drift is −4.64e-5 eV/ps in total, −5.16e-6 eV/atom/ps. That is the opposite sign and about 20× smaller per ps.
   - The endpoint difference lies inside the fluctuations (σ 0.39 meV, peak-to-peak 1.78 meV). Measured on the claimed trajectory and reproduced by my run (identical).
   - For NVT and NPT (+0.0520 eV, +1.0632 eV) "drift" names a quantity that is not conserved.
5. **D5: "mean temperature" includes equilibration and has no uncertainty.**
   - NVT: claimed 299.1 K, against an equilibrated 290.2 ± 18.6 K. NPT: claimed 308.4 K, against 317.9 ± 74.6 K. The UI row is the same (metrics-dashboard.tsx:2031).
   - Both are statistically consistent with 300 K, but the 299.1 K figure overstates the agreement.
6. **D6: NPT temperature fluctuations on the 8-atom demo are not canonical.**
   - σ_T is 210 K over 4 ps, against an expected 92.6 K (T ranges 34–1064 K). Mean T, mean P and σ_V are correct.
   - ttime 25 fs and ptime 75 fs are ASE's docstring values for 15k–200k-atom copper, and that docstring says it is "IMPORTANT to monitor the temperature and stress/pressure fluctuations".
   - The trajectory records no cell, volume or pressure per frame, so a user cannot monitor them.
   - Command: `NSTEPS=4000 md_run.py NPT 42 …`.
7. **D7: the MD final "pressure" omits the kinetic term.**
   - `properties.pressure` = 0.303 GPa for the final NPT frame is the instantaneous virial-only value (`get_stress()` defaults to include_ideal_gas=False). Recomputed identically.
   - The barostat controls the virial plus the kinetic term (`MelchionnaNPT.stresscalculator` uses include_ideal_gas=True). The kinetic term at that frame is 2KE/3V = 0.482 GPa, so the total is 0.785 GPa.
   - The label `types/mace.ts:148` does not say this.
8. **D8: unused parameters are echoed as effective.**
   - `friction` is recorded for NVE and NPT (default 0.005, or a user's 0.05) but has no effect, and there is no warning (`calculate_local.py water.xyz {NVE, friction 0.05}`).
   - The dashboard also labels the NVE Maxwell-Boltzmann draw temperature as the "target".
9. **D9: the docs unit table contradicts the JSON.**
   - `app/docs/units/page.tsx:57-58` and `:119` give stress in eV/Å³, and its "JSON result" row gives pressure "—".
   - `result.properties.stress` and `pressure` are in GPa, a factor of 160.2 apart.
10. **Nits.**
   - The opt message says "at or below" fmax, but ASE's test is strict "<". There was no effect here (0.0092).
   - The CIF comment says 2.3517 Å instead of 2.3516 Å.
   - "No — stopped at the step limit" is also shown when the run stops on the time budget (metrics-dashboard.tsx:2051, code reading only).

## UNVERIFIED
- Not run on the hosted Space (Linux, 2 vCPU). Every run was on an Apple M4 Pro, so cross-platform spread is not measured. UNVERIFIED.
- The MD spread rests on 3 samples (SimpleAtom's run plus mine at 1 and 2 threads), not 3 per thread count.
- The CUDA path (no GPU) and the D3/torch-dftd path for the MP family were not exercised. UNVERIFIED.
- The UI units chain comes from reading code (`metrics-dashboard.tsx`, `energy-chart.tsx`, `energy-convergence.tsx`, `trajectory-viewer.tsx`, the docs page), not from a rendered page. The PDF export and MACE Link labels were only grepped. UNVERIFIED in a browser.
- No external reference (NIST, Materials Project, papers) was fetched this session, so I made no comparison to experiment or DFT, including MPA-0's NPT lattice of 5.465 Å. UNVERIFIED.
- Upstream source on GitHub at v0.3.16 was not fetched. Behaviour was checked against the installed mace-torch 0.3.16 and ase 3.27.0 (`ase/md/melchionna.py` read directly).
- The time-budget path (`stoppedEarly`) and custom checkpoints were not exercised.
