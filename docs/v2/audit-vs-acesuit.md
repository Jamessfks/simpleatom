> **Superseded snapshot.** Written 2026-08-09 against the code at that time; many findings are fixed. Current state: [docs/audits/2026-10-20.md](../audits/2026-10-20.md) and `docs/v2/defects.json`.

# Audit — SimpleAtom v2.0 vs. ACEsuit/mace

Performed 2026-08-09 against `docs/v2/bars/acesuit-mace.md`. Upstream read at tag **v0.3.16**;
installed package in this environment is **mace-torch 0.3.15**, **ase 3.27.0**. Documentation
only — no code was changed.

Findings marked **[verified]** were reproduced by running code (ASE with an EMT calculator,
which needs no model download) or by reading the exact upstream/SimpleAtom line cited.
Findings marked **[reasoned]** follow from cited defaults but were **not** measured against a
real MACE model, and say so.

---

## Findings, severity ordered

| # | Finding | Severity | Evidence | Fix |
|---|---|---|---|---|
| 1 | `modelType` has no allow-list. Any unrecognised value — including `"custom"` with no uploaded checkpoint — silently falls through to `mace_mp()` and runs **MACE-MP-0 medium**, while `result["params"]["modelType"]` echoes the requested value. Reachable from the UI. | **CRITICAL** | `mace-api/calculate.py:114-119`, `230-233`, `241-247`; no `modelType` check in `app/api/calculate/route.ts:60-103`; Run button gated only on `uploadedFiles.length` (`app/calculate/page.tsx:441`) **[verified by reading]** | Validate `modelType` against an explicit allow-list in `calculate.py`, exactly as `validate_calculation_type()` does. Raise when `modelType == "custom"` and `model_path is None`. |
| 2 | Geometry optimisation never checks convergence. `opt.run()`'s return value is discarded and the message always says "completed", so a run that exhausts `maxOptSteps` is indistinguishable from a converged one. | **HIGH** | `mace-api/calculate.py:297`, `301`; ASE 3.27.0 `Optimizer.run()` returns `numpy.bool_(False)` on step exhaustion **[verified: forced non-convergence returned `False`]** | Capture the return value; put `converged: bool` in `result["params"]` (or a top-level field) and in the message. |
| 3 | MACE-OFF runs in **float32** by default, inverting upstream's deliberate `float64` default for that model family. `MACECalculator` downcasts the checkpoint (`model.float()`) and warns — but the warning is suppressed. | **HIGH** | `calculate.py:116` passes `default_dtype=precision`; `calculate.py:228` and `app/calculate/page.tsx:144` default it to `"float32"`; upstream `foundations_models.py:366` = `float64` (verified unchanged at v0.3.6/0.3.10/0.3.13/0.3.15/0.3.16); downcast at `mace.py:312-319`; `logging.disable(logging.CRITICAL)` at `calculate_local.py:34` **[verified by reading]**; numerical impact **[reasoned, not measured]** | Default `precision` to `float64` when `modelType` is MACE-OFF, or at minimum default it to float64 for `geometry-opt` (upstream's own printed advice) and surface the choice in the UI. |
| 4 | The MD trajectory stores **potential energy only**, but the code comments, the viewer and the user-facing docs all call it *total energy* — and the docs instruct the user to check that NVE conserves it. Kinetic energy is never recorded, so that check is impossible and the chart looks non-conserving by construction. | **HIGH** | `calculate.py:342` records `get_potential_energy()`; `components/calculate/trajectory/energy-chart.tsx:7` and `trajectory/trajectory-viewer.tsx:29` say "total energy"; `app/docs/calculations/page.tsx:112` — NVE: "Total energy should stay conserved." **[verified by reading]** | Record `get_potential_energy()`, `get_kinetic_energy()` and `get_temperature()` per frame; plot total = PE + KE for NVE, or relabel everything to "potential energy" and delete the conservation claim. |
| 5 | `result["params"]` misreports what ran. `dispersion` is echoed unconditionally (`calculate.py:246`) although it is dropped on the MACE-OFF path and absent from the custom path; `precision` is echoed (`244`) although the custom path never passes it to `MACECalculator`. | **MEDIUM** | `calculate.py:114-119`, `122-137`, `240-247`; upstream `mace_off` has no `dispersion` arg (`foundations_models.py:362-368`); custom path `MACECalculator(model_paths=…, device=…)` → `default_dtype=""` → adopts checkpoint dtype (`mace.py:106, 306-311`) **[verified by reading]** | Only echo `dispersion` when a `SumCalculator` was actually built. For custom models echo the calculator's real `calc.default_dtype`, not the request. Both violate the `_build_result` contract in CLAUDE.md. |
| 6 | Geometry-opt trajectory has a **duplicated first frame** and **off-by-one step labels**. `record_opt_step()` is called manually *and* ASE calls attached observers at `nsteps == 0`. | **MEDIUM** | `calculate.py:289-297` (manual call at `296`); reproduced with ASE 3.27.0 + EMT: **5 frames, labels `[0,1,2,3,4]`, `E[0] == E[1]`, while `opt.nsteps == 3`** — and the result message reports `steps=3`, contradicting its own trajectory **[verified empirically]** | Drop the manual `record_opt_step()` (ASE already records step 0), or use `opt.nsteps` for the label instead of `len(opt_energies) - 1`. MD does not have this bug — `write_frame` uses `dyn.get_number_of_steps()` and gives a correct `md_steps + 1` frames (**verified: 11 frames / labels 0–10 for 10 steps**). |
| 7 | `dispersion=True` is offered in the UI but is **guaranteed to fail** on any deployment built from `requirements.txt`: `torch-dftd` is not listed there and is not a `mace-torch` dependency. | **MEDIUM** | `mace-api/requirements.txt` (no `torch-dftd`); PyPI `requires_dist` for mace-torch 0.3.16 and upstream `setup.cfg` extras contain no `torch-dftd`; `import torch_dftd` → `ModuleNotFoundError` in this environment; upstream raises `RuntimeError` (`foundations_models.py:306-311`) **[verified]** | Add `torch-dftd` to `requirements.txt`, or remove the toggle. Failing loudly is upstream's behaviour and is correct — but shipping a control that can only ever error is not. |
| 8 | Custom-vs-foundation comparison decides which foundation model to compare against by **substring-matching the uploaded filename** for `"off"` / `"organic"`. A MACE-OFF-derived checkpoint named anything else is compared against MACE-MP-0 — two incompatible energy reference conventions. | **MEDIUM** | `app/calculate/page.tsx:259-269` **[verified by reading]**; conventions per CLAUDE.md: MP-0 −1…−15 eV/atom vs OFF −100…−600 eV/atom | Read the element set / heads from the checkpoint, or ask the user explicitly. A filename is not a scientific fact. |
| 9 | Dependencies float across a documented upstream reproducibility break. `mace-torch>=0.3.0` is unpinned, and no result records which mace-torch produced it. | **MEDIUM** | `mace-api/requirements.txt:8`; upstream changed `mace_mp()`'s no-arg default at 0.3.10 and the docs flag it as breaking reproducibility; upstream itself hard-pins `e3nn==0.4.4` **[verified]** | Pin `mace-torch==0.3.16` (or a tested version) and record `mace.__version__` + `torch.__version__` in `result["params"]`. **Note in SimpleAtom's favour:** because `calculate.py:116/119` always pass an explicit size string, SimpleAtom is *not* affected by the 0.3.10 default change — it genuinely gets MACE-MP-0, not MPA-0. |
| 10 | Stress is computed on every call and thrown away. `CalculationResult.properties.pressure` exists in the type system but is never populated by the backend. | **LOW** | Upstream computes stress unconditionally for `model_type="MACE"` (`mace.py:607`, Voigt at `725-726`); `mace-api/calculate.py` contains no `get_stress` (grep: only `properties: {"volume": …}` at `184`); `types/mace.ts` declares `properties.pressure` **[verified]** | Read `atoms.get_stress()` for periodic systems and report pressure in GPa. Free data, zero extra compute. |
| 11 | Centre-of-mass drift is not removed after velocity initialisation. Langevin damps it and ASE's NPT strips it itself, but **NVE keeps it** — a spurious net translation and 3 extra apparent degrees of freedom. | **LOW** | `calculate.py:347`; reproduced: after `MaxwellBoltzmannDistribution(..., rng=rng)` the net momentum is `|p| ≈ 1.13`, non-zero **[verified empirically]**; ASE's NPT logs "Setting the center-of-mass momentum to zero" | Call `ase.md.velocitydistribution.Stationary(atoms)` after initialisation. Low only because SimpleAtom never reports temperature at all — see finding 4. |
| 12 | NPT has no periodicity guard and uses a deprecated ASE class. On a non-periodic structure it dies with `numpy.linalg.LinAlgError: Singular matrix`. | **LOW** | `calculate.py:353-358`; reproduced: `LinAlgError: Singular matrix` on `molecule("H2O")`; ASE 3.27.0 emits `FutureWarning: NPT thermostat has been moved/renamed to ase.md.melchionna.MelchionnaNPT`, suppressed by `calculate_local.py:18` **[verified empirically]** | Raise a clear error when `mdEnsemble == "NPT"` and `not atoms.pbc.any()`. Track the ASE rename. **Verified correct:** the `externalstress` sign convention — ASE reads a scalar as pressure, positive in compression, so `pressure_GPa * units.GPa` at `calculate.py:355` is right. |
| 13 | The `torch.load` monkeypatch is redundant with current mace-torch, is global, and is missing from the shared engine. | **INFO** | Upstream sets `os.environ["TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD"] = "1"` at `mace/calculators/mace.py:15` (present in 0.3.15 **and** 0.3.16); SimpleAtom patches globally at `calculate_local.py:24-30` and `main.py:28-34`; `calculate.py` does not **[verified]** | Harmless today and still needed for the older mace-torch that `>=0.3.0` permits. If the pin in finding 9 is applied, delete both patches. |
| 14 | Model catalogue is roughly two years behind upstream — but the names SimpleAtom offers all still exist and still mean what SimpleAtom says they mean. | **INFO** | `mace_mp_urls` now has 16 keys, `mace_off_urls` 3 (`foundations_models.py:91-115`); upstream also ships `mace_omol`, `mace_polar`, MACE-MH-0/1, MATPES variants **[verified]** | Not a bug — an outdated assumption. See the caveats below before writing any UI copy about it. |
| 15 | Device default differs from upstream (`"cpu"` vs. auto-CUDA), and `resolve_device` passes unknown device strings through unvalidated. | **INFO** | `calculate.py:98-107`, `226`; upstream `foundations_models.py:286, 418` **[verified]** | Defensible simplification for a shared web backend; the CUDA→CPU fallback is recorded in `result["params"]`, which is the important part. `get_custom_calculator:129` re-resolves an already-resolved device — harmless. |

