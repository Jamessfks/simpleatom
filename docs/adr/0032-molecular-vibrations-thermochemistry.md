---
status: proposed
date: 2026-10-28
decision-makers: repository owner (pending approval at STOP-1)
---

# 0032 — Amend ADR-0018: harmonic vibrations and ideal-gas thermochemistry for isolated molecules

## Context and problem statement

ADR-0018 keeps vibrations out of scope "for now". The 2026-10-28 needs research ranks
"confirm a minimum, then get ZPE/H/S/G" first by demand evidence. It found 9 distinct
threads: `ACEsuit/mace` D#718, I#34, I#488 and D#1494, plus five Matter Modeling SE
questions (`docs/v2/needs-2026-10-28.md` rows 3–4).

Today SimpleAtom's own docs send relaxed geometries to "an external vibrational analysis"
(`app/docs/calculations/page.tsx:72-74`). Upstream v0.3.16 provides an analytic Hessian,
`MACECalculator.get_hessian()` (`mace/calculators/mace.py:770`), with no dtype guard of its
own.

The unmerged branch `claude/mace-computation-polish-843f50` has a finite-difference
implementation (`mace-api/vibrations_thermo.py`, 1,799 lines). It predates the v2.2 contract,
safe loading and jobs.

## Considered options

* **A. Analytic Hessian.** `get_hessian()` in float64, then ASE `VibrationsData` for modes and
  ASE `IdealGasThermo` for U/H/S/G.
* **B. Finite differences.** ASE `Vibrations` (δ = 0.01 Å, central) at 6N+1 force calls, as
  on the branch.
* **C. Keep refusing.** Leave ADR-0018 as it is.

Measured on 2026-10-28 on an Apple M4 Pro at `OMP_NUM_THREADS=2`: mace-torch 0.3.16, ASE
3.27.0, MACE-OFF23, float64, every input relaxed to fmax < 0.001 eV/Å. The script is
`docs/v2/evidence/2026-10-28/feasibility.py`.

| Molecule (N) | Model | Hessian (s) | FD (s) | median / max \|Δν\| A vs B (cm⁻¹) | Modes found / 3N−6 | Imaginary |
|---|---|---|---|---|---|---|
| water (3) | OFF small | 0.15 | 0.13 | 0.50 / 0.95 | 3 / 3 | 0 |
| ethanol (9) | OFF small | 0.38 | 0.68 | 0.19 / 1.19 | 21 / 21 | 0 |
| caffeine (24) | OFF small | 2.02 | 4.70 | 0.10 / 3.26 | 66 / 66 | 0 |
| caffeine (24) | OFF medium | 14.07 | 17.77 | 0.09 / **10.92** | 66 / 66 | 0 |
| ibuprofen (33) | OFF small | 5.65 | 8.78 | 0.10 / 1.22 | 93 / 93 | 0 |
| cholesterol (74) | OFF small | 36.77 | 44.12 | 0.11 / 3.93 | 216 / 216 | 0 |

