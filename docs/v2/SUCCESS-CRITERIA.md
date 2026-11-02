# SimpleAtom — success criteria and bars

The single reference the daily routine reads. Bars verified reachable **2026-09-11**.
State lives in `progress.json` (pieces) and `defects.json` (backlog). Method and history
live in [`CONTINUE.md`](CONTINUE.md).

---

## What counts as a win

A piece is won when **a separate critic with fresh context, shown ours and the bar blind
with the labels stripped, picks ours.** Not a score out of ten. A pick.

Three things disqualify a verdict, no matter how confident it sounds:

1. **The bar was not actually fetched.** A critic working from prose about Rowan's results
   screen is inventing the comparison. If the bar did not load, the verdict must say so.
2. **The claim was read, not run.** Six of this project's defects were code that reviews as
   correct and does nothing at runtime — a dead validator bound, an ambient-occlusion check
   that failed on every capable machine, guards nothing ever called. Verify by execution.
3. **The wrong build was measured.** Confirm the dev server is serving the branch under test
   before judging a pixel of it.

Current score: **4 of 13 winning blind.** That counter says nothing about the ~20 scientific
defects fixed along the way, which is where most of the value has landed. Both numbers show
on `/v2`.

---

## Hard gates — must be green before any judging

Run by `python3 test_scripts/daily_gate.py`. Every number here was measured, not assumed.

| Gate | Bar | Notes |
|---|---|---|
| `npm run build` | compiles | A type error blocks every other piece |
| `npx eslint .` | **≤ 11 errors and 0 warnings** | Counted separately since 2026-11-01 (D88; `LINT_ERROR_BASELINE`, `LINT_WARNING_BASELINE`), so a new error cannot hide behind a fixed warning. Monotonically non-increasing |
| `validate_calculation.py --test` | `all_passed: true` | The scientific gate |
| `test_provenance.py` | **40 tests, OK** | Count is part of the gate; deletions are regressions |
| `test_backend_contract.py` | **≥ 20 tests, OK** | Contract, checkpoint trust, CLI guards, shared fixtures (v2.2.0) |
| `test_science_regressions.py` | **≥ 9 tests, OK** | D5/D6/D16/D18, MPA-0 pin, translation invariance (v2.2.0) |
| `public/demo/silicon.cif` | nearest neighbour **2.3516 Å** (a·√3/4) | Regresses to ~0.43 Å if fractional-coordinate handling breaks |

**Guards that must keep failing loudly.** If any returns a result, a silent fallthrough is
back — the worst defect class this project has: plausible numbers for a calculation that
never ran, shareable via MACE Link and exportable to PDF.

```bash
python3 mace-api/calculate_local.py public/demo/ethanol.xyz '{"calculationType":"phonon"}'
python3 mace-api/calculate_local.py public/demo/ethanol.xyz '{"modelType":"custom"}'
python3 mace-api/calculate_local.py public/demo/ethanol.xyz '{"modelType":"MACE-MP"}'
```

Judge each guard by its JSON, never by its exit code. `calculate_local.py` reports a refusal
as `{"status":"error","error":{"code":…}}` on stdout. Older builds exited 0 on refusal
(v2.2.0 exits 1), so an exit-code check passed every guard while they were broken.

Set `KMP_DUPLICATE_LIB_OK=TRUE` or the Python gates die with OMP Error #15 on macOS.

---

## The bars

Seven, each owning the surface it is actually best at. Two are new as of 2026-09-11 and were
added to close the hole named in `CONTINUE.md`: **Rowan's job-config and results screens are
behind a login**, which is the most common way this method fails.