---

## Is SimpleAtom producing scientifically wrong numbers?

**Yes — one path, and it is finding 1.**

Select "Custom model" in the calculator, do not upload a `.model` file, and press Run. The
Run button is enabled (`app/calculate/page.tsx:441` gates only on whether a structure is
present). `run_calculation` receives `modelType: "custom"` with `model_path=None`, so
`get_mace_calculator("custom", "medium", …)` falls past the MACE-OFF branch and returns
`mace_mp(model="medium", …)` (`calculate.py:114-119`). The user gets a **MACE-MP-0 medium**
energy, and `result["params"]["modelType"]` says `"custom"` (`calculate.py:242`). Shared via
MACE Link and exported to PDF, that result permanently attributes numbers to a model that was
never loaded.

The same fall-through swallows any unrecognised `modelType` string sent to the API. This is
precisely the failure mode CLAUDE.md forbids for `calculationType` — *"Never let an
unrecognised `calculationType` fall through to a default calculation — returning plausible
numbers for a calculation that never ran is worse than an error"* — applied to the model
instead of the calculation. `validate_calculation_type()` exists and is good; there is no
equivalent for the model.

**Everything else is either honest-but-imprecise, mislabelled, or an omission.** No other path
found returns a number attributable to the wrong physics. Specifically:

