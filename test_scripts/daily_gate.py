#!/usr/bin/env python3
"""
SimpleAtom daily gate — the mechanical half of the daily gauntlet round.

Runs every gate and guard that must stay green, checks that each bar is
reachable *today*, then prints TODAY'S QUEUE: the one thing worth working on,
ordered so the cheapest real value comes first.

The point of running this before any judging is that the two most expensive
failures recorded in docs/v2/CONTINUE.md were both invisible to code review:
shipping a regression, and judging against a bar that did not load. Both are
caught here, by execution, in about three minutes.

Usage:
    python3 test_scripts/daily_gate.py              # everything
    python3 test_scripts/daily_gate.py --quick      # skip `next build`
    python3 test_scripts/daily_gate.py --no-bars    # skip network checks
    python3 test_scripts/daily_gate.py --json       # machine-readable only

Exit codes: 0 = all gates green. 1 = at least one gate red (fix it today,
before anything else). 2 = the script could not run.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAILY_DIR = ROOT / "docs" / "v2" / "daily"
PROGRESS = ROOT / "docs" / "v2" / "progress.json"
DEFECTS = ROOT / "docs" / "v2" / "defects.json"

# Measured 2026-09-11 after ignoring .claude/worktrees/**/.next in
# eslint.config.mjs (before that ESLint OOMed and the gate was green-by-absence).
# Re-measured 2026-10-20: eslint-config-next 16.4.2 added React-compiler rules
# that scored the unchanged code at 40; fixing real defects among them (a
# conditional hook, a component recreated each render, untyped Plotly code)
# brought it to 15. A number that only ever goes down.
LINT_BASELINE = 15

# public/demo/silicon.cif — correct nearest-neighbour is a*sqrt(3)/4. If
# parseCIF stops converting fractional coordinates this collapses to ~0.43 A
# and every periodic result silently becomes a 1 A box of overlapping atoms.
SILICON_NN_ANGSTROM = 2.3516
SILICON_NN_TOLERANCE = 0.002

PROVENANCE_TEST_COUNT = 40

# Daily work accumulates here and is never auto-merged. `main` auto-deploys to
# Vercel, so anything landing there is live; this branch lets a month of daily
# rounds pile up as one reviewable body of work that can be compared against
# production and adopted or dropped as a whole. Each run tags DAILY_TAG_PREFIX +
# the date, so any single day can be diffed out on its own.
ACCUMULATION_BRANCH = "daily"
DAILY_TAG_PREFIX = "daily/"

# Per-run token ceiling for the scheduled routine. Not enforceable from inside
# this script — it is the budget the routine prompt holds itself to, recorded
# here so the number lives next to the gates it constrains.
RUN_TOKEN_BUDGET = 2_500_000

# Guards that must keep FAILING. Each one is a silent-fallthrough bug that was
# actually shipped: an unrecognised value fell through to a default calculation
# and the result was returned, shareable and PDF-exportable, under the name of
# a calculation or model that never ran. Note the contract: calculate_local.py
# exits 0 and reports refusal as {"status": "error"} on stdout, so checking the
# exit code alone would pass every one of these while they were broken.
# (name, params, the refusal code it must produce, why). D88: any error used to
# count, so a crash would have passed as a refusal.
GUARDS = [
    ("guard:phonon", '{"calculationType":"phonon"}', "unsupported_calculation",
     "an unimplemented calculationType must be refused, not run as single-point"),
    ("guard:custom-no-ckpt", '{"modelType":"custom"}', "custom_model_missing",
     "custom with no checkpoint must be refused, not answered with MACE-MP-0 numbers"),
    ("guard:bad-model", '{"modelType":"MACE-MP"}', "unsupported_model",
     "an unrecognised modelType must be refused, not coerced to MACE-MP-0"),
]

ENV = {**os.environ, "KMP_DUPLICATE_LIB_OK": "TRUE"}  # else OMP Error #15 on macOS


class Result:
    def __init__(self, name: str, ok: bool, detail: str, fix: str = ""):
        self.name, self.ok, self.detail, self.fix = name, ok, detail, fix

    def as_dict(self) -> dict:
        return {"name": self.name, "ok": self.ok, "detail": self.detail, "fix": self.fix}


def run(cmd: list[str], timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=timeout
    )


# ---------------------------------------------------------------- gates


def gate_build() -> Result:
    try:
        p = run(["npm", "run", "build"], timeout=1200)
    except subprocess.TimeoutExpired:
        return Result("build", False, "next build timed out after 20 min")
    if p.returncode == 0:
        return Result("build", True, "next build compiled")
    tail = [ln for ln in (p.stdout + p.stderr).splitlines() if ln.strip()][-4:]
    return Result("build", False, "next build FAILED: " + " / ".join(tail),
                  "A type error blocks every other piece. Fix before judging anything.")


def gate_lint() -> Result:
    try:
        p = run(["npx", "eslint", "."], timeout=900)
    except subprocess.TimeoutExpired:
        return Result("lint", False, "eslint timed out",
                      "Usually eslint walking build output — check globalIgnores.")
    out = p.stdout + p.stderr
    if "heap out of memory" in out:
        return Result("lint", False, "eslint OOMed — it is walking build output",
                      "Add the offending path to globalIgnores in eslint.config.mjs.")
    m = re.search(r"(\d+) problems?\s*\((\d+) errors?, (\d+) warnings?\)", out)
    if not m:
        if p.returncode == 0:
            return Result("lint", True, "0 problems")
        return Result("lint", False, f"could not parse eslint output (rc={p.returncode})")
    total = int(m.group(1))
    if total > LINT_BASELINE:
        return Result("lint", False,
                      f"{total} problems, baseline {LINT_BASELINE} — {total - LINT_BASELINE} new",
                      "You added these today. Clear them or raise the baseline deliberately.")
    note = f"{total} problems (baseline {LINT_BASELINE})"
    if total < LINT_BASELINE:
        note += f" — {LINT_BASELINE - total} fewer; lower LINT_BASELINE to {total} to lock it in"
    return Result("lint", True, note)


def gate_validator() -> Result:
    script = ROOT / "test_scripts" / "validate_calculation.py"
    if not script.exists():
        return Result("validator", False, "validate_calculation.py is missing")
    try:
        p = run([sys.executable, str(script), "--test"], timeout=1800)
    except subprocess.TimeoutExpired:
        return Result("validator", False, "validator timed out after 30 min")
    out = p.stdout + p.stderr
    # D79: judge the JSON verdict, never the exit code or a substring. A run
    # that printed all_passed: false and exited 0 used to pass this gate.
    verdict = None
    try:
        verdict = json.loads(p.stdout[p.stdout.index("{"):]).get("all_passed")
    except (ValueError, AttributeError):
        pass
    if verdict is True and p.returncode == 0:
        return Result("validator", True, "all_passed: true")
    tail = [ln for ln in out.splitlines() if ln.strip()][-3:]
    return Result("validator", False, "validator FAILED: " + " / ".join(tail),
                  "A scientific gate is red. Nothing cosmetic matters today.")


def gate_provenance() -> Result:
    try:
        p = run([sys.executable, "-m", "unittest", "discover",
                 "-s", "test_scripts", "-p", "test_provenance.py"], timeout=900)
    except subprocess.TimeoutExpired:
        return Result("provenance-tests", False, "provenance suite timed out")
    out = p.stdout + p.stderr
    m = re.search(r"Ran (\d+) tests?", out)
    ran = int(m.group(1)) if m else 0
    passed = "\nOK" in out or out.rstrip().endswith("OK")
    if not passed:
        fails = re.findall(r"^(FAIL|ERROR): (\S+)", out, re.M)
        return Result("provenance-tests", False,
                      f"{ran} tests, FAILED: " + ", ".join(n for _, n in fails[:4]))
    if ran < PROVENANCE_TEST_COUNT:
        return Result("provenance-tests", False,
                      f"only {ran} tests ran, expected {PROVENANCE_TEST_COUNT} — tests were deleted or skipped")
    return Result("provenance-tests", True, f"{ran} tests OK")


# Minimum test counts for the suites added in v2.2.0. Like the provenance
# count, a drop below these is a regression (deleted or skipped tests).
SUITES = [
    ("contract-tests", "test_backend_contract.py", 20),
    ("science-regressions", "test_science_regressions.py", 9),
    ("geometry-opt-tests", "test_geometry_opt.py", 10),
]

# The frontend half of CI's checks: (gate name, command, minimum test count or None).
# Without these the gate could be green while CI's frontend job was red.
FRONTEND_CHECKS = [
    ("vitest", ["npx", "vitest", "run"], 139),
    ("typecheck", ["npm", "run", "typecheck"], None),
    ("contract-sync", ["npm", "run", "check:contract"], None),
]

# The unit tests that live next to the backend (CI: python-unit, cwd mace-api).
BACKEND_UNIT_MODULES = ["test_geometry_opt", "test_smiles_to_xyz"]


def gate_frontend_checks() -> list[Result]:
    results = []
    for name, cmd, minimum in FRONTEND_CHECKS:
        try:
            p = run(cmd, timeout=900)
        except subprocess.TimeoutExpired:
            results.append(Result(name, False, f"{' '.join(cmd)} timed out"))
            continue
        out = p.stdout + p.stderr
        if p.returncode != 0:
            results.append(Result(name, False, f"{' '.join(cmd)} failed (rc={p.returncode})"))
            continue
        if minimum is not None:
            m = re.search(r"Tests\s+(\d+) passed", out)
            ran = int(m.group(1)) if m else 0
            if ran < minimum:
                results.append(Result(name, False, f"only {ran} tests passed, expected at least {minimum}"))
                continue
            results.append(Result(name, True, f"{ran} tests OK"))
        else:
            results.append(Result(name, True, "OK"))
    return results


def gate_backend_units() -> Result:
    try:
        p = subprocess.run([sys.executable, "-m", "unittest", *BACKEND_UNIT_MODULES],
                           cwd=ROOT / "mace-api", capture_output=True, text=True, timeout=900,
                           env={**os.environ, "KMP_DUPLICATE_LIB_OK": "TRUE"})
    except subprocess.TimeoutExpired:
        return Result("backend-unit-tests", False, "timed out")
    out = p.stdout + p.stderr
    m = re.search(r"Ran (\d+) tests?", out)
    ran = int(m.group(1)) if m else 0
    if p.returncode != 0:
        return Result("backend-unit-tests", False, f"{ran} tests, FAILED")
    return Result("backend-unit-tests", True, f"{ran} tests OK")


def gate_suites() -> list[Result]:
    results = []
    for name, pattern, minimum in SUITES:
        try:
            p = run([sys.executable, "-m", "unittest", "discover",
                     "-s", "test_scripts", "-p", pattern], timeout=1800)
        except subprocess.TimeoutExpired:
            results.append(Result(name, False, f"{pattern} timed out"))
            continue
        out = p.stdout + p.stderr
        m = re.search(r"Ran (\d+) tests?", out)
        ran = int(m.group(1)) if m else 0
        if p.returncode != 0:
            fails = re.findall(r"^(FAIL|ERROR): (\S+)", out, re.M)
            results.append(Result(name, False, f"{ran} tests, FAILED: " + ", ".join(n for _, n in fails[:4])))
        elif ran < minimum:
            results.append(Result(name, False, f"only {ran} tests ran, expected at least {minimum}"))
        else:
            results.append(Result(name, True, f"{ran} tests OK"))
    return results


def gate_guards() -> list[Result]:
    results = []
    demo = ROOT / "public" / "demo" / "ethanol.xyz"
    cli = ROOT / "mace-api" / "calculate_local.py"
    for name, params, expected, why in GUARDS:
        if not demo.exists() or not cli.exists():
            results.append(Result(name, False, "fixture or CLI missing"))
            continue
        try:
            p = run([sys.executable, str(cli), str(demo), params], timeout=900)
        except subprocess.TimeoutExpired:
            results.append(Result(name, False, "timed out — a refusal should be instant"))
            continue
        code = None
        for line in p.stdout.splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                doc = json.loads(line)
            except json.JSONDecodeError:
                continue
            if doc.get("status") == "error":
                code = (doc.get("error") or {}).get("code")
        if code == expected:
            results.append(Result(name, True, f"refused loudly ({code})"))
        elif code is not None:
            results.append(Result(name, False, f"refused with {code}, expected {expected} — {why}",
                                  "A different failure is not the refusal this guard protects."))
        else:
            results.append(Result(name, False, f"NO LONGER REFUSED — {why}",
                                  "A silent fallthrough is back. This returns invented "
                                  "numbers under a real name. Highest priority there is."))
    return results


def gate_silicon_fixture() -> Result:
    """Parse silicon.cif the way the app must and check the real nearest neighbour."""
    cif = ROOT / "public" / "demo" / "silicon.cif"
    if not cif.exists():
        return Result("fixture:silicon", False, "public/demo/silicon.cif is missing")
    try:
        from ase.io import read  # noqa: PLC0415 — optional dep, only needed here
        atoms = read(str(cif))
        d = atoms.get_all_distances(mic=True)
        n = len(atoms)
        nn = min(d[i][j] for i in range(n) for j in range(n) if i != j)
    except Exception as exc:  # noqa: BLE001
        return Result("fixture:silicon", False, f"could not read the CIF: {type(exc).__name__}: {exc}")
    if math.isclose(nn, SILICON_NN_ANGSTROM, abs_tol=SILICON_NN_TOLERANCE):
        return Result("fixture:silicon", True, f"nearest neighbour {nn:.4f} A")
    return Result("fixture:silicon", False,
                  f"nearest neighbour {nn:.4f} A, expected {SILICON_NN_ANGSTROM} A",
                  "Fractional-coordinate handling regressed. Every periodic result is wrong.")


# ---------------------------------------------------------------- bars


def check_bars(bars: list[dict]) -> list[Result]:
    """A bar that does not load today cannot be judged against. It gets hallucinated."""
    results = []
    for bar in bars:
        for label, url in (("", bar.get("url")), (" (viewer)", bar.get("viewerBar"))):
            if not url:
                continue
            name = f"bar:{bar['name']}{label}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(req, timeout=25) as r:
                    code = r.status
            except urllib.error.HTTPError as e:
                code = e.code
            except Exception as exc:  # noqa: BLE001
                results.append(Result(name, False, f"unreachable: {type(exc).__name__}",
                                      "Do not judge this piece today, or say in the verdict "
                                      "that the bar was unavailable."))
                continue
            if code == 200:
                results.append(Result(name, True, f"HTTP 200"))
            elif code in (403, 503):
                results.append(Result(name, False, f"HTTP {code} — bot-blocked to a plain fetch",
                                      "Reachable in a real browser. Open it in the browser "
                                      "pane; never judge it from curl output."))
            else:
                results.append(Result(name, False, f"HTTP {code}"))
    return results


# ---------------------------------------------------------------- queue


def build_queue(gates: list[Result], progress: dict, defects: list[dict]) -> list[tuple[str, str]]:
    """
    Order by cheapest real value first. This mirrors the co-op scan's
    [PREP] > [NEW] > [OPEN]: the top of the list is always the item where the
    thinking is already done and only the execution is missing.
    """
    queue: list[tuple[str, str]] = []

    for g in gates:
        if not g.ok and not g.name.startswith("bar:"):
            queue.append(("GATE", f"{g.name}: {g.detail}"
                                  + (f"  -> {g.fix}" if g.fix else "")))

    sev_rank = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    for d in sorted((x for x in defects if x.get("status", "open") == "open"),
                    key=lambda x: sev_rank.get(x.get("severity", "LOW"), 9)):
        queue.append(("DEFECT",
                      f"{d['id']} {d.get('severity','?')}  {d['what']}  [{d.get('where','?')}]"))

    pieces = progress.get("pieces", [])
    losing = [p for p in pieces
              if p.get("status") in ("building", "judging")
              and (p.get("verdict") or "").upper().find("LOST") >= 0]
    for p in losing:
        queue.append(("LOSING", f"{p['id']} r{p.get('rounds',0)} vs {p.get('bar','?')}"
                                f"  gap: {(p.get('gap') or 'unrecorded')[:140]}"))

    for p in pieces:
        if p.get("status") in ("building", "judging") and p not in losing:
            queue.append(("OPEN", f"{p['id']} r{p.get('rounds',0)} vs {p.get('bar','?')}"
                                  f"  — {(p.get('verdict') or 'never judged')[:100]}"))

    for p in pieces:
        if p.get("status") == "pending":
            queue.append(("NEVER", f"{p['id']} r0 vs {p.get('bar','?')}  — {p.get('judge','')[:110]}"))

    return queue


# ---------------------------------------------------------------- compare


def _score_on(ref: str) -> tuple[int, int] | None:
    """Read won/total out of progress.json as it stands on another ref."""
    p = run(["git", "show", f"{ref}:docs/v2/progress.json"])
    if p.returncode != 0:
        return None
    try:
        pieces = json.loads(p.stdout).get("pieces", [])
    except json.JSONDecodeError:
        return None
    return sum(1 for x in pieces if x.get("status") == "won"), len(pieces)


def compare() -> int:
    """Show what has accumulated on the daily branch versus main."""
    base, acc = "main", ACCUMULATION_BRANCH
    if run(["git", "rev-parse", "--verify", acc]).returncode != 0:
        print(f"error: branch '{acc}' does not exist yet — create it with "
              f"`git branch {acc} {base}`", file=sys.stderr)
        return 2

    ahead = run(["git", "rev-list", "--count", f"{base}..{acc}"]).stdout.strip() or "0"
    behind = run(["git", "rev-list", "--count", f"{acc}..{base}"]).stdout.strip() or "0"
    stat = run(["git", "diff", "--shortstat", f"{base}...{acc}"]).stdout.strip()
    log = run(["git", "log", f"{base}..{acc}", "--oneline"]).stdout.rstrip()
    tags = [t for t in run(["git", "tag", "-l", f"{DAILY_TAG_PREFIX}*"]).stdout.split()
            if t.startswith(DAILY_TAG_PREFIX)]

    print(f"\nSimpleAtom  {acc}  vs  {base}   ({date.today().isoformat()})\n")
    print(f"  {acc} is {ahead} commit(s) ahead, {behind} behind {base}")
    print(f"  diff: {stat or 'no file changes'}")

    for ref in (base, acc):
        sc = _score_on(ref)
        print(f"  score on {ref:6}: {sc[0]}/{sc[1]} winning blind" if sc
              else f"  score on {ref:6}: progress.json unreadable")

    if behind != "0":
        print(f"\n  NOTE: {base} has moved on. Rebase or merge {base} into {acc} "
              f"before judging the diff, or you are comparing against a stale production.")

    if tags:
        print(f"\n  versions tagged ({len(tags)}): {tags[0]} ... {tags[-1]}"
              if len(tags) > 1 else f"\n  versions tagged (1): {tags[0]}")
        print(f"  diff any single day:  git diff {tags[-1]}~1 {tags[-1]}")
    else:
        print(f"\n  no {DAILY_TAG_PREFIX}* tags yet — each run should tag its commit")

    if log:
        print("\n  commits:")
        for line in log.splitlines():
            print(f"    {line}")

    print(f"""
  To adopt the accumulated work:   git checkout {base} && git merge --no-ff {acc}
  To inspect before adopting:      git diff {base}...{acc}
  To drop it and start over:       git branch -D {acc} && git branch {acc} {base}

  Adopt only with every gate green ON {acc} — `main` auto-deploys to Vercel.
