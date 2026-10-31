# Resume here — overnight run, 2026-10-31

**Overnight brief (owner decisions 2026-10-30, relayed by the parent session):**
* push and open PRs, no merge;
* audit plus fixes only, with device honesty (ADR-0031 accepted);
* D51 gets a visible warning;
* no vibrations, cell relaxation or Feedback build.

The plan is `~/.claude/plans/run-it-overnight-auto-mode-zesty-pond.md`, Steps 4–5.

| Step | State |
|---|---|
| Integration | Security branch merged (`df27d8b`); PR **#20** open, stacked on #19 |
| 4.1 release blockers | D40, D41, D43, D57 fixed (see below) |
| 4.2 Track 1, device honesty | done: `7ff064b` tests, `b2840fd` fix. D33–D35 fixed; UI checked at 1280 and 375 |
| 4.3 D51 | done: test, then fix (see `git log`) |
| 4.4 owner-free defects | **next**: D36–D39, D42, D44–D50, D52–D56, D58–D69 |
| 4.5 D70+ | from the parent's audit, as D72+ |
| 4.6 permanent gates | not started |

---

# State at STOP-1, 2026-10-30

**Update 2026-10-30.** The parent session relayed the owner's go-ahead ("continue … Run it,
improve"), scoped to the plan's release-blocker defects only. Done on
`audit-next-feature`, with tests committed first, local commits only and nothing pushed:

* **D57** (`3798e67`, `31a20f1`);
* **D40** (`f9fa6b7`, `925de6d`);
* **D41 code half and D43** (`5fc6b47`, `fccf1be`).

The full gate is green with the build (`evidence/2026-10-30/daily-gate.txt`), and
`science-critic` verified D57 (`evidence/2026-10-30/science-critic-d57.md`).

The owner is on **Vercel Pro**. [`hosted-compute-memo.md`](hosted-compute-memo.md), renamed
from hosted-gpu-memo, now compares HF `cpu-basic`, Vercel Functions or the container runtime,
and Sandbox, with arithmetic per-run costs. It covers:
* Sandbox for custom uploads (recommended against for now; preconditions listed);
* WAF rate limits as the edge half of D41 and for Feedback;
* Spend Management as a prerequisite for anything metered;
* Web Analytics for usage data.

`plan-2026-10-28.md` has a "Revision 2026-10-30" section with optional tracks T4 (a
container-runtime pilot) and T5 (two analytics events). New owner action: **set
`MACE_API_TOKEN` on Vercel and the Space before this branch deploys** (D43).

**Still the owner's to decide:**
* the feature (vibrations vs cell relaxation);
* ADR-0031 to 0033;
* D51;
* T4 and T5;
* any Sandbox ADR.

**Not started:** vibrations, cell relaxation, Feedback. When D31's PR (`acf14fa`) lands,
rebase this branch onto it.

---

# State at STOP-1, 2026-10-28

**Status: Phases 0–3 of `.claude/prompts/simpleatom-audit-next-feature.md` are done. The
work is waiting for the owner's approval (STOP-1).** Nothing has been pushed, merged or
deployed, and no Space, Vercel or Supabase setting has been touched.

* Branch: `audit-next-feature`, cut from `v2.2` (`daed8bc`), local commits only.
* The lock-index fix for D31 lives on `claude/quizzical-herschel-7d5e13` (`acf14fa`), the
  containment session's branch. That session owns D30 (S3 live).

## Deliverables

| What | Where |
|---|---|
| Production parity table, delta audit, device trace, baseline gates | [`docs/audits/2026-10-28.md`](../audits/2026-10-28.md) |
| Defects D30–D69 (and D23 resolved) | [`defects.json`](defects.json) |
| Verbatim gate outputs, device traces, golden cases and noise, feasibility scripts and results | [`evidence/2026-10-28/`](evidence/2026-10-28/) |
| Needs matrix (15 rows) and workflow map | [`needs-2026-10-28.md`](needs-2026-10-28.md) |
| Scored candidates, recommendation, strongest counter-argument, file-by-file plan, parallel tracks | [`plan-2026-10-28.md`](plan-2026-10-28.md) |
| ADR drafts (status `proposed`) | [0031 device](../adr/0031-device-honesty.md), [0032 vibrations scope](../adr/0032-molecular-vibrations-thermochemistry.md), [0033 Feedback email](../adr/0033-feedback-by-email.md) |
| Hosted-compute memo (was hosted-GPU) | [`hosted-compute-memo.md`](hosted-compute-memo.md) |
| New tools | [`.claude/agents/science-critic.md`](../../.claude/agents/science-critic.md), [`.claude/skills/verify-science/`](../../.claude/skills/verify-science/SKILL.md) (`SKILL.md`, `noise.py`) |