- Findings 2 and 6 mean a geometry-opt *result* can be presented more confidently than it
  deserves and its trajectory chart is off by one frame — but the final energy and forces are
  the true MACE values for the geometry actually reached.
- Finding 3 degrades precision; it does not change the model. See the caveat below.
- Finding 4 mislabels a real quantity rather than inventing one.
- Finding 5 misdescribes a correct calculation. Not applying D3 to MACE-OFF is the right
  physics; only the reporting is wrong.

---

## The float32 / MACE-OFF question, stated honestly

CLAUDE.md's dtype rule ("MUST use float64 for Hessian/frequency calculations") aims at a
feature SimpleAtom does not have — `phonon` is rejected, not stubbed, and that is correct.
Meanwhile upstream's actual printed recommendation targets a feature SimpleAtom *does* have:

> float32 … faster but less accurate. **Recommended for MD. Use float64 for geometry
> optimization.**
> — printed by both `mace_mp` and `mace_off` at construction
> (`foundations_models.py:291-294`, `423-430`)

So the guardrail that exists points at nothing, and the guardrail upstream states is absent.

**What I verified:** upstream's `mace_off` default has been `float64` since v0.3.6;
SimpleAtom overrides it with `float32`; `MACECalculator` downcasts the checkpoint with a
`logging.warning` that `calculate_local.py:34` suppresses.

