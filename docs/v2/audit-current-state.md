> **Superseded snapshot.** Written 2026-08-09 against the code at that time; many findings are fixed. Current state: [docs/audits/2026-10-20.md](../audits/2026-10-20.md) and `docs/v2/defects.json`.

# SimpleAtom v2.0 — Current-State Audit

Captured 2026-08-09, branch `v2.0`, commit `e34e40b`. Read-only audit — no code was
changed to produce this document. Every claim below is traced to a specific file (and
line, where it matters) rather than to `CLAUDE.md`, in-app docs, or marketing copy,
because those three turned out to disagree with the code in several places (see
§1.7). Re-run the relevant `grep`s before trusting a claim after further commits land.

**Cross-reference:** `docs/v2/progress.json` and `docs/v2/bars/{rowan,materials-project}.md`
already exist on this branch (dated the same day) with a similar Rowan/MP-bar
comparison scaffold and a 10-piece `pieces[]` list. This audit was produced
independently (code-first, not derived from that file), and the two mostly agree —
see §3.4 for a diff and one concrete correction to `progress.json` found in the
process.

---

## Part 1 — Current Capability Inventory

### 1.1 Calculation types — the real list

The source of truth is `mace-api/calculate.py::run_calculation()` (lines 115–155),
which is the only place execution actually branches:

```python
if calc_type == "geometry-opt":       return _run_geometry_opt(...)
elif calc_type == "molecular-dynamics": return _run_md(...)
else:                                    return _run_single_point(...)   # default
```

So there are exactly **three** working calculation types:

| Calculation type | Backend function | Notes |
|---|---|---|
| `single-point` | `_run_single_point` (calculate.py:158) | Energy + forces at input geometry. Always returned even when another calc type also runs (opt/MD return final-frame energy+forces too). |
| `geometry-opt` | `_run_geometry_opt` (calculate.py:165) | ASE `BFGS` only, **hardcoded** (calculate.py:166, 180). Atomic positions only — no cell relaxation. Records a full trajectory (energy/positions per step). |
| `molecular-dynamics` | `_run_md` (calculate.py:198) | NVT (Langevin), NPT (ASE `NPT` with hardcoded `ttime=25 fs`, `pfactor=75 fs²`, calculate.py:229), or NVE (`VelocityVerlet`, the `else` branch). Velocities always initialized via `MaxwellBoltzmannDistribution` at the "Temperature" param — including for NVE, where that value is only the *initial* draw, not a maintained target (the UI does not distinguish this; see §1.7). |