## Decision waiting for the owner

The recommendation is **harmonic vibrations and ideal-gas thermochemistry for isolated
molecules** (ADR-0032), reached from a converged geometry optimisation through "Compute
frequencies". It ships with **device honesty** (ADR-0031) and **Feedback by email**
(ADR-0033). The runner-up is cell relaxation + EOS, which tied at 42 weighted points and
lost the tie-break on value and verifiability.

## How to resume Phase 4 after approval

1. Re-verify production. Has D30 been contained (`GET https://jamessfks-mace-api.hf.space/health`
   → `gitCommit`)? Is `acf14fa` merged?
2. Python env: `uv venv --python 3.11 <dir>`, then
   `uv pip install --no-deps -r <(grep -E '^[A-Za-z0-9_.-]+==' mace-api/requirements.lock.txt | sed -E 's/ \\$//; s/\+cpu//')`.
   That gives macOS wheels at the lock's versions. `npm ci`. `export KMP_DUPLICATE_LIB_OK=TRUE`.
3. Work the plan's release blockers first (D31, D40, D41, D43). Then Track 1 → Track 2 in
   series, with Track 3 in parallel. Tests and golden values are committed first, in every track.
4. Verify each piece with `verify-science` + `science-critic` (numbers) and `verify-ui` +
   `design-critic` (screens), and record the verdicts in `progress.json`.

## Owner actions still needed

* Contain D30: pause the Space, or approve the v2.2 + `acf14fa` PR. **Do not delete the
  Space**: a new Docker Space needs a paid plan.
* Supabase: set `SUPABASE_SERVICE_ROLE_KEY` on Vercel, then apply `0003_lockdown.sql` (D32).
* `MACE_API_TOKEN` on Vercel and the Space (D43).
* Resend:
  * `vercel integration add resend/resend-email` (after a yes);
  * DNS records for a `simpleatom.app` subdomain;
  * `FEEDBACK_TO_EMAIL` and `FEEDBACK_FROM_EMAIL`.
* Branch protection on `main`; check that `hf-production` restricts deploy branches (D50).
* GPU spending: none recommended.

## Harness traps found this session (in addition to those below)

* A **hidden browser pane** never loads `?demo=true` and lays out nothing. Use Playwright
  for UI evidence.
* The guards **exit 1** on refusal in v2.2, which makes D39's "exit 0" stale. Judge them by
  their JSON either way.
* **Disk:** parallel Docker builds drove free space down to 441 MiB, and a run failed with
  "No usable temporary directory". Check `df -h /` before heavy runs.
* The lock is x86_64-manylinux, so on macOS install it without hashes and without `+cpu`
  (above). Green local gates do not prove the Linux lock installs (D31).

---

# History (written 2026-08-10)


Last updated 2026-08-10, on `main` at `9efa649`. Everything described here is committed and
pushed; there is no unsaved work. Live dashboard: `/v2` (renders `docs/v2/progress.json`).

