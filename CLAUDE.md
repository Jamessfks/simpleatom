# SimpleAtom — MACE Force Fields Web Interface

Browser-based interface for MACE (Multi-Atomic Cluster Expansion) machine learning interatomic potentials. Full-stack: Next.js 16 frontend + Python/FastAPI backend using ASE and mace-torch.

**Author:** Zicheng Zhao, Northeastern University
**Live:** https://mace-lake.vercel.app
**Version:** 2.2.0 (single source: `mace-api/contract.json` `appVersion` = `package.json`; CI checks they agree)
**Decisions:** `docs/adr/` (MADR, 33 records) · **Latest audit:** `docs/audits/2026-10-20.md`

## Architecture

```
Frontend (Next.js 16 / React 19 / TypeScript / Tailwind CSS 4)
  ├── app/calculate/       → Calculator page (upload, configure, run, view results)
  ├── app/benchmark/       → Multi-model comparison suite
  ├── app/r/[id]/          → MACE Link (shared result viewer)
  ├── app/api/jobs/        → Submit / poll / cancel calculations (the UI's path)
  ├── app/api/calculate/   → Synchronous calculation (dual-mode) + capabilities (GET)
  ├── app/api/benchmark/   → Batch benchmark endpoint
  ├── app/api/share/       → MACE Link writes (validated, server-side storage)
  └── app/api/smiles-to-xyz/ → SMILES → 3D structure conversion

Backend (Python 3.11)
  ├── mace-api/contract.json       → THE request contract: types, bounds, profiles, model registry
  ├── mace-api/contract.py         → Enforces it (ContractError with code/field/status)
  ├── mace-api/calculate.py        → Shared calculation engine (all scientific logic)
  ├── mace-api/safe_load.py        → Unpickles only SHA-256-pinned checkpoints
  ├── mace-api/jobs.py             → One-worker job queue (FastAPI)
  ├── mace-api/provenance.py       → Reproducibility manifest
  ├── mace-api/calculate_local.py  → Subprocess CLI wrapper (local mode, --progress)
  ├── mace-api/main.py             → FastAPI server (Hugging Face Space)
  ├── mace-api/smiles_to_xyz.py    → RDKit SMILES → XYZ converter
  └── test_scripts/validate_calculation.py → Scientific result validator (advisory)
```

**Dual-mode execution:**
- Local: `MACE_API_URL` not set → spawns `python3 mace-api/calculate_local.py` (profile `local`)
- Remote: `MACE_API_URL` set → forwards to the hosted API on Hugging Face Spaces (profile `hosted`)

**Data flow:** Browser → parse structure (client) → POST /api/jobs → Python (ASE + mace-torch) → poll GET /api/jobs/[id] → JSON → Plotly charts + 3Dmol.js visualization

## Key Files

| Area | Files |
|------|-------|
| **Request contract** | `mace-api/contract.json` (edit) → `npm run gen:contract` → `lib/generated/contract.ts`, `docs/reference/contract.md`; mirror in `lib/contract.ts`; fixtures in `test/fixtures/contract-requests.json` |
| **Calculation API** | `app/api/jobs/*`, `app/api/calculate/route.ts`, `app/api/benchmark/route.ts`, `lib/server/{backend,jobs,local-jobs}.ts`, `lib/api-client.ts` |
| **SMILES conversion** | `app/api/smiles-to-xyz/route.ts`, `mace-api/smiles_to_xyz.py` |
| **Python backend** | `mace-api/calculate.py` (shared engine), `mace-api/calculate_local.py` (CLI), `mace-api/main.py` (FastAPI) |
| **Calculator UI** | `app/calculate/page.tsx`, `components/calculate/*.tsx` |
| **SMILES input** | `components/calculate/smiles-input.tsx` |
| **Molecular editor** | `components/calculate/ketcher-editor.tsx` (Ketcher 2D/3D editor) |
| **Benchmark UI** | `app/benchmark/page.tsx`, `components/benchmark/*.tsx` |
| **Type definitions** | `types/mace.ts` |
| **Structure parser** | `lib/parse-structure.ts` (XYZ, CIF, POSCAR, PDB) |
| **Benchmark catalog** | `lib/mlpeg-catalog.ts` (14 embedded structures) |
| **Sharing** | `app/api/share/route.ts`, `lib/server/share-store.ts` (server-only), `lib/share.ts`, `supabase/migrations/` |
| **Visualization** | `components/calculate/molecule-viewer-3d.tsx` (3Dmol.js), `components/calculate/weas-viewer.tsx` (WEAS CDN) |
| **Charts** | `components/calculate/charts/*.tsx`, `components/calculate/trajectory/*.tsx` |
| **PDF export** | `components/calculate/pdf-report.tsx` (button) + `pdf-report-document.tsx` (loaded on click) |
| **Validation** | `test_scripts/validate_calculation.py` |