**`phonon` does not exist as a fourth branch.** It appears only as a disabled radio
option in `components/calculate/parameter-panel.tsx` (lines 69–74, label "Phonon
spectrum … not yet supported by the backend", `disabled: true`) and is explicitly
short-circuited client-side in `app/calculate/page.tsx` (`handleCalculate`, line 258):
if `calculationType === "phonon"` it sets an error and returns before calling the API.

**Gap: no server-side guard.** If any client bypassed that check (a future UI bug, a
direct `curl` to `/api/calculate`, the benchmark route, etc.), `run_calculation()`
would silently fall into the `else` branch and run a single-point instead of
rejecting the request — `calc_type` is never validated against an allow-list in
`app/api/calculate/route.ts` or `mace-api/calculate.py`.

Model routing (`get_mace_calculator`, calculate.py:39): `modelType in ("MACE-OFF",
"MACE-OFF23")` → `mace_off(...)`; everything else → `mace_mp(...)`. A custom
`.model` upload instead calls `get_custom_calculator` (calculate.py:51), which loads
via `MACECalculator(model_paths=..., device=...)` and ignores `modelSize` entirely.

### 1.2 Configuration parameters — `parameter-panel.tsx` + `types/mace.ts`

Full, verified list (type from `types/mace.ts`, default from
`app/calculate/page.tsx` initial state, range from the `NumberField`/`Select`
props in `parameter-panel.tsx`):

| Parameter | Type | Default | Range / options | Shown when | Reaches backend? |
|---|---|---|---|---|---|
| Model type | `"MACE-MP-0" \| "MACE-OFF" \| "custom"` | `MACE-MP-0` | 3 options | always | yes |
| Model size | `"small" \| "medium" \| "large"` | `medium` | 3 options | disabled when `custom` | yes (ignored for custom) |
| Precision | `"float32" \| "float64"` | `float32` | 2 options | always | yes → `default_dtype` |
| Device | `"cpu" \| "cuda"` | `cpu` | 2 options | always | yes, server falls back to CPU if CUDA unavailable (`resolve_device`, calculate.py:27) |
| Custom model name | `string?` | `""` | free text | `modelType === custom` | label only, not sent to the calculator |
| Custom model file | `File` | — | `.model` upload | `modelType === custom` | yes, via multipart `model` field |
| Calculation type | `CalculationType` | `single-point` | 4 radio options, `phonon` disabled | always | yes (3 of 4 do anything) |
| D3 dispersion | `boolean` | `false` | switch | forced `false` + disabled when `MACE-OFF` | yes → `mace_mp(..., dispersion=...)`; never sent to `mace_off` |
| Force threshold (fmax) | `number` (eV/Å) | `0.05` | min 0.001, max 1, step 0.01 | `geometry-opt` | yes |
| Max optimization steps | `number` | `500` | min 10, max 5000 | `geometry-opt` | yes |
| Ensemble | `"NVE" \| "NVT" \| "NPT"` | `NVT` | 3 options | `molecular-dynamics` | yes |
| Temperature | `number` (K) | `300` | min 0, max 5000 | `molecular-dynamics` (all ensembles) | yes — see NVE caveat above |
| Friction | `number` (1/fs) | `0.005` | min 0.0001, max 0.1, step 0.001 | `molecular-dynamics` + `NVT` only | yes → Langevin friction |
| Pressure | `number` (GPa) | `0` | min 0, max 1000 | `molecular-dynamics` + `NPT` only | yes → converted to eV/Å³ via `ase.units.GPa` |
| Time step | `number` (fs) | `1.0` | min 0.1, max 10, step 0.1 | `molecular-dynamics` | yes |
| MD steps | `number` | `100` | min 1, max 100000 | `molecular-dynamics` | yes |

Not exposed anywhere (UI, types, or API), despite being referenced in docs/marketing
(§1.7): **optimizer choice** (FIRE), **cell optimization**, **any scan/constraint
parameters**.

### 1.3 3D viewer — `components/calculate/molecule-viewer-3d.tsx`

Dual-engine: 3Dmol.js (npm, direct DOM control) and WEAS (CDN, sandboxed iframe,
`components/calculate/weas-viewer.tsx`), user-toggleable. Precisely, what exists today:

**Implemented:**
- Representations (3Dmol only): ball-and-stick, stick, spacefill (`REP_STYLES`, line 57).
- Force-vector overlay (3Dmol only): green arrows scaled ×5 from `result.forces`
  (`applyView`, line 103–131). WEAS has no equivalent — the force toggle button is
  disabled in WEAS mode.
- Camera: drag-to-rotate, scroll-to-zoom, right-drag-to-pan (native 3Dmol/WEAS mouse
  bindings, not custom code), auto-rotate/"spin" toggle (3Dmol only), reset-view button.
- Fullscreen toggle (both engines), responsive resize via `ResizeObserver`.
- Separate trajectory player for MD (`components/calculate/trajectory/trajectory-viewer.tsx`):
  play/pause/step/reset, 0.5×/1×/2×/4× speed, frame scrubber, energy-vs-step chart
  synced to the current frame, click-chart-to-seek.

**Not implemented (verified absent — no dead code, no stub, nothing to enable):**
- **Atom selection.** No click handler attaches to atoms in either engine; nothing
  highlights, nothing shows an atom's index/element/coordinates on click.
- **Measurement.** No bond length / angle / dihedral tool. `grep` for `measure`,
  `distance`, `dihedral`, `angle` in this file and `weas-viewer.tsx` returns nothing
  related to interaction.
- **Labels.** No atom index or element labels can be toggled on.
- **Image/PNG export of the 3D canvas.** The only export paths in the app are Plotly's
  `toImage` modebar button on the 2D charts (`chart-config.ts` `BASE_CONFIG`) and the
  React-PDF report (tables only, no 3D snapshot, see §1.5). There is no "download PNG"
  equivalent for the molecule viewer itself.
- **Settings/gear menu.** All controls are flat toolbar buttons; there is no menu for
  e.g. hiding specific bonds or changing color scheme.
- Only ball-and-stick/stick/spacefill — no cartoon/ribbon (not relevant at MACE's
  small-molecule/crystal scale, but also no surface/isosurface representation, which
  would be moot anyway since MACE has no electron density to contour).

`components/calculate/structure-preview.tsx` (pre-calculation preview, WEAS by
default with a 3Dmol fallback toggle) and `structure-info.tsx` (auto text-only stats:
formula, element counts, bounding box, min interatomic distance, planarity, with
color-coded warnings at >500 and >2000 atoms) are separate, lighter-weight components
that run before any calculation, entirely client-side via `lib/parse-structure.ts`.

### 1.4 File formats — `lib/parse-structure.ts`

Client-side only (no backend call), used solely for the pre-flight preview/info
panels — the actual calculation always re-reads the file server-side via
`ase.io.read` with format forced by extension (`calculate.py::detect_format`).

| Format | Client parser (`lib/parse-structure.ts`) | Server (`calculate.py`) |
|---|---|---|
| `.xyz` / `.extxyz` | Full: symbols, positions, multi-frame count (first frame only), extended-XYZ `Properties=` column parsing for `REF_forces`, comment-line `energy=`/`REF_energy=` regex for reference energy | `ase.io.read(..., format="xyz")` |
| `.cif` | Basic: `_atom_site_type_symbol`/`_atom_site_label` + fract/Cartn coordinates from the first `loop_`; no symmetry expansion, no space-group application | `format="cif"` (full ASE CIF reader, symmetry-aware) |
| `.pdb` | `ATOM`/`HETATM` fixed-column parsing | `format="proteindatabank"` |
| `.poscar`/`.vasp`/`.contcar` | Full VASP5-style parser: scale factor, lattice, element/count lines, direct↔Cartesian conversion; does not handle "Selective dynamics" flags beyond skipping the line | `format="vasp"` |
| Anything else | Falls back to XYZ parsing | Falls back to XYZ format (`detect_format`, calculate.py:13-24) |

Client parser and server parser are two independent implementations (TypeScript vs
ASE) — they will not always agree on edge cases (e.g., the client CIF parser has no
symmetry support, ASE's does), so a structure can preview differently than it
calculates. Both are capped defensively: client bounding-box/min-distance computation
caps at 2000 atoms for performance (`computeMinDistance`, line 439-455); there is no
equivalent atom-count cap on the server beyond the request timeout.

### 1.5 Results display

**The file named in the audit brief, `components/calculate/results-display.tsx`, is
dead code.** `grep -rn "results-display"` across `app/` and `components/` finds zero
importers — it is only ever referenced by its own internal comment header. The
component actually rendered in both places results appear —
`app/calculate/page.tsx:559` and `app/r/[id]/shared-result-view.tsx:112` — is
**`components/calculate/metrics-dashboard.tsx`**. `results-display.tsx` appears to be
a superseded first draft left in the tree; it still compiles (so `npm run build` won't
catch it) but nothing reaches it. `docs/v2/progress.json`'s `"results"` piece lists
`results-display.tsx` as a file to touch — that reference is stale; see §3.4.

**What `metrics-dashboard.tsx` actually does** (the live component): a 5-tab
dashboard —

1. **Summary** — key metric cards (Total Energy + eV/atom, RMS Force, Max Force +
   which atom, Cell Volume if periodic), a fixed "energy reference convention" note,
   an accuracy block *only if reference energy/forces were embedded in the uploaded
   extended-XYZ* (Force MAE/RMSE, Energy MAE, and — deliberately — a signed energy
   error instead of a fabricated R² when only one reference energy pair exists; see
   the comment at `computeAccuracyMetrics`, lines 117-120, which explains why R² is
   intentionally left `null` for single-point comparisons), MD trajectory summary, and
   a static "Limitations & Uncertainty" panel (ML-not-QM, OOD risk, no uncertainty
   quantification, MACE-OFF's neutral-closed-shell-only scope).
2. **Forces** — parity plot + error histogram *if* reference forces exist; otherwise a
   plain per-atom force-magnitude table.
3. **Energy** — energy parity (single-point pair) or energy-vs-step convergence chart
   (opt/MD) or an energy-distribution histogram (MD only, >2 frames).
4. **Structure** — the 3D viewer (§1.3) + MD trajectory player if applicable.
5. **Raw Data** — export buttons + the forces table again.

Export: **PDF** (`components/calculate/pdf-report.tsx`, via `@react-pdf/renderer`) —
summary fields, physical parameters, and a forces table capped at 50 rows; no
structure image is embedded. **CSV** — forces table only. **JSON** — the full
`CalculationResult` object, dumped verbatim.

**Charts** (`components/calculate/charts/`, all Plotly via `react-plotly.js`, shared
`BASE_LAYOUT`/`BASE_CONFIG`/Paul-Tol `DATA_COLORS` from `chart-config.ts`):
`ParityPlot` (predicted vs. reference, R²/MAE/RMSE annotated, colored by element),
`ErrorHistogram` (auto-binned, mean/std annotated), `EnergyConvergence` (opt/MD
energy-vs-step, current-frame marker), `RadarComparison` (4-axis spider chart, used
only by `ModelComparison` for custom-vs-foundation-model). A fifth, hand-rolled SVG
chart (`trajectory/energy-chart.tsx`) duplicates `EnergyConvergence`'s job
specifically for the trajectory player's synced view — two implementations of
"energy vs. step" exist in the codebase for different call sites.

### 1.6 Other verified capabilities (not explicitly asked for, but load-bearing for Parts 2–3)

- **SMILES → 3D**: `app/api/smiles-to-xyz/route.ts` → `mace-api/smiles_to_xyz.py`.
  RDKit `MolFromSmiles` → `AddHs` → ETKDGv3 embedding (UFF fallback) → MMFF94
  optimization (UFF fallback) → XYZ. This is a **classical force-field geometry
  guess**, not a MACE or QM step — MACE only runs after this, when the user clicks
  "Run MACE calculation." Also reachable via a full Ketcher 2D/3D drawing editor
  (`components/calculate/ketcher-editor.tsx`, EPAM Ketcher, "Draw structure" tab on
  the calculate page) which round-trips through the same `/api/smiles-to-xyz` endpoint.
- **Benchmark suite** (`app/benchmark/page.tsx` [219 lines], `app/api/benchmark/route.ts`
  [447 lines], `components/benchmark/*` [9 files, 2,073 lines] — 2,739 lines total
  across 11 files): batch-runs 2–3 models
  across catalog structures (`lib/mlpeg-catalog.ts`, 14 embedded structures from the
  MACE team's ml-peg project) and/or user uploads, single-point only in practice
  (`calculationType` defaults to `"single-point"` and the UI does not appear to expose
  changing it — verify in `benchmark-config.tsx` before relying on this). Produces a
  leaderboard, heatmap, energy-landscape, force-bar, and timing view, plus CSV/export.
  This is architecturally the closest thing in the repo to a "batch/scan" workflow,
  and its sequential-subprocess execution pattern (loop of `execFile python3 ...`) is
  the template any new batch feature (conformer search, scan) would reuse.
- **Custom model upload + comparison**: upload a fine-tuned `.model` checkpoint
  (`MACECalculator` loader), run it, then one-click re-run the same structure on the
  matching foundation model (`components/calculate/model-comparison.tsx`) for a
  side-by-side energy/RMS-force/radar-chart diff. No equivalent exists in Rowan
  (bringing your own potential isn't a documented Rowan workflow) — this is a
  SimpleAtom-only differentiator.
- **MACE Link sharing**: `lib/share.ts` → Supabase `shared_results` table (public
  read/insert via RLS), 8-char nanoid, rendered at `app/r/[id]/` by
  `shared-result-view.tsx`, which reuses the full live `MetricsDashboard` (not a
  cut-down static view) plus a copyable citation string. Local, account-free calc
  history also exists (`lib/history.ts`, browser `localStorage`, surfaced via the
  "Recent" sheet on the calculate page).
- **Scientific result validator**: `test_scripts/validate_calculation.py` — energy
  bounds (model-aware MP vs. OFF), force magnitude/NaN/conservation checks,
  interatomic-distance sanity, lattice-volume validity, MD trajectory NaN/fluctuation
  checks, element-symbol whitelist, and a `validate_params` pass that flags D3+OFF
  double-counting and (already, today) `calc_type == "phonon"` + `float32` as an
  issue — i.e., the validator has logic for a calculation type the backend cannot run.

### 1.7 Discrepancies found between docs/marketing and the actual code

These matter for Part 3 because "does the UI honestly represent what it does" is
itself a judgeable interface-quality axis, and because a v2.0 builder should not
propagate them further.

| Claim | Where claimed | Reality |
|---|---|---|
| "geometry optimization (BFGS/**FIRE**, fmax)" | `app/docs/calculations/page.tsx:9`; table row at line 58-59 ("Switch to FIRE if BFGS struggles to converge"); also `components/intro-section.tsx:73` ("Relax structures … with BFGS **or FIRE**") | `_run_geometry_opt` (calculate.py:165-195) hardcodes `from ase.optimize import BFGS`. No optimizer parameter exists in `types/mace.ts`, `parameter-panel.tsx`, or anywhere in the request path. FIRE is not reachable by any UI action. |
| `mace-api/generate_surface.py` and `app/api/generate-surface/` (ASE surface slab generation) | `CLAUDE.md` "Architecture" and "Key Files" tables (checked into this repo) | Does not exist on this branch. `git log --all -- "*generate_surface*"` shows it was deleted in the "improvements of backend MACE python files and deleting unwanted code" commits. `app/api/` today contains only `calculate/`, `benchmark/`, and `smiles-to-xyz/`. |
| `python mace-api/validate_calculation.py --test` | `CLAUDE.md` "Development Commands" and "Testing & Validation" | The file lives at `test_scripts/validate_calculation.py`, not under `mace-api/`. The command as written in `CLAUDE.md` will fail with "no such file." |
| Cell optimization "not yet [supported]" | `app/docs/calculations/page.tsx:84` | Accurate — flagging this one as a positive control: not everything in the docs is stale, and this line correctly matches the code (only atomic positions are optimized, `_run_geometry_opt` never touches `atoms.cell`). |
| `CalculationResult.properties.density` / `.pressure` | `types/mace.ts:57-61` | Never populated. `_build_result` (calculate.py:92-112) only ever sets `properties.volume`. Nothing in the frontend reads `.density` or `.pressure` either (`grep` returns zero hits) — these are two fields declared in the type system with no producer and no consumer. |
| `phonon` validated for `float64` requirement | `test_scripts/validate_calculation.py:238-242` (`validate_params`) | Validates a calculation type that cannot be requested end-to-end (see §1.1). Not wrong, just currently unreachable — this is scaffolding for a feature that was planned (see also the disabled UI radio and the entire "Vibrational Analysis" rules section in `CLAUDE.md`) but never wired up. |

---

## Part 2 — Gap Analysis Against Rowan

Classification key: **(A)** already in SimpleAtom · **(B)** buildable on MACE
(energies/forces are sufficient; no wavefunction needed) · **(C)** not possible on
MACE (needs electron density, partial charges, a different kind of model/engine
entirely, or is out of scope for an interatomic potential by definition).

| # | Rowan workflow | Bucket | Reasoning / what it would take |
|---|---|---|---|
| 1 | Single-point energy | **A** | `mace-api/calculate.py::_run_single_point`; `calculationType: "single-point"` in `types/mace.ts` and `parameter-panel.tsx`. |
| 2 | Geometry optimization | **A** | `_run_geometry_opt`. Caveat: positions only, BFGS only (§1.7) — narrower than Rowan's offering, not absent. |
| 3 | Transition-state optimization | **B** | Needs a saddle-point optimizer over the same energy/force interface MACE already provides — e.g. `sella` (an ASE-calculator-agnostic TS optimizer built specifically for ML potentials) or ASE's dimer method. No wavefunction required; TS-finding only needs curvature info derivable by finite differences of forces. Needs: new `calculationType`, a numerical/approximate-Hessian step, an initial-guess-structure UX, and (to confirm a true first-order saddle) the frequency machinery from row 4. Nontrivial but squarely buildable. |
| 4 | Frequencies & thermochemistry | **B** | `ase.vibrations.Vibrations` (finite-difference Hessian from MACE forces) + `ase.thermochemistry.IdealGasThermo` — both calculator-agnostic ASE modules, zero electron density needed. This is the most-scaffolded-but-unbuilt gap in the repo: disabled `phonon` UI option, `CLAUDE.md`'s entire "Vibrational Analysis" rules section, and the validator's float64-for-phonons check all already assume this feature exists. Caveat: **no IR intensities** — those need dipole derivatives, which the integrated `mace_mp`/`mace_off` foundation models don't output. Frequencies (cm⁻¹) and ZPE/H/S/G are in reach; an IR spectrum is not. |
| 5 | Conformational searching | **B** | RDKit ETKDG conformer generation is already a dependency and already wired for SMILES→3D (`mace-api/smiles_to_xyz.py`). Generate N conformers → relax each with the existing `geometry-opt` path → dedupe by RMSD → rank by MACE energy. The benchmark suite's batch-subprocess loop (`app/api/benchmark/route.ts`) is a direct architectural template. |
| 6 | Solvent-dependent conformer search | **C** (mostly) | Implicit solvation (COSMO/SMD/PCM-style) is a continuum electrostatics solve against the solute's charge distribution — MACE has none. A conformer search *in vacuum* is (B) (row 5); ranking conformers *by solvent-corrected free energy* is not achievable with the foundation models integrated here. Only escape hatch: a MACE variant specifically trained with implicit solvent baked into the PES, which is not what `mace_mp`/`mace_off` are. |
| 7 | Scan | **B** | Not implemented today (no coordinate-scan code anywhere). Mechanically simple: fix one internal coordinate (bond/angle/dihedral, via ASE constraints such as `FixInternals`) and relax the rest with the existing BFGS engine at each step. Reuses the `EnergyConvergence` chart (x-axis becomes the scanned coordinate instead of step index) almost unchanged. |
| 8 | Multistage optimization | **B**, narrowed | Rowan's version chains *different levels of theory* (e.g., semi-empirical → DFT). SimpleAtom has only one engine family (MACE), so the buildable analog is chaining **model sizes/types** (small → medium/large refinement, or MACE-OFF → a custom fine-tune), which is real orchestration value but not the same claim as Rowan's cross-method staging — there is no second QM engine in this codebase to stage into. |
| 9 | Orbitals / electronic properties | **C** | Definitional, not an engineering gap. MACE is a function from (species, positions[, cell]) → (energy, forces[, stress]). No basis set, no SCF, no wavefunction, no electron density exists anywhere in the pipeline to derive HOMO/LUMO, ESP maps, or partial charges from. |
| 10 | IRC | **B**, downstream of row 3 | Mass-weighted steepest-descent from a saddle point using energies/forces only (no electron density). Needs the TS optimizer (row 3) and its imaginary-mode eigenvector as a prerequisite; ASE has no built-in IRC, but `sella` and hand-rolled steepest-descent integrators exist for exactly this calculator-agnostic case. |
| 11 | Double-ended TS search (NEB / string methods) | **B** | `ase.mep.neb.NEB` is calculator-agnostic and works with MACE with no new science — one of the most "just wire it up" items on this list. Real effort is orchestration/UX: two endpoint structures with consistent atom ordering, N interpolated images, per-iteration force evaluations across all images, convergence monitoring, and a reaction-path viewer. |
| 12 | Strain calculation | **B** | Ligand strain = E(bound-pose conformation) − E(global-minimum conformation) — a pure MACE energy difference once conformer search (row 5) exists. Scope-limited to MACE-OFF's organic-molecule domain (ligand only, not a protein-ligand complex). |
| 13 | Interaction energy decomposition | **B** for the total, **C** for the decomposition | Total supermolecular interaction energy (E(complex) − E(A) − E(B)) is a plain MACE energy subtraction: (B). Decomposing that number into electrostatics/exchange/induction/dispersion (EDA/SAPT-style) requires per-fragment SCF/wavefunction machinery that has no analogue for a potential that only ever outputs one scalar: (C). |
| 14 | pKa | **C** | Requires comparing protonated/deprotonated (differently-charged) species plus a solvation free energy. MACE-OFF is documented in this very repo (`metrics-dashboard.tsx`'s own "Limitations" panel) as scoped to neutral, closed-shell organic molecules — charged/ionic species are out of its training distribution before solvation is even considered. |
| 15 | BDE (bond dissociation energy) | **B**, with an accuracy caveat | Mechanically a MACE energy subtraction (parent − sum of radical fragments) — buildable today with the existing single-point engine. Caveat worth stating precisely: BDE requires evaluating open-shell radical fragments, and MACE-OFF is trained on closed-shell neutral molecules, so radical-fragment accuracy is out-of-distribution risk, not a hard blocker. |
| 16 | Redox potential | **C** | Same charge-state-plus-solvation blocker as pKa (row 14). |
| 17 | Fukui indices | **C** | Defined as the derivative of electron density with respect to electron count — a direct electron-density quantity. No density anywhere in MACE. |
| 18 | Tautomers | **B** | Same mechanism as conformer search (row 5) but candidates differ in bond connectivity, not just dihedrals — RDKit has a tautomer-enumeration module; each candidate still needs to be a neutral closed-shell species to stay inside MACE-OFF's domain. |
| 19 | Solubility | **C** (via MACE) | Normally an empirical QSPR/ML model, or a full solvation + sublimation free-energy calculation — neither is an interatomic-potential energy/forces query. A from-scratch route through MACE alone does not exist. |
| 20 | LogP | **C** (via MACE), trivial via RDKit | LogP is standardly a group-contribution/QSPR value (e.g., RDKit's own `Crippen.MolLogP`) with **zero MACE calculation involved**. RDKit is already a backend dependency (`mace-api/requirements.txt`). Worth flagging precisely: not buildable "on MACE," but trivially addable to the app as a separate cheminformatics feature next to MACE — a different kind of gap than the others in this table. |
| 21 | H-bond strength | **B** (crude proxy) / **C** (rigorous) | A total-energy proxy (E with the contact intact − E with fragments separated) is (B), same mechanism as row 13's total interaction energy. The physically decomposed version Rowan likely means (an EDA component) is (C) for the same reason as row 13. |
| 22 | Spin states | **C** | Requires multiplicity-resolved electronic structure — distinct SCF solutions for different spin states at the same geometry. MACE has no concept of spin/multiplicity as an input at all; the PES it was trained on is a single fixed electronic state. |
| 23 | ADME-Tox | **C** | Standardly a trained QSAR/ML classifier over molecular descriptors/fingerprints, unrelated to an energy/force potential. Would be a wholly separate model integration, not a MACE extension. |
| 24 | Permeability | **C** | Same category as ADME-Tox, or (in physics-based platforms) a lipid-bilayer PMF/umbrella-sampling MD run — needs a membrane-parameterized force field that MACE-MP-0 (materials) and MACE-OFF (small organics in vacuum) do not provide. |
| 25 | Docking | **C** | Needs a dedicated pose-search + scoring engine (e.g. AutoDock Vina-style); no such search algorithm exists anywhere in this codebase. MACE could in principle *rescore* externally-docked poses by energy, but pose generation — the actual hard part of docking — is absent and out of scope for an interatomic potential. |
| 26 | Co-folding | **C** | Requires a trained sequence-to-structure model (AlphaFold/Boltz/Chai-class); completely unrelated technology to an interatomic potential. |
| 27 | Protein MD | **C** (as currently integrated) | The NVT/NVE/NPT engine in `_run_md` is mechanically size-agnostic — it would not error on a protein-sized `Atoms` object. But neither `mace_mp` (89-element materials/PBE+U) nor `mace_off` (small neutral organics) is a validated biomolecular force field, so running either on a folded protein is scientifically invalid, not merely slow. Also collides with the hardcoded 60-minute subprocess timeout (`app/api/calculate/route.ts:118`) at any realistic protein+solvent atom count. Would need an entirely different, protein-capable potential to be integrated — a model swap, not a small addition. |
| 28 | RBFE | **C** | Alchemical free-energy perturbation (lambda windows, softcore potentials, BAR/MBAR estimators) on solvated protein-ligand complexes — needs both a validated biomolecular force field (row 27, absent) and an entire alchemical-FEP pipeline that does not exist anywhere in this codebase. |
| 29 | NMR | **C** | Chemical shifts come from the electronic shielding tensor (GIAO-DFT-class calculation) — a magnetic electron-density response property with no classical-forces analogue. |
| 30 | Ion-mobility MS (collision cross-section) | **B**, indirect | CCS is typically computed from a 3D geometry via trajectory/projection methods (e.g. Mobcal/IMoS-style) that need only geometry + van der Waals radii — not electronic structure. MACE's role would be indirect (supplying a well-relaxed conformer geometry); the actual CCS math requires integrating a new third-party library that doesn't exist in this stack today, so it's a bigger lift than most other (B) rows despite not needing new science from MACE itself. |

**Summary:** 2 of 30 already shipped (A), 15 buildable on MACE alone or with modest
new infrastructure (B, plus 3 more B-with-caveats), 13 fundamentally blocked by the
lack of any electron density, charge model, or dedicated non-MACE engine (C). The
(B) list is dominated by classical-mechanics-on-a-PES workflows (frequencies,
conformers, scans, NEB, strain) that ASE already supports for arbitrary calculators;
the (C) list is dominated by anything requiring per-electron information or a
completely different model class (docking, structure prediction, QSAR).

---

## Part 3 — Smallest Judgeable Pieces

Each piece below is scoped so a builder can improve it and a critic can judge it in
isolation, blind side-by-side against Rowan, without needing the rest of v2.0 to
exist. Pieces 1–10 improve what already ships; 11–13 close specific (B)-bucket gaps
from Part 2; 14 is cross-cutting. **File-conflict matrix is in §3.3 — read it before
scheduling parallel work.**

### 3.1 Pieces

**1. Input intake & pre-flight sanity-checking**
- Files: `components/calculate/file-upload-section.tsx`, `smiles-input.tsx`,
  `ketcher-editor.tsx`, `mlpeg-catalog.tsx`, `structure-info.tsx`,
  `structure-preview.tsx`, `lib/parse-structure.ts`, `app/api/smiles-to-xyz/route.ts`,
  `mace-api/smiles_to_xyz.py`
- Critic judges: same target molecule (e.g. ibuprofen) entered four ways (upload,
  catalog, SMILES, draw) — time to a valid 3D structure, format coverage (does Rowan
  offer name→structure lookup that SimpleAtom lacks?), clarity/actionability of the
  auto-warnings (overlap, huge structure, flat/2D geometry).

**2. Parameter configuration UX**
- Files: `components/calculate/parameter-panel.tsx`, `types/mace.ts`
- Critic judges: can an unfamiliar chemist pick sensible settings without reading
  docs; are units/ranges visible at the point of entry (mirrors the existing
  `docs/v2/bars/materials-project.md` finding that MP inlines a unit on every value);
  does it hide irrelevant fields per calc type as well as Rowan's method picker hides
  irrelevant basis-set/solvent options.

**3. Single-point & geometry-optimization core run loop**
- Files: `app/calculate/page.tsx` (run/progress state machine), `app/api/calculate/route.ts`,
  `mace-api/calculate.py` (`_run_single_point`, `_run_geometry_opt`),
  `components/calculate/metrics-dashboard.tsx`
- Critic judges: run the same molecule single-point + opt in both tools; compare
  wait-time transparency (phase list + progress bar vs. Rowan's job status), and
  whether the optimization trace (SimpleAtom's `EnergyConvergence` chart) matches or
  beats Rowan's convergence display.

**4. Molecular dynamics workflow**
- Files: `parameter-panel.tsx` (MD section), `mace-api/calculate.py` (`_run_md`),
  `components/calculate/trajectory/trajectory-viewer.tsx`, `trajectory/energy-chart.tsx`,
  `charts/energy-convergence.tsx` (MD path), `metrics-dashboard.tsx` (Energy tab)
- Critic judges: MD is not on Rowan's published workflow list at all, so this is a
  case where the bar is "is this good on its own terms," not a head-to-head — judge
  trajectory playback smoothness, whether NVE/NVT/NPT semantics are communicated
  correctly (including the Temperature-for-NVE ambiguity flagged in §1.7), and
  energy-conservation/thermostat-behavior legibility.

**5. 3D structure viewer & interaction quality**
- Files: `components/calculate/molecule-viewer-3d.tsx`, `weas-viewer.tsx`,
  `structure-preview.tsx`
- Critic judges (concrete bar already captured in `docs/v2/bars/rowan.md` — reuse
  it rather than re-deriving): render sharpness at devicePixelRatio 2 vs. SimpleAtom's
  current DPR, click-to-select an atom with a highlight, select 2/3/4 atoms to read
  out bond length/angle/dihedral, a settings menu (rotate/hide C–H bonds/download
  PNG) vs. SimpleAtom's flat toolbar, CPK color fidelity. This is the single
  highest-visibility piece — Rowan's homepage hero *is* this viewer. SimpleAtom's own
  differentiator to preserve here: force-vector arrows, which Rowan's embed does not
  show.

**6. Results dashboard information architecture**
- Files: `components/calculate/metrics-dashboard.tsx` (the live component —
  `results-display.tsx` is dead code, see §1.5/§3.4, and should be deleted rather
  than "improved")
- Critic judges: time-to-find-the-number-that-matters, tab organization sense,
  whether every displayed value carries its unit inline (the MP-bar pattern), and
  whether the existing "Limitations & Uncertainty" panel (a genuine SimpleAtom
  strength — MACE-OFF scope, OOD risk, no uncertainty quantification stated plainly)
  is at least as prominent as Rowan's equivalent trust signals.

**7. Scientific charting**
- Files: `components/calculate/charts/chart-config.ts`, `energy-convergence.tsx`,
  `error-histogram.tsx`, `parity-plot.tsx`, `radar-comparison.tsx`
- Critic judges: readability, colorblind-safety (Paul Tol palette is already a
  strength — verify it's actually followed everywhere, not just declared), export
  quality (Plotly `toImage` SVG/PNG), and correctness of statistical annotations
  (R²/MAE/RMSE formulas) — this piece is judgeable in complete isolation from Rowan
  since Rowan's chart types aren't publicly documented in the same visual detail.

**8. Export & reporting**
- Files: `components/calculate/pdf-report.tsx`, `metrics-dashboard.tsx` (download
  handlers), `lib/share.ts`, `lib/supabase.ts`, `app/r/[id]/*`
- Critic judges: does the PDF read as "publication-ready" (currently: tables only, no
  structure image — a concrete, fixable gap); does the MACE Link shared page (a full
  live `MetricsDashboard`, plus a generated citation string) beat or lose to Rowan's
  `iframe2` shareable embed (`docs/v2/bars/rowan.md` has the exact public URL pattern
  to load side by side, no login required for the viewer).

**9. Benchmark / multi-model comparison suite**
- Files: `app/benchmark/page.tsx`, `app/api/benchmark/route.ts`,
  `components/benchmark/*.tsx` (9 files), `lib/mlpeg-catalog.ts`
- Critic judges: this has no direct Rowan analogue (Rowan doesn't expose
  multi-potential benchmarking as a workflow), so judge it as SimpleAtom's own
  "batch/scan-shaped" feature on its own terms — leaderboard/heatmap polish,
  discoverability, export completeness. Numeric cross-check against
  `docs/v2/bars/materials-project.md`'s published formation energies is the more
  rigorous version of this judgment (already scoped as the `"benchmark"` piece in
  `docs/v2/progress.json`).

**10. Custom model upload & model-comparison workflow**
- Files: `parameter-panel.tsx` (custom-model section), `components/calculate/model-comparison.tsx`,
  `charts/radar-comparison.tsx`, `app/calculate/page.tsx` (`handleRunFoundation`)
- Critic judges: no Rowan equivalent exists (bring-your-own-potential isn't a Rowan
  workflow), so judge on SimpleAtom's own terms — clarity of what "custom model"
  means to a non-expert, upload safety/validation messaging, and whether the
  side-by-side radar/delta comparison actually helps decide "is my fine-tune better."

**11. Vibrational frequencies & thermochemistry (new)**
- Files (new/modified): `mace-api/calculate.py` (new `_run_vibrational` using
  `ase.vibrations.Vibrations` + `ase.thermochemistry.IdealGasThermo`), `types/mace.ts`
  (enable/rename the `phonon` type, add thermochemistry params), `parameter-panel.tsx`
  (un-disable + expose temperature/pressure-for-thermo inputs), a new results tab or
  card (frequency table + ZPE/H/S/G) most likely inside `metrics-dashboard.tsx`
- Critic judges: run the same small, already-optimized molecule (e.g. water or
  ethanol) through frequency+thermo in Rowan and SimpleAtom; check 3N-6 mode count,
  presence and units of ZPE/H/S/G, imaginary-mode flagging, and whether float64 +
  fmax<0.005 eV/Å are enforced automatically rather than left to the user (this is
  the highest-priority new piece: it is the most-scaffolded, least-built gap found in
  this audit — see §1.7).

**12. Conformer search (new)**
- Files (new): a batch-execution route modeled on `app/api/benchmark/route.ts`, a new
  `mace-api/` module (RDKit ETKDG generation + MACE relax + RMSD dedupe), a new
  results component (energy-ranked list + conformer-overlay viewer)
- Critic judges: a molecule with several rotatable bonds (e.g. butane or a small
  drug-like structure) — unique-conformer count, correct energy ranking/units,
  dedup quality, ensemble visualization, vs. Rowan's conformer table + overlay.

**13. Reaction-coordinate scan (new)**
- Files (new/modified): `mace-api/calculate.py` (new `_run_scan` using ASE
  `FixInternals` or an equivalent constrained-BFGS loop), `types/mace.ts` (new calc
  type + scan-coordinate params), `parameter-panel.tsx` (atom-index picker for
  bond/angle/dihedral + range/step count), reuses `charts/energy-convergence.tsx`
  with the x-axis relabeled to the scanned coordinate
- Critic judges: a simple bond-stretch scan (e.g. O–H in water) side by side —
  profile smoothness, barrier legibility, x-axis coordinate labeling correctness.

**14. Onboarding, docs, and scope-honesty**
- Files: `app/docs/**/*.tsx`, `app/page.tsx`, `components/intro-section.tsx`,
  `DEMO_STEPS` in `app/calculate/page.tsx`
- Critic judges: can a first-time, non-MACE-background user reach a correct,
  meaningful result within a few minutes using only in-app guidance; and — the axis
  this audit adds concretely — **does the documentation match the code**. §1.7 found
  three live discrepancies (FIRE optimizer claimed twice, a deleted
  `generate-surface` feature still documented in `CLAUDE.md`, a wrong file path for
  the validator) that a critic should re-check as fixed, not just re-praise the prose.

### 3.2 Piece → Rowan-workflow mapping (from Part 2)

Pieces 3, 4 exercise (A) rows 1–2. Piece 11 closes (B) row 4. Piece 12 closes (B) row 5
(and is a prerequisite for rows 6/12/18). Piece 13 closes (B) row 7. Pieces 3/11
together are prerequisites for (B) rows 3 and 10 (TS search, IRC) if those are
pursued later — neither is small enough to be its own "smallest piece" yet; they
should be decomposed further once frequencies (11) exist. Pieces 1, 2, 5, 6, 7, 8, 9,
10, 14 are interface-quality pieces with no 1:1 Part-2 row — they're about matching
Rowan's *execution* quality on workflows SimpleAtom already has, not closing a
capability gap.

### 3.3 File-conflict matrix — cannot run in parallel

| File | Pieces touching it |
|---|---|
| `components/calculate/parameter-panel.tsx` | 2, 10, 11, 13 |
| `types/mace.ts` | 2, 11, 13 |
| `mace-api/calculate.py` | 3, 4, 11, 13 (each adds an independent `_run_xxx` function, but all share the `run_calculation()` dispatch block — coordinate the `if/elif` edits) |
| `components/calculate/metrics-dashboard.tsx` | 6, 8, 11 (11 only if the frequency tab is added here rather than as a standalone component) |
| `components/calculate/charts/radar-comparison.tsx` | 7, 10 |
| `components/calculate/charts/energy-convergence.tsx` | 4, 7, 13 |
| `app/calculate/page.tsx` | 3 and 4 both run through the same `handleCalculate`/progress state machine (generic across calc types, not calc-type-specific — low conflict risk but same file); 10 touches `handleRunFoundation` in the same file; 14 touches `DEMO_STEPS` in the same file |
| `lib/mlpeg-catalog.ts` | 1 (catalog tab), 9 (benchmark structure source) |

Everything else (viewer in piece 5, benchmark suite in piece 9, export/sharing in
piece 8's non-dashboard files, docs in piece 14's `app/docs/**`) is file-isolated from
the rest and safe to run fully in parallel.

### 3.4 Cross-reference to `docs/v2/progress.json`

That file (already on this branch, same date) scopes 10 pieces against two bars
(Rowan for interface/viewer, Materials Project for data density and periodic-materials
numeric accuracy) and independently states the same MACE-has-no-electron-density
scope boundary this audit's Part 2 arrived at from the code. One concrete correction
for whoever picks that file up next: its `"results"` piece lists
`components/calculate/results-display.tsx` as a file to touch — per §1.5, that
component is dead code with zero importers; the file that actually renders results in
both the calculator and the MACE Link share page is
`components/calculate/metrics-dashboard.tsx`. The `"viewer-*"` pieces in that file
already carry the exact concrete Rowan viewer bar (DPR2 rendering, click-select,
2/3/4-atom measurement, settings-menu item labels) that this audit's piece 5 reuses
rather than re-deriving.
