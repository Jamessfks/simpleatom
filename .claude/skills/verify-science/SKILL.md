---
name: verify-science
description: Check a SimpleAtom scientific change by running it before calling it done. Runs the gates and the refusal guards (checking their JSON, not their exit code), measures run-to-run noise, and has the science-critic agent recompute the golden cases independently. It reports each delta against a tolerance derived from the measured noise. Use after any edit to mace-api/, contract.json, a golden value, or a number on a validation page. It is the science counterpart of verify-ui.
---

# Verify a scientific change

A number is verified only when it has been recomputed by code that is not SimpleAtom's, and
the difference is inside a tolerance measured on this machine. Reading the diff is not
verification (docs/v2/SUCCESS-CRITERIA.md: "the claim was read, not run").

## 0. Environment and build under test

```bash
export KMP_DUPLICATE_LIB_OK=TRUE            # macOS, or OMP Error #15
PY=<pinned 3.11 env>/bin/python             # built from mace-api/requirements.lock.txt
$PY -c "import sys,torch,ase;from importlib.metadata import version as v;print(sys.version.split()[0],torch.__version__,ase.__version__,v('mace-torch'))"
git rev-parse --short HEAD && git status --short
```

The output must show 3.11, torch 2.10.0, ase 3.27.0 and mace-torch 0.3.16. The repo-root
`.venv` is not the pinned stack. Write the SHA and the dirty state into the report.

## 1. Gates

```bash
PATH=$(dirname $PY):$PATH python3 test_scripts/daily_gate.py --no-bars   # add --quick if no TS changed
```

Every line must read `[PASS]`, and the test counts must not fall (provenance 40,
contract ≥ 20, science ≥ 9). Quote the GATES block verbatim.

## 2. Guards: read the JSON

Never judge a guard by its exit code: older builds exited 0 on refusal (v2.2.0 exits 1).
A guard passes only when its stdout is `{"status": "error", "error": {"code": ...}}` with
the expected code:

```bash
for p in '{"calculationType":"phonon"}' '{"modelType":"custom"}' '{"modelType":"MACE-MP"}'; do
  $PY mace-api/calculate_local.py public/demo/ethanol.xyz "$p" | $PY -c \
    "import json,sys;d=json.load(sys.stdin);e=d.get('error') or {};print(d['status'],e.get('code'),e.get('field'))"
done
# expect: error unsupported_calculation calculationType / custom_model_missing modelType / unsupported_model modelType
```

Add one guard for every new refusal the change introduces (a new `ContractError` code).

## 3. Noise: the tolerance comes from here

```bash
$PY .claude/skills/verify-science/noise.py <structure> '<params json>' --threads 1 2 --runs 3
```

Run it for every golden case the change touches. Each case's tolerance is
`max(5 × spread, 64 × eps(dtype) × |value|)`. If `effectiveParamsConsistent` is false, or
anything appears under `refusals`, stop: the run itself is not reproducible.

Golden cases (run these whenever the engine changes):

| Case | Structure | Params |
|---|---|---|
| Molecule, OFF | `public/demo/ethanol.xyz`, a water XYZ | `MACE-OFF`, `small` |
| Crystal, MPA-0 | `public/demo/silicon.cif` | `MACE-MPA-0`, `medium` |
| Crystal, MP-0 | `public/demo/silicon.cif` | `MACE-MP-0`, `medium` |
| MD, one per ensemble | ethanol (NVE, NVT), silicon (NPT) | seed 42, 1 fs, ≥ 200 steps |

## 4. Independent recomputation

Hand the result JSON, the structure paths, the measured spreads, the pinned Python path
and a scratchpad directory to the `science-critic` agent. If that agent cannot be
selected in the session, run a `general-purpose` subagent whose prompt is the body of
`.claude/agents/science-critic.md`, followed by the brief. The critic never sees
SimpleAtom's code paths as the recomputation. Its scripts import only `ase`, `numpy`,
`torch` and `mace`.

Never put the owner's name, email addresses or other personal information into any
request, header (User-Agent included), URL, form, commit, PR, page or file. Paste that
sentence into the critic's brief whenever it will fetch references.

## 5. Report

One table per case:

| Quantity | SimpleAtom | Independent | Δ | Tolerance | Spread (n) | Verdict |
|---|---|---|---|---|---|---|

After the table, give the critic's `PICK` or `DISAGREEMENTS` verbatim, then anything
UNVERIFIED, with the reason and how to verify it. A disagreement is fixed, or recorded as
a defect in `docs/v2/defects.json` with its evidence command. It is never waved through.