## Development Commands

```bash
# Frontend
npm run dev          # Next.js dev server (localhost:3000)
npm run build        # Production build (catches type errors)
npm run lint         # ESLint (CI: node scripts/lint-baseline.mjs — never above LINT_ERROR_BASELINE / LINT_WARNING_BASELINE)
npm run typecheck    # tsc --noEmit
npm test             # vitest (contract fixtures, parser, upload names, share)
npm run gen:contract # after editing mace-api/contract.json (CI: npm run check:contract)

# Backend
cd mace-api && pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 7860

# Validation (export KMP_DUPLICATE_LIB_OK=TRUE on macOS)
python test_scripts/validate_calculation.py --test    # Full scientific validation suite
python -m unittest discover -s test_scripts -p "test_backend_contract.py"     # contract, checkpoint trust, guards
python -m unittest discover -s test_scripts -p "test_science_regressions.py"  # D5/D6/D16/D18, MPA-0 pin, translation invariance
python test_scripts/daily_gate.py --no-bars           # every gate at once

# Quick calculation test
python mace-api/calculate_local.py public/demo/ethanol.xyz \
  '{"calculationType":"single-point","modelType":"MACE-OFF","modelSize":"small"}'
```

## Agent & Model Tier Strategy

When spawning subagents or choosing model complexity, follow this tier system:

| Tier | Model | Use For |
|------|-------|---------|
| **Tier 1 (Opus)** | `opus` | Scientific code changes in `mace-api/`, architecture decisions, security review, production deploys |
| **Tier 2 (Sonnet)** | `sonnet` | Frontend components, UI bugs, test writing, documentation, general debugging |
| **Tier 3 (Haiku)** | `haiku` | File lookups, grep searches, simple formatting, quick linting, status checks |

**Subagent patterns for this project:**
- **Frontend + Backend in parallel**: When a feature spans both, spawn one agent for TypeScript changes and one for Python changes — they don't share files
- **Validate after scientific changes**: After any edit to `mace-api/*.py`, spawn a validation agent to run `python test_scripts/validate_calculation.py --test`
- **Build check after frontend changes**: After UI/component changes, run `npm run build` to catch type errors early
- **Research agents**: Use `Explore` subagent type for codebase questions; use `WebSearch`/`WebFetch` for MACE/ASE documentation lookups

## Scientific Accuracy Rules

**CRITICAL — Always follow these when writing or modifying scientific code:**

### Units (MACE + ASE Convention)
| Quantity | Unit | Notes |
|----------|------|-------|
| Energy | **eV** | electron volts |
| Forces | **eV/Å** | per-atom 3-vector |
| Distances | **Å** | Angstroms |
| Stress | **eV/Å³** internal; **GPa** in results | Voigt (xx, yy, zz, yz, xz, xy); fully periodic cells only |
| Temperature | **K** | Kelvin |
| Time | **fs** | always use `ase.units.fs` for conversion |
| Pressure | **eV/Å³** internal; **GPa** user-facing | convert with `ase.units.GPa`; nothing uses bar |