Against a reference, MACE-OFF23 small gives water harmonic frequencies of 1632.7 / 3844.3 /
3948.4 cm⁻¹. The CCCBDB experimental *harmonic* values are 1648.5 / 3832.2 / 3942.5
([CCCBDB](https://cccbdb.nist.gov/expvibs2x.asp?casno=7732185), fetched 2026-10-28), so
Δ = −15.8 / +12.1 / +5.9 cm⁻¹. The ZPE is 0.5843 eV, against 0.5842 eV from the experimental
harmonics. S°(298.15 K, 1 bar) is 188.68 J mol⁻¹ K⁻¹ (ideal gas, rigid rotor, harmonic
oscillator, σ = 2), against the CODATA value of 188.835 ± 0.010 J mol⁻¹ K⁻¹
([NIST WebBook](https://webbook.nist.gov/cgi/cbook.cgi?ID=C7732185&Mask=1), fetched
2026-10-28).

## Decision outcome

Chosen option: "A. Analytic Hessian", because:

* it is the model's exact second derivative, with no step size to tune;
* it agrees with finite differences to a median 0.1–0.5 cm⁻¹;
* its largest disagreement (10.9 cm⁻¹) falls in a soft mode, where the finite-difference
  truncation error lives;
* it is as fast as or faster than finite differences from 24 atoms up.

Finite differences stay in the test suite as the independent cross-check.

**In scope (amends ADR-0018):** a new `calculationType: "vibrations"` for **isolated,
non-periodic molecules at a stationary point**. It computes:

* harmonic frequencies in cm⁻¹, with 3N−6 modes (3N−5 for linear molecules) after the
  translation and rotation modes are removed; the removed modes are reported, not hidden;
* imaginary modes, flagged and reported as `i·|ν|`;
* ZPE, and U, H, S and G from ASE `IdealGasThermo` at a user-chosen T (default 298.15 K) and
  a fixed standard pressure of 1 bar = 10⁵ Pa (IUPAC), recorded in `params`. No pressure
  input is offered, because CLAUDE.md forbids bar as a user-facing unit and gas-phase GPa
  inputs would be misleading.

**Refused with `ContractError`:**

* float32 (`precision_not_allowed`);
* any periodic cell (`periodic_not_supported`: phonons stay out of scope);
* input with max |F| > 0.005 eV/Å (`not_stationary`, with the hint "Run a geometry
  optimisation with fmax ≤ 0.005 eV/Å first, or use *Compute frequencies* on a converged
  result");
* more atoms than the profile cap (`too_many_atoms`).

**Still out of scope:**

* phonons and periodic Hessians;
* IR and Raman intensities, which need dipoles or polarisabilities, i.e. ASL models excluded
  by ADR-0021;
* anharmonic corrections and scaled frequencies;
* transition-state search and IRC;
* reaction paths;
* charged or open-shell species (MACE-OFF is closed-shell, and the spin multiplicity is
  fixed at 1);
* cell relaxation, which needs its own ADR.

**Chaining:** a converged geometry-optimisation result with fmax ≤ 0.005 eV/Å offers
"Compute frequencies". This queues `vibrations` on the final frame and records
`params.parentStructureSha256` (ADR-0009), so the provenance links the two runs.

**Salvaged from the branch, behind tests:** the rotational symmetry-number search
(`rotational_symmetry_number`, with a user override), linear-molecule classification, and the
translation/rotation residual warning. Nothing else.

**Caps (`contract.json` profiles):** local `maxAtoms.vibrations = 500`. Hosted is set from a
measurement on the Space after v2.2 deploys. The planning value is 60 atoms, which assumes
the hosted slowdown factor stays at or below 4× relative to the 74-atom 37 s figure above
(UNVERIFIED).

### Consequences

* Good, because the most-requested missing step in a molecular workflow (relax → confirm the
  minimum → thermochemistry) runs in one place, against a public numeric reference.
* Good, because harmonic frequencies can be compared like for like with CCCBDB's
  experimental harmonics, with the harmonic-vs-fundamental gap stated rather than hidden.
* Bad, because the model best suited to molecules, MACE-OFF23, is ASL (non-commercial).
  Results carry its `licenseNotice`, and MP-family results on molecules get a warning that
  molecular frequencies are outside their validation.
* Bad, because it adds a fourth calculation type to the contract, the UI, the validator and
  the docs.

### Confirmation

* Guards: `vibrations` with `precision: "float32"`, with `public/demo/silicon.cif`, and with
  unrelaxed `public/demo/ethanol.xyz` (fmax > 0.005) must each return `status: "error"` with
  the codes above.
* `test_scripts/test_vibrations.py`:
  * the mode count is 3N−6 for water and ethanol, and 3N−5 for CO₂;
  * a symmetric saddle reports an imaginary mode;
  * Hessian and finite-difference frequencies agree within the tolerance measured by
    `verify-science`;
  * water and CO₂ harmonics match the committed golden values;
  * ZPE and S match the committed golden values;
  * unit conversions go through `ase.units` only.
* `test_scripts/daily_gate.py` adds the guards above.
* The `phonon` guard is unchanged.

## More information

* `docs/v2/plan-2026-10-28.md` (file-by-file plan) and `docs/v2/needs-2026-10-28.md`.
* ADR-0018 (amended), ADR-0004, ADR-0005, ADR-0009, ADR-0021, ADR-0022, ADR-0023.
* CLAUDE.md §Vibrational Analysis: float64 for Hessians is a SimpleAtom convention, not an
  upstream rule.
