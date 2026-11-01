# Changelog

All notable changes to SimpleAtom. Versions follow [semantic versioning](https://semver.org/);
`package.json` and `mace-api/contract.json` carry the same version (CI checks).

## [2.2.0] — tagged 2026-10-20, not deployed

The `v2.2.0` tag exists in the development repository only; production still ran 1.3.0 on
2026-10-31 (see docs/audits/2026-10-28.md).

The result of a full audit ([docs/audits/2026-10-20.md](docs/audits/2026-10-20.md)).

### Security
- **The hosted backend could be made to execute a file of the caller's choosing.** A process-wide
  `torch.load(weights_only=False)` patch, public custom-model uploads, and an unvalidated
  `modelSize` (which upstream treats as a URL or path to download and unpickle) are gone. Only
  checkpoints whose SHA-256 is pinned in `mace-api/contract.json` are ever unpickled; custom
  checkpoints are refused on the public instance, and locally they are opt-in
  (`ALLOW_CUSTOM_MODELS=1`, loopback only; see Unreleased)
  ([ADR-0020](docs/adr/0020-trusted-checkpoint-loading.md)).
- Next.js 16.1.6 → 16.4.2 (critical request-smuggling advisory), Ketcher 3.18, nanoid 5.1.16:
  0 advisories in production dependencies (27 before).
- Local mode no longer writes uploads under the client's filename (`../../x` escaped the temp
  directory).
- Every request is bounded: parameters must be finite and in range; atoms, steps, uploads, SMILES
  length, benchmark size and wall time are capped per deployment
  ([request contract](docs/reference/contract.md)).
- MACE Link writes go through a validating server route; the browser no longer holds a database
  client. Schema and policies are in `supabase/migrations/`.
- Baseline security headers; WEAS pinned with Subresource Integrity; inline structure data
  escaped; the backend dropped wildcard CORS and accepts an optional proxy key.