### Model Selection
The registry in `mace-api/contract.json` is the single source of truth (ADR-0021). Never
hard-code a model id, size, element list or licence anywhere else — read it from the
registry (`contract.find_model()` in Python, `findModel()` in `lib/contract.ts`).
- **MACE-MPA-0** (default): materials, crystals, surfaces — 89 elements, PBE/PBE+U
  (MPtrj + sAlex); upstream's own `mace_mp()` default since v0.3.10; `medium` only; MIT
- **MACE-MP-0**: the 2023 materials model, kept for reproducing earlier results; MIT
- **MACE-OFF** (alias MACE-OFF23): organic molecules only (H,C,N,O,F,P,S,Cl,Br,I) —
  ωB97M-D3(BJ) DFT (SPICE); **ASL, non-commercial** — results carry `licenseNotice`
- Not offered (all ASL): OMAT-0, MATPES, MH-1, OMOL, POLAR-1 (ADR-0018)
- **D3 dispersion**: only for the MACE-MP family (`dispersion.allowed` in the registry)
- **Checkpoints are SHA-256 pinned.** `safe_load.trusted_checkpoints()` is the only place
  `torch.load` may unpickle. Never patch `torch.load` globally, never pass a user string
  to `mace_mp(model=...)`/`mace_off(model=...)` — sizes go through the registry (ADR-0020)

### Energy Reference Conventions
- **MACE-MP family** (MPA-0, MP-0): typically -1 to -15 eV/atom; validator enforces -20 to +100
- **MACE-OFF**: E/N depends on the elements present (water ≈ −694, CH2Br2 ≈ −28233 eV/atom), so no raw
  band applies (D52). Results carry `properties.energyPerAtomVsIsolatedAtoms`, (E − Σ E0)/N against the
  model's own isolated atoms: typically −6 to −0.5 eV/atom; validator enforces −10 to +1
- Custom checkpoints: unknown convention — the range check is skipped
- Bounds live in `contract.json` `energyConventions` (enforced vs typical)
- Catalog reference energies are **EXPERIMENTAL**, not DFT — always note this in comparisons

### Supported Calculation Types
- Exactly three are implemented: `single-point`, `geometry-opt`, `molecular-dynamics`
  (`SUPPORTED_CALCULATION_TYPES` in `mace-api/calculate.py`)
- `phonon` exists in the `CalculationType` TS union and as a disabled UI option, but has
  **no backend implementation**. It is rejected with an error, not stubbed
- **Never** let an unrecognised `calculationType` fall through to a default calculation —
  returning plausible numbers for a calculation that never ran is worse than an error
- The Python backend is the security boundary (the API can be called directly); the
  TypeScript mirror (`lib/contract.ts`) is a fast check, not a substitute
- Every enumerated input is an allow-list and every number must be finite and in range;
  steps, atoms, uploads and wall time are capped per profile. Refuse with `ContractError`
  (code, field, HTTP status) — never coerce (`bool("false")` is True)

### Geometry Optimization
- Optimizer is **BFGS only** — hardcoded in `_run_geometry_opt`, with no optimizer
  parameter. Do not document or offer FIRE unless it is actually wired up
- `fmax`: 0.05 eV/Å (general), 0.01 eV/Å (production), 0.005 eV/Å (before frequencies)
- Always set `maxOptSteps` to prevent infinite loops
- Only atomic positions optimized (no cell optimization currently)
- **Use `float64` for geometry optimization**, `float32` for MD. This is upstream's own
  guidance, printed on every run (`foundations_models.py`, both `mace_mp` and `mace_off`).
  Note `mace_off()` defaults to `default_dtype="float64"` while `mace_mp()` defaults to
  float32 — never override either without recording the override in `result["params"]`
  and `result["warnings"]`