**What I did not verify:** the size of the numerical error. That requires downloading a
MACE-OFF checkpoint and running both dtypes; I did not do it. The arithmetic argument — and it
is only an argument — is that MACE-OFF total energies carry large per-element isolated-atom
references, so a nine-atom molecule sits near −4000 eV where float32's ULP is ≈ 5 × 10⁻⁴ eV,
and a hundred-atom molecule sits near −10⁵ eV where it is ≈ 10⁻² eV, before accumulation over
the scatter-sum. Against a 1 kcal/mol ≈ 43 meV target that is comfortable for small molecules
and uncomfortable for large ones. **Treat that as a hypothesis with a cheap experiment
attached, not as a measurement.**

The experiment a critic should run, in order:

1. One MACE-OFF single-point on ethanol at float32 and at float64. Record the difference.
2. The same on a ~100-atom molecule. Record whether the difference scales.
3. A `geometry-opt` at `fmax = 0.005` (CLAUDE.md's own pre-frequency threshold) in float32.
   Does BFGS converge, or does it hit `maxOptSteps` while SimpleAtom reports "completed"?
   That is findings 2 and 3 interacting, and it is the one that would bite a real user.

---

## Verified-correct — do not "fix" these

Worth recording so a later pass does not churn them:

- **Explicit model strings.** `calculate.py:116/119` always pass a size string, so SimpleAtom
  is immune to upstream's 0.3.10 default change. "MACE-MP-0" in the UI really is MACE-MP-0.
- **No D3 on MACE-OFF.** Matches upstream, which does not even expose the parameter. Only the
  echoed `dispersion` flag is wrong (finding 5).
- **MD seeding.** `np.random.default_rng(seed)` feeding both `MaxwellBoltzmannDistribution`
  and `Langevin` is reproducible — **verified**: identical seeds gave bit-identical results.
  NPT and VelocityVerlet genuinely have no RNG of their own.
- **Langevin friction units.** `friction / units.fs` is the correct conversion and matches
  upstream's own documented usage.
- **NPT pressure sign.** ASE reads a scalar `externalstress` as pressure, positive in
  compression; `pressure_GPa * units.GPa` is right.
- **MD trajectory indexing.** `md_steps + 1` frames with labels from
  `dyn.get_number_of_steps()` — **verified correct**, unlike the geometry-opt path.
- **Custom-model dtype handling.** Omitting `default_dtype` lets `MACECalculator` adopt the
  checkpoint's own dtype (`mace.py:306-311`), which is the safest choice. Only the *echoed*
  precision is wrong.
- **`calculationType` gating.** `validate_calculation_type()` is exactly the pattern findings
  1 and 8 need copied.

---

## Caveats on this audit

- Upstream's README and its code **disagree about which checkpoint `large` is**: the code says
  `MACE_MPtrj_2022.9.model`, the README's MACE-MP-0a row says
  `2024-01-07-mace-128-L2_epoch-199.model`. I could not determine which is authoritative, so
  SimpleAtom's "Large — most accurate" copy cannot currently be validated either way.
- **MACE-OFF24** exists as a file in the `ACEsuit/mace-off` repo but is **not** wired into
  `mace_off_urls` in v0.3.16, so `mace_off(model="medium")` remains OFF23_medium. Any claim
  that SimpleAtom is "missing MACE-OFF24 support" would be wrong — upstream does not ship it
  through this API yet.
- No MACE model was downloaded or executed. Every empirical result here used ASE with an EMT
  calculator, which exercises the ASE-side control flow (optimiser observers, MD observers,
  RNG seeding, NPT preconditions) but says nothing about MACE's numerics.
- The deployed Hugging Face Space was not exercised; `main.py` was read, not run.