### Changed
- **The default materials model is now MACE-MPA-0** — upstream's own `mace_mp()` default since
  v0.3.10 (Matbench Discovery F1 0.852, MAE 0.028 eV/atom vs MP-0's 0.669 / 0.057). Requests
  without a `modelType` now return MPA-0 numbers; MACE-MP-0 remains selectable to reproduce
  earlier results. MACE-OFF results carry its non-commercial licence notice
  ([ADR-0021](docs/adr/0021-model-registry-mpa0-default.md)).
- Calculations run as **jobs** with real progress (the BFGS or MD step, not an estimate) and a
  working Cancel ([ADR-0023](docs/adr/0023-calculations-as-jobs.md)).
- The scientific stack is pinned exactly (mace-torch 0.3.16, torch 2.10.0 CPU, ASE 3.27.0) with
  a hashed lock, so upstream's incompatible MACE v1.0 cannot arrive unannounced
  ([ADR-0025](docs/adr/0025-pin-scientific-dependencies.md)).
- Landing copy no longer claims "quantum-accurate" results or that calculations run "entirely
  in your browser" (they run on a server).
- **App screens polished** ([ADR-0029](docs/adr/0029-app-finish-bar.md)):
  - The calculator now shows a "What will run" summary before you run anything. It lists the
    structure, the model and its licence, the calculation settings with units, the precision and
    why, and whether the job fits this deployment's limits. After a run it folds to one line, so
    the result is at the fold.
  - Steps are numbered and labels are in sentence case. Mono is used only for values.
  - Nothing is smaller than 12 px. Text, control borders and the focus ring meet WCAG AA.
  - Controls have 44 px hit areas on phones and touch screens, and there is a skip link.
  - The benchmark list shows every structure instead of a hidden scroll region.
  - Colour tokens are Tailwind utilities (`text-text-muted`, `bg-accent-soft`); 933 one-off
    `[var(--color-…)]` classes were replaced with no visible change (pixel-diffed).

### Fixed
- **NVT molecular dynamics ran ~39% hot for molecules with mixed masses**: ASE's default
  `Langevin(fixcm=True)` mis-weights its centre-of-mass correction. Ethanol at a 300 K target
  equilibrated at 417 K; it now equilibrates at 299 K. MD temperatures are also reported over
  the correct degrees of freedom (D8, D18).
- Multi-frame files computed the last frame while the preview showed the first (D16).
- The NPT barostat was ~47× softer than intended (D17); it uses `MelchionnaNPT` now.
- Geometry-optimisation trajectories duplicated frame 0 (D5).
- Stress and pressure (GPa) are reported for periodic cells (D6).
- Refusals return 4xx instead of 500 (D4); an unknown MD ensemble, a string `"false"` for D3,
  NaN parameters and NPT on a molecule are refused instead of silently mis-run.
- A sharing outage no longer says the result does not exist; unknown links are real 404s.
- The production build no longer fails without Supabase variables.
- The footer ran edge to edge on every server-rendered page (`/`, `/docs`, `/r/…`, 404s) while
  the header stayed centred: a "use client" module's exported constant arrives in a server
  component as a client reference, not a string.
- The validator reported energy per atom in "eV" instead of "eV/atom". Its force thresholds now
  carry units too.
- At phone width, the Precision select ran under the Device select, and the result tabs and
  export buttons pushed the page sideways. Info icons could not be opened by touch.
- Primary buttons lightened on hover to 4.3:1 contrast. They now darken instead (7.1:1).
- 3D viewer:
  - Each model got its own silent force-arrow scale: MACE-OFF drew larger forces with shorter
    arrows than MACE-MP-0 on the same molecule. The scale now depends only on the geometry, and
    the legend says when a small screen shortens it (D9).
  - Hide C–H re-zoomed the molecule by 1.41×; the frame now stays put.
  - The selected atom's highlight was nearly invisible; it is drawn in solid green (D13).
- With a result loaded, the shared-result page was 724 px wide on a 375 px phone; it now fits.
- From `daily`: the comparison baseline is chosen from the structure, not the filename (D1); the
  validator and the git commit now reach the deployed container (D2, D3).

### Added
- CI on every push and pull request (typecheck, lint baseline, unit tests, build, audit,
  validator, provenance, science regressions, a Docker smoke test); the Space deploys only from
  CI ([ADR-0026](docs/adr/0026-ci-gates-every-merge.md)).
- 31 architecture decision records ([docs/adr](docs/adr/README.md)), including ADR-0030 (stay on
  mace-torch 0.3.x until a released v1.0 passes an engine-parity gate), restructured contributor
  docs, CONTRIBUTING, SECURITY, CITATION, THIRD-PARTY-NOTICES.
- Error pages, per-page titles, lazy-loaded PDF engine and 3D viewers.

## [2.1.0] — 2026-08-10

- Every result carries a reproducibility manifest: the SHA-256 of the checkpoint actually
  loaded, `mace-torch`/`torch`/`ase`/`numpy` versions, the input structure hash, device,
  precision, MD seed and the source commit with a dirty flag.
- An advisory validator runs on every calculation and reports alongside the result.
- The Run Configuration no longer shows parameters of a run that never happened; compute time and
  round-trip time are separated, with no invented precision.
- 3D viewer: click atoms to measure bond length, angle (vertex named) and signed dihedral;
  ambient occlusion renders for the first time; better framing; settings menu with PNG export.
- Fixed horizontal overflow of `/calculate` on phones.

## [2.0.0] — 2026-08-09

- Calculations fail loudly: `calculationType` and `modelType` are allow-listed in the backend;
  `custom` without a checkpoint no longer returns MACE-MP-0 numbers.
- Geometry optimisation reports whether it actually converged.
- Results echo the parameters that actually ran.
- MD is reproducible (seeded) and records potential, kinetic and total energy plus temperature;
  centre-of-mass drift is removed.
- CIF fractional coordinates are converted through the cell (silicon was packed into a 1 Å box);
  D3 dispersion works (torch-dftd added); precision follows upstream's defaults.

## [1.3.0] — 2026-04

- Redesign: a warm light theme with a green accent and a serif display face; rebranded to
  SimpleAtom; in-app documentation; SMILES → 3D and a molecular sketcher; local history;
  accessibility (keyboard, ARIA, reduced motion, Paul Tol palette).

[2.2.0]: https://github.com/Jamessfks/simpleatom/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/Jamessfks/simpleatom/releases/tag/v2.1.0
[2.0.0]: https://github.com/Jamessfks/simpleatom/releases/tag/v2.0.0
[1.3.0]: https://github.com/Jamessfks/simpleatom/releases/tag/v1.3.0