""")
    return 0


# ---------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true", help="skip `next build` (the slow gate)")
    ap.add_argument("--no-bars", action="store_true", help="skip bar reachability checks")
    ap.add_argument("--json", action="store_true", help="print the JSON summary only")
    ap.add_argument("--compare", action="store_true",
                    help=f"show what has accumulated on '{ACCUMULATION_BRANCH}' vs main, and stop")
    args = ap.parse_args()

    if args.compare:
        return compare()

    if not PROGRESS.exists():
        print(f"error: {PROGRESS} not found — run from the repo, not a worktree", file=sys.stderr)
        return 2
    progress = json.loads(PROGRESS.read_text())
    defects = json.loads(DEFECTS.read_text()).get("defects", []) if DEFECTS.exists() else []

    head = run(["git", "rev-parse", "--short", "HEAD"]).stdout.strip()
    branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    dirty = bool(run(["git", "status", "--porcelain"]).stdout.strip())

    gates: list[Result] = []
    if not args.quick:
        gates.append(gate_build())
    gates.append(gate_lint())
    gates.append(gate_validator())
    gates.append(gate_provenance())
    gates.extend(gate_suites())
    gates.append(gate_backend_units())
    gates.extend(gate_frontend_checks())
    gates.extend(gate_guards())
    gates.append(gate_silicon_fixture())

    bar_results = [] if args.no_bars else check_bars(progress.get("bars", []))

    hard_red = [g for g in gates if not g.ok]
    queue = build_queue(gates + bar_results, progress, defects)

    won = sum(1 for p in progress.get("pieces", []) if p.get("status") == "won")
    total = len(progress.get("pieces", []))

    summary = {
        "date": date.today().isoformat(),
        "ranAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "repo": {"branch": branch, "head": head, "dirty": dirty},
        "score": {"won": won, "total": total},
        "gates": [g.as_dict() for g in gates],
        "bars": [b.as_dict() for b in bar_results],
        "queue": [{"kind": k, "item": v} for k, v in queue],
        "allGatesGreen": not hard_red,
    }

    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    (DAILY_DIR / f"gate-{summary['date']}.json").write_text(json.dumps(summary, indent=2) + "\n")

    if args.json:
        print(json.dumps(summary, indent=2))
        return 1 if hard_red else 0

    def line(r: Result) -> str:
        return f"  [{'PASS' if r.ok else 'FAIL'}] {r.name:22} {r.detail}"

    print(f"\nSimpleAtom daily gate — {summary['date']}")
    print(f"{branch} at {head}{' (DIRTY — commit or stash before judging)' if dirty else ' (clean)'}"
          f"   score {won}/{total} winning blind\n")

    print("GATES")
    for g in gates:
        print(line(g))
        if not g.ok and g.fix:
            print(f"         -> {g.fix}")
    if args.quick:
        print("  [SKIP] build                  --quick; run the full gate before you commit")

    if bar_results:
        print("\nBARS REACHABLE TODAY")
        for b in bar_results:
            print(line(b))
            if not b.ok and b.fix:
                print(f"         -> {b.fix}")

    print("\nTODAY'S QUEUE  (top item first; one piece per day)")
    if not queue:
        print("  QUEUE EMPTY — every piece is won and every gate is green.")
        print("  That is a prompt to add a harder bar, not a day off.")

    # Capped per kind, not as a flat truncation. The defect backlog is long
    # enough to push every gauntlet piece off a flat list, which hides the
    # pieces that are actually mid-round — the opposite of what the queue is for.
    CAPS = {"GATE": 99, "DEFECT": 5, "LOSING": 99, "OPEN": 99, "NEVER": 99}
    for kind in ("GATE", "DEFECT", "LOSING", "OPEN", "NEVER"):
        items = [i for k, i in queue if k == kind]
        if not items:
            continue
        for item in items[: CAPS[kind]]:
            print(f"  [{kind:6}] {item}")
        hidden = len(items) - CAPS[kind]
        if hidden > 0:
            print(f"  [{kind:6}] ... and {hidden} more in docs/v2/defects.json"
                  if kind == "DEFECT" else f"  [{kind:6}] ... and {hidden} more")

    print(f"\nwrote docs/v2/daily/gate-{summary['date']}.json")
    if hard_red:
        print(f"\n{len(hard_red)} GATE(S) RED — fix those today and nothing else.\n")
        return 1
    print("\nAll gates green. Take the top queue item.\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