Releases: [v2.0.0](https://github.com/Jamessfks/simpleatom/releases/tag/v2.0.0) ·
[v2.1.0](https://github.com/Jamessfks/simpleatom/releases/tag/v2.1.0) · live at mace-lake.vercel.app
(Vercel deploys from `main` automatically on push).

---

## The method

Every piece has a **bar** — a real, fetchable thing — a **builder**, and a separate **critic**
with fresh context whose job is to find reasons ours is worse. A piece is done only when the
critic picks ours. Not a score; a pick. The exit is winning, or the user calling it.

**Score: 2 of 13 winning blind.** That counter is deliberately strict and says nothing about
the ~20 scientific defects fixed along the way, which is where most of the value landed. Both
numbers are shown on `/v2` for that reason.

| Won | Why it won |
|---|---|
| **Navigation** | One chrome width site-wide. The critic measured Rowan using the same `max-w-7xl` + `px-6` with the logo at x=24 and h1 at x=144.5 — a 120.5px offset against our 121px. Full-bleed chrome over a narrower column is the bar's own pattern. We also set `aria-current` on the active route; Rowan sets it on none of its five top links. |
| **Viewer selection & measurement** | Every displayed value hand-checked against the raw XYZ. Bond length in Å, angle in degrees with the vertex named, signed dihedral, order setting vertex and sign. Two atoms read `Bond length` only when a bond was actually perceived; otherwise `Distance` with the distinction stated. The bar makes no such distinction and does not name the vertex. |

---

## The three bars

| Bar | Judges | Fetchable? |
|---|---|---|
| [Rowan](https://rowansci.com) | Interface, 3D viewer | Marketing site **and their live production viewer** are public. App job/results screens are **behind login**. |
| [Materials Project](https://next-gen.materialsproject.org/materials/mp-149) | Data density, numeric reference | Property data public. Interactive crystal viewer **behind login**. |
| [ACEsuit/mace](https://github.com/ACEsuit/mace) | Scientific correctness | Fully public. Where SimpleAtom disagrees with upstream, SimpleAtom is wrong by definition. |

Details and measured tokens in `docs/v2/bars/`. **Only Rowan's viewer is genuinely interactive
and public** — a critic judging the job-config or results screens is working from docs prose
and must say so. That is the most common way this method fails.

Public viewer embed (the real bar, no login):
`https://labs.rowansci.com/iframe2/calculation/c1cd40a2-f781-4be0-8c68-b6b4e681b9b5?auto-rotate=false&no-border=true`

---

## In flight when this was written

Three agents were running. Check `git log` before redoing any of it.

1. **Critic, round 6** — judging viewer render, gear menu, landing, results panel, provenance.
   The results panel and provenance had **never been judged**. Two fixes were unmeasured:
   whether toggling force vectors now changes molecule size by zero pixels, and whether the
   pan direction in the asymmetry fix is correct.
2. **Builder — MACE Link share piece** (`app/r/[id]/`). Never started. The bar ships this
   primitive publicly and embeds it in its own homepage, so the comparison is direct.
3. **Builder — benchmark vs MP** (`app/benchmark/`, `components/benchmark/`,
   `lib/mlpeg-catalog.ts`). Never started. Supplies the numeric half of the bar.

---

## Pieces never started

| Piece | Notes |
|---|---|
| **Mobile / responsive** | Rowan's own mobile is weak — their hero molecule clips off-screen. Winnable. Known issues: 21 interactive targets under 44×44 (partly addressed in the viewer), nav links 17px tall. |
| **Reference conformance** | Round 1 shipped. Findings 6, 7 (done), 9, 10, 11 (done), 12 from `docs/v2/audit-vs-acesuit.md` remain. |

---

## Known defects, deliberately unfixed

- **`mace-api/main.py` returns HTTP 500 instead of 400** for a rejected `calculationType`, so
  the hosted FastAPI path reports the wrong status.
- **The validator is absent from the deployed container.** `mace-api/Dockerfile`'s build
  context is `mace-api/`, so `COPY . .` cannot reach `../test_scripts/`. Hosted results report
  `validation.status: "unavailable"` — degrading correctly, but degraded.
- **Audit finding 8**: the foundation-model comparison picks its baseline by substring-matching
  the uploaded *filename* for `"off"`/`"organic"` (`app/calculate/page.tsx` ~259). This can
  silently compare across two incompatible energy conventions.
- **Audit finding 6**: geometry-opt trajectories contain a duplicated frame 0 with off-by-one
  step labels — the message and the trajectory contradict each other.
- **Audit finding 10**: upstream computes stress on every call and it is discarded;
  `properties.pressure` is declared and never populated.
- `lattice` and `properties.volume` are declared non-nullable but the backend sends `null` for
  both on non-periodic systems.
- ASE's `get_temperature()` divides by 3N even with COM momentum pinned, so reported
  temperature reads ~11% low for a 9-atom molecule. The MD chart shows it as-is.
- **Force arrows are still drawn for hidden C–H hydrogens**, leaving arrows with no visible
  atom at their base.
- `components/ui/card.tsx`'s `CardHeader` is a bare grid with no explicit columns unless a
  `CardAction` child is present — the same unsafe pattern that caused the `/calculate` mobile
  overflow, one level deeper. `ResultsSkeleton` has it too, currently inert.
- **Viewer framing** still sits a few percent under the 0.82 target.

---

## The pattern worth remembering

Six defects in this work were **code that reviews as correct and does nothing, or the wrong
thing, at runtime**. None would be caught by reading a diff:

1. `calculationType` had no allow-list — any unrecognised type ran a single-point and returned
   it as the requested calculation.
2. `modelType` had no allow-list — "custom" with no checkpoint returned MACE-MP-0 results
   labelled `custom`, shareable and PDF-exportable.
3. The validator's model-aware energy bounds were dead because `_build_result()` never echoed
   the `params` the validator reads.
4. The D3 toggle was live but a no-op for custom models, whose loader takes no dispersion arg.
5. The MACE-OFF element and NPT periodicity guards were implemented but inert — nothing passed
   them the structure.
6. **Ambient occlusion had never once rendered.** The WebGL2 check probed the visible canvas,
   which holds a `bitmaprenderer` context whenever the viewer renders offscreen, so the check
   failed on every capable machine.

And two found only by asking a downstream question:
- `parseCIF` never converted fractional coordinates — silicon loaded with a **0.433 Å**
  nearest-neighbour distance instead of 2.3516 Å. Found only because wiring `isPeriodic` forced
  "where is the lattice?"
- The default result viewer fitted force-arrow **tips**, so the molecule rendered at ~12% of
  the box. Found only because a critic ran a real calculation; every prior check measured the
  *hero* viewer, which has no arrows.

**Verify by execution, never by reading.** Also verify the *right build* — one critic spent a
full run measuring a stale branch because the dev server was serving different code than the
branch under test.

---

## Resuming

```bash
git checkout -b v2.2 main
npm install && npm run dev          # dashboard at /v2
```

Gates that must stay green:

```bash
npm run build                                        # must compile
npx eslint .                                         # ~37 known pre-existing problems
export KMP_DUPLICATE_LIB_OK=TRUE                     # else OMP Error #15
python3 test_scripts/validate_calculation.py --test  # all_passed: true
python3 -m unittest discover -s test_scripts -p "test_provenance.py"   # 40 tests
```

Guards that must keep failing loudly. If any returns a result, a silent fallthrough is back:

```bash
python3 mace-api/calculate_local.py public/demo/ethanol.xyz '{"calculationType":"phonon"}'
python3 mace-api/calculate_local.py public/demo/ethanol.xyz '{"modelType":"custom"}'
python3 mace-api/calculate_local.py public/demo/ethanol.xyz '{"modelType":"MACE-MP"}'
```

And the CIF fixture, which regresses to a 1 Å box if fractional handling breaks:
`public/demo/silicon.cif` — correct nearest-neighbour is **2.3516 Å** (a·√3/4).

### Harness traps that cost real time

- **Coordinate clicks in the browser pane are scaled ~3.4952×.** A ref-based click reports page
  coords but lands at 3.5× that point. Click via `javascript_tool` (`el.click()`) instead.
- Injecting `input.files` + a native `change` event does **not** trigger React's handler. Load
  structures through the UI (Catalog, SMILES, or `?demo=true`).
- Concurrent `npm run build` from parallel agents shares `.next/` and produces spurious lock
  failures. Treat an agent's build result as advisory; run one authoritative build yourself.
- Verify the dev server is serving the branch you think it is before judging anything.

---

Method credit: the gauntlet loop is [Matt Shumer's](https://github.com/mshumer); packaged as a
skill by [Jay E / RoboNuggets](https://robonuggets.com), CC BY 4.0.