| # | Bar | Owns | Fetchable today |
|---|---|---|---|
| 1 | [Rowan](https://rowansci.com) · [viewer embed](https://labs.rowansci.com/iframe2/calculation/c1cd40a2-f781-4be0-8c68-b6b4e681b9b5?auto-rotate=false&no-border=true) | Interface, landing, nav, mobile, share embed | **200.** Marketing site + production viewer public; app screens **login-gated** |
| 2 | [Materials Project](https://next-gen.materialsproject.org/materials/mp-149) | Data density, results layout | **403 to curl** — Cloudflare. Real in a browser only |
| 3 | [ACEsuit/mace](https://github.com/ACEsuit/mace) | Scientific correctness | **200.** Fully public |
| 4 | [Mol*](https://molstar.org/viewer/) | Viewer controls, settings, measurement | **200.** Fully public **and interactive** — no login |
| 5 | [Matbench Discovery](https://matbench-discovery.materialsproject.org/) | The numeric half: what MACE actually scores | **200.** Fully public leaderboard |
| 6 | [NOMAD](https://nomad-lab.eu/prod/v1/gui/search/entries) · [API](https://nomad-lab.eu/prod/v1/api/v1/entries?page_size=1) | Provenance, result metadata | **200.** Public GUI **and** REST API |
| 7 | [Schrödinger](https://www.schrodinger.com) | App-screen finish: type scale, spacing rhythm, CTA treatment, contrast (ADR-0029) | **200.** Public marketing site; the products themselves are not public, so a critic judges *finish*, not workflow |

Detail files: [`bars/materials-project.md`](bars/materials-project.md),
[`bars/acesuit-mace.md`](bars/acesuit-mace.md).

### Why bars 4–6 were added

**Mol\*** is the strongest public web structure viewer in existence and needs no account.
Rowan's embed is public but is one preconfigured calculation; Mol\* exposes a full control
surface — measurement, selection, representation, component trees, screenshot with state,
session export. `viewer-chrome` has lost three rounds against Rowan's *thinner* control
surface. Mol\* is the harder and more honest bar for that piece.

**Matbench Discovery** supplies the measurable half, and it is a bar SimpleAtom can lose
without writing a line of UI. It publishes what the model SimpleAtom runs actually scores:

| Model | Rank | F1 | DAF | MAE | RMSD | κ<sub>SRME</sub> | CPS |
|---|---|---|---|---|---|---|---|
| MACE-MP-0 | 36 | 0.669 | 3.777 | 0.057 eV | 0.091 Å | 0.682 | 0.637 |
| **MACE-MPA-0** (SimpleAtom's default since v2.2.0) | 22 | 0.852 | 5.582 | 0.028 eV | 0.073 Å | 0.412 | 0.795 |

Ranks are of 43 models on the leaderboard, retrieved 2026-10-28 (they were 34 and 21 on
2026-09-11). Ranks move; the single source the app renders is `app/v2/bars.ts`.

Two criteria follow directly. **(a)** No SimpleAtom surface may imply DFT-equivalent accuracy
without the qualifier these numbers support — MACE-MP-0 is rank 36 of 43, and "DFT-accuracy" in the
README is a claim this table adjudicates. **(b)** MACE-MPA-0 beats MACE-MP-0 on every metric
published; until v2.2.0 SimpleAtom offered it nowhere (it is now the default). That was a product gap a critic could name without
opening a browser.

**NOMAD** is the provenance bar, and the only *public* production system that presents a
result's full lineage. Its entry metadata carries `nomad_version`, `nomad_commit`,
`parser_name`, `license`, `authors`, `references`, `datasets`, `processing_errors`,
`publish_time`. SimpleAtom's manifest already matches or exceeds it locally — checkpoint
SHA-256, package versions, structure hash, `code.gitCommit` + `gitDirty` — but
**`gitCommit` is null in the deployed container**, so the live site's provenance is weaker
than the bar's. See `D3` in `defects.json`.

---

## Per-piece criteria

| Piece | Bar | Passes when |
|---|---|---|
| `viewer-render` ✅ won | Rowan embed | Fill fraction ≥ 0.80 (ours 0.8106, bar ~0.74); arrows on/off move the bbox 0 px; reset restores byte-identically |
| `viewer-interact` ✅ won | Rowan embed / Mol\* | Every displayed value correct to shown precision against the raw XYZ; bonded vs non-bonded distinguished; angle vertex named |
| `viewer-chrome` ⏳ r3, **lost** | **Mol\*** | Toggling any control changes apparent molecule size by **0 %** (currently: Hide C–H scales 1.44× and clips; rotate resizes 27–30 %) |
| `landing` ⏳ r5, **lost** | rowansci.com | Blind pick at 1280 **and** 375. Proof above the fold; no gesture manual as the lowest hero element |
| `config` ⏳ r1 judging | Rowan feature pages | Every parameter carries its unit and its default; unsupported options refuse rather than disable silently |
| `results` ✅ won | MP mp-149 | Every value carries its unit inline — no bare numbers anywhere in the UI |
| `honesty` ⏳ r1 judging | The code itself + **Matbench Discovery** | No claim on any surface that the code cannot perform or the leaderboard contradicts |
| `provenance` ⏳ r2 | MP Property Origins + **NOMAD** | Provenance is a peer section, not a footnote; nothing unresolvable is left silent; `gitCommit` non-null **in production** |
| `share` ⏸ r0 | Rowan `iframe2` | A shared link renders standalone and embeds in a third-party page without login |
| `nav` ✅ won | rowansci.com header | One chrome width site-wide; `aria-current` on the active route |
| `benchmark` ⏸ r0 | **Matbench Discovery** + MP | Every comparison states its reference *and* its convention; no cross-convention deltas |
| `mobile` ⏸ r0 | rowansci.com @ 375 | **0** interactive targets under 44×44 (currently 21); nothing clips at 375 |
| `reference-conformance` ⏳ r1 | ACEsuit/mace | Where SimpleAtom disagrees with upstream, SimpleAtom is wrong by definition |

---

## Scope — what is deliberately not built

MACE is an interatomic potential with no electron density. No orbitals, partial charges,
Fukui indices, pKa, docking, or DFT. A critic naming these as gaps is naming a feature
SimpleAtom has decided against, and the verdict should be rejected, not acted on.

Rowan's typeface Matter is commercially licensed and is not used. SimpleAtom keeps
Fraunces + Inter. `phonon` is rejected, not stubbed.

---

## Branch strategy — the daily work accumulates, it does not ship

`main` auto-deploys to Vercel. Anything landing there is live to users the same minute, so the
daily routine never touches it.

| Branch | Holds |
|---|---|
| `main` | Production, plus the harness (`test_scripts/daily_gate.py`, this file, `defects.json`) |
| `daily` | Every daily round, accumulating. Never auto-merged |

Each run starts with `git checkout daily && git merge main --no-edit` so the branch stays
current with production, commits its work there, and tags the day `daily/YYYY-MM-DD`. The tags
are what make a single day's change reviewable a month later: `git diff daily/2026-09-20~1
daily/2026-09-20`.

The harness lives on `main` deliberately. If it lived on `daily`, every comparison would be
polluted by tooling churn, and `main...daily` would stop meaning "what a month of rounds did to
the product".

To review what has piled up:

```bash
python3 test_scripts/daily_gate.py --compare
```

It prints how far ahead `daily` is, the diffstat, the blind-win score on **each** branch, every
`daily/*` tag, and the commands to adopt, inspect, or drop the whole body of work. Adopt only
with every gate green **on `daily`** — `--compare` reports the score, not the gates, so run the
full gate on the branch before merging anything to a production branch that deploys on push.

---

## Budget — 2.5M tokens per run

A ceiling, not a target. The loop's value is that it runs every day for months, and a routine
that burns a session's worth of context daily stops being run. What holds the line:

- **One piece, one round, per day.** A LOST verdict is recorded and the day ends. Tomorrow picks
  it up with the gap already written.
- **At most two subagents** — one builder, one critic. No wide fan-out. The marathon multi-agent
  sessions that produced v2.0 are not what this routine is for.
- **The gate output is the briefing.** It already contains the gates, the bars, and each queue
  item's diagnosis. Re-deriving that from the docs is the single easiest way to waste a run.
- Never read `node_modules`, `.next`, `.claude/worktrees`, `package-lock.json` (437KB), or
  `tsconfig.tsbuildinfo` (336KB).
- Past ~2M: stop, commit what works, record the state, and say in the report that you stopped
  for budget.

---

## Harness traps that cost real time

- **Materials Project 403s to `curl`.** Use the browser pane. A critic reading a 403 body and
  judging from it is judging a Cloudflare page.
- **Coordinate clicks in the browser pane are scaled ~3.4952×.** A ref-based click reports page
  coords but lands at 3.5× that point. Click via `javascript_tool` (`el.click()`).
- Injecting `input.files` + a native `change` event does **not** trigger React's handler. Load
  structures through the UI (Catalog, SMILES, or `?demo=true`).
- Concurrent `npm run build` from parallel agents shares `.next/` and produces spurious lock
  failures. Treat an agent's build result as advisory; run one authoritative build yourself.
- ESLint will walk `.claude/worktrees/*/.next/` and die with a heap OOM before reporting a
  single problem. `eslint.config.mjs` ignores it as of 2026-09-11; the lint gate was
  green-by-absence for a month before that.
