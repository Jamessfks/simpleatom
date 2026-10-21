# Contributing to SimpleAtom

Thank you for helping. SimpleAtom's rule is **verify by execution**: several of
its worst bugs were code that read as correct and did the wrong thing at
runtime. A change is done when its gates pass, not when it looks right.

## Set up

See [docs/how-to/install.md](docs/how-to/install.md). Node 24 (`.nvmrc`),
Python 3.11.

## Before you open a pull request

```bash
npm run check:contract      # generated contract types and docs are fresh
npm run typecheck
node scripts/lint-baseline.mjs   # never above test_scripts/daily_gate.py LINT_BASELINE
npm test
npm run build
export KMP_DUPLICATE_LIB_OK=TRUE
python3 -m unittest discover -s test_scripts -p "test_backend_contract.py"
python3 test_scripts/validate_calculation.py --test          # all_passed: true
python3 -m unittest discover -s test_scripts -p "test_provenance.py"
python3 -m unittest discover -s test_scripts -p "test_science_regressions.py"
```

CI runs all of these on every push and pull request.

## Rules that are not negotiable

- **The backend is the boundary.** Every rule that protects correctness lives
  in `mace-api/` (`contract.py`, `calculate.py`); the UI mirror is a courtesy.
- **Never fall through.** An unsupported request raises `ContractError`. A
  plausible number for a calculation that never ran is worse than an error.
- **Change what is accepted in one place:** `mace-api/contract.json`, then
  `npm run gen:contract`, and add a case to `test/fixtures/contract-requests.json`
  (both Python and TypeScript check it).
- **Scientific code** (`mace-api/*.py`): units per the table in
  [CLAUDE.md](CLAUDE.md); float64 for geometry optimisation; seeded MD; never
  discard BFGS's convergence flag; echo effective params. Run the validator.
- **Dependencies:** the scientific stack (`mace-api/requirements.in`) is pinned
  with `==`. Bump it deliberately, regenerate the lock (command in the file), and
  the translation-invariance and golden-energy tests must pass.
- **Decisions:** a change that alters a recorded decision needs a new or
  amended [ADR](docs/adr/README.md).
- **UI:** works at 375 px, visible keyboard focus, respects
  `prefers-reduced-motion`, WCAG AA contrast, design tokens rather than hex.

## Branches and releases

`main` deploys to users (Vercel; the backend via CI only). Work on a branch and
open a pull request; security and correctness fixes are merged as soon as their
gates pass. `daily` accumulates exploratory rounds and is adopted on a cadence
([ADR-0027](docs/adr/0027-release-path.md)). Releases bump `package.json` and
`mace-api/contract.json` together and add a [CHANGELOG](CHANGELOG.md) entry.