- `BFGS.run()` returns a convergence bool. **Never discard it.** A run that exhausts
  `maxOptSteps` without reaching `fmax` is not a relaxed minimum, and reporting it as
  "completed" is the same class of error as returning a calculation that never ran

### Molecular Dynamics
- NVT: Langevin thermostat with friction, **`fixcm=False`**. ASE's default `fixcm=True`
  mass-weights its centre-of-mass correction wrongly for mixed masses — ethanol ran at
  417 K for a 300 K target (D18). Do not switch it back
- NPT: `ase.md.melchionna.MelchionnaNPT` (`ase.md.npt.NPT` is a deprecated alias), fully
  periodic cell required (refused otherwise), `pfactor = (75 fs)² × 100 GPa` (D17)
- NVE: No thermostat (microcanonical)
- Temperature is reported over the degrees of freedom that carry energy: 3N for NVT,
  3N−3 for NVE/NPT (COM momentum stays zero) — recorded as `temperatureDegreesOfFreedom`
- Always initialize velocities with `MaxwellBoltzmannDistribution`
- Typical timestep: 0.5–2.0 fs (smaller for light elements like H)
- **Reproducibility**: every stochastic source must be seeded. MD has two —
  `MaxwellBoltzmannDistribution(rng=...)` and `Langevin(rng=...)` — and both are fed from
  one `np.random.default_rng(seed)` (`DEFAULT_MD_SEED = 42`, override via `params["seed"]`).
  NPT and VelocityVerlet have no RNG of their own. An unseeded trajectory cannot be verified
  by anyone, including its author. The seed used is recorded in `result["params"]` and in
  `result["message"]` (the message survives PDF export and MACE Link sharing)

### Vibrational Analysis
> Not implemented. SimpleAtom rejects `phonon`; these are conventions for if it is ever
> built, not rules the current code enforces.
- `float64` for Hessian/frequency work is a **SimpleAtom convention, not an upstream rule**.
  Upstream states no such requirement, and `MACECalculator.get_hessian()` inherits
  `self.default_dtype` with no dtype guard. Do not cite it as coming from MACE
- Structure MUST be at local minimum first (fmax < 0.005 eV/Å)
- Imaginary frequencies at non-transition-state = incomplete optimization
- For molecules: expect 3N-6 real frequencies (3N-5 for linear)

### Common Pitfalls
1. Never mix units — MACE outputs eV/Å, ASE uses eV/Å internally
2. PyTorch 2.6+ refuses to unpickle MACE checkpoints by default, and importing `mace` sets
   `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` process-wide. Load checkpoints only through
   `safe_load.trusted_checkpoints()`, which passes `weights_only` explicitly
3. The MACE-MP family is PBE-level: it inherits PBE's differences from experiment, which depend on the
   material and the property (silicon: MPA-0 relaxes to a = 5.467 Å vs 5.4309 Å measured, COD 9011998).
   Never quote a single eV/atom error band; none has a source (D85)
4. Don't enable D3 dispersion with MACE-OFF (double-counting)
5. Devices (ADR-0031): the hosted profile refuses `cuda` (`device_unavailable`); a local run
   asking for CUDA that PyTorch cannot see falls back to CPU **with a warning and
   `params.requestedDevice`** — never silently. CUDA out-of-memory is `cuda_out_of_memory`,
   never a silent CPU retry. `/capabilities` lists only usable devices
6. Extended XYZ metadata keys vary: check REF_energy, ref_energy, energy, dft_energy
7. RMS force formula: `sqrt(Σ|F_i|² / N_atoms)` — not `sqrt(Σf² / 3N)`
8. Results must be self-describing: `_build_result()` echoes the *effective* parameters
   (defaults resolved, CUDA→CPU fallback applied, MD seed recorded) into `result["params"]`.
   The validator picks its model-aware energy bounds from this — without it every result is
   judged as `modelType: "unknown"` and MACE-OFF's isolated-atom band never
   applies. Echo an explicit key allow-list, never the raw request dict

## Code Style

- **Frontend**: TypeScript strict, React 19 hooks, Tailwind CSS 4, shadcn/ui (New York style)
- **Backend**: Python 3.11, type hints, JSON stdout for subprocess communication; dependencies pinned with `==` in `mace-api/requirements.in` + hashed `requirements.lock.txt` (ADR-0025)
- **Charts**: Plotly.js with Paul Tol colorblind-safe palette
- **3D Viewers**: 3Dmol.js (npm) + WEAS (CDN iframe, version pinned with SRI)
- **Theme**: Light by default — warm off-white canvas (`#FBFAF7`) with a green accent (`#4F9A54`), driven by CSS custom properties (`--color-*`) on `:root`. A dark (navy) theme is preserved under `.dark` for a possible future toggle but is not currently reachable in the UI. See `app/globals.css`. The semantic tokens are Tailwind utilities through `@theme inline` (`text-text-muted`, `bg-accent-soft`, `border-border-subtle/40`): use them, not `[var(--color-…)]` or hex literals.
- **Components**: Use `components/ui/` for shadcn base; domain components in `components/calculate/` or `components/benchmark/`
- **Imports**: Use `@/` path alias (maps to project root)

## Testing & Validation

CI (`.github/workflows/ci.yml`) runs everything below on every PR and on pushes to `main`, `daily` and `v*`; the HF Space
deploys only after it passes on `main`. Run it locally before pushing.

### Before Merging Any Scientific Code Change
1. Run `python test_scripts/validate_calculation.py --test` — must pass all checks
2. Run the contract, provenance and science-regression suites (commands above)
3. A mace-torch/torch/ase bump must pass `TestTranslationInvariance` and the golden energies
4. Verify energy bounds, force magnitudes, unit consistency

### Before Merging Any Frontend Change
1. `npm run check:contract && npm run typecheck && npm test && npm run build`
2. `node scripts/lint-baseline.mjs` — never above `LINT_ERROR_BASELINE` or `LINT_WARNING_BASELINE` (lower them when you fix things)
3. Test the affected page in the browser — on the dev server of the branch under test

### Automated Validator Checks
- Energy bounds (model-aware, from the registry: MACE-MP family vs MACE-OFF; skipped for custom)
- Force magnitude and conservation (net force ≈ 0 for molecules)
- Interatomic distances over every pair, minimum image in a cell (overlap < 0.4 Å is an issue)
- Lattice validity (positive volume, 3x3 matrix)
- MD: NaN/Inf; NVE total-energy excursion per atom (> 0.05 eV/atom is an issue) and fitted drift;
  NVT/NPT second-half mean temperature against the target (> 2× is an issue)
- Parameter sanity (D3+MACE-OFF double-counting)

### Manual Verification Checklist
1. Energy in reasonable range per model convention
2. Forces < 10 eV/Å for reasonable structures (> 50 eV/Å = overlapping atoms)
3. RMS force decreases monotonically during optimization
4. MD energy conserved in NVE; fluctuates around target T in NVT
5. Lattice vectors form right-handed coordinate system
6. Volume positive for periodic systems

## Deployment

```
Vercel (Frontend, deploys main) → Supabase PostgreSQL (shared_results, via /api/share only)
                                → Hugging Face Space (FastAPI on port 7860, deployed only by CI)
```

**Env vars** (full table: `docs/reference/environment.md`):
- `MACE_API_URL` — hosted backend; omit for local subprocess mode
- `MACE_API_TOKEN` — shared secret on Vercel and the Space
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — MACE Link
- `SUPABASE_SERVICE_ROLE_KEY` — server-only; required before `supabase/migrations/0003_lockdown.sql`
- `SIMPLEATOM_PROFILE` (`hosted`/`local`), `ALLOW_CUSTOM_MODELS`
