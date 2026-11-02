#!/usr/bin/env python3
"""Measure SimpleAtom's run-to-run noise, the baseline every science tolerance uses.

Runs mace-api/calculate_local.py --runs times at each OMP_NUM_THREADS value and
reports the spread (max - min) of each quantity. A refusal ({"status":"error"},
exit 0) is reported as a refusal, never as a value.

    python .claude/skills/verify-science/noise.py public/demo/ethanol.xyz \
        '{"calculationType":"single-point","modelType":"MACE-OFF","modelSize":"small"}' \
        --threads 1 2 --runs 3 --field properties.pressure
"""
import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / "mace-api" / "calculate_local.py"


def dig(doc, dotted):
    for key in dotted.split("."):
        if not isinstance(doc, dict) or key not in doc:
            return None
        doc = doc[key]
    return doc


def derived(result):
    """Force statistics recomputed from the returned forces (RMS over atoms, not 3N)."""
    forces = result.get("forces") or []
    if not forces:
        return {}
    norms = [math.sqrt(sum(c * c for c in f)) for f in forces]
    net = [sum(f[i] for f in forces) for i in range(3)]
    return {
        "maxForce": max(norms),
        "rmsForce": math.sqrt(sum(n * n for n in norms) / len(norms)),
        "netForce": math.sqrt(sum(c * c for c in net)),
        "energyPerAtom": result["energy"] / len(forces),
    }


def run_once(structure, params, threads):
    env = dict(os.environ, OMP_NUM_THREADS=str(threads), KMP_DUPLICATE_LIB_OK="TRUE")
    p = subprocess.run([sys.executable, str(CLI), structure, params],
                       capture_output=True, text=True, env=env, timeout=1800)
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        return {"status": "error", "error": f"non-JSON stdout (rc={p.returncode}): {p.stderr[-300:]}"}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("structure")
    ap.add_argument("params", help="params JSON, exactly as the UI would send it")
    ap.add_argument("--threads", type=int, nargs="+", default=[1, 2])
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--field", action="append", default=[],
                    help="extra dotted result path to track, e.g. properties.pressure")
    args = ap.parse_args()

    samples, refusals, params_seen = {}, [], set()
    for threads in args.threads:
        for _ in range(args.runs):
            result = run_once(args.structure, args.params, threads)
            if result.get("status") != "success":
                refusals.append({"threads": threads, "error": result.get("error") or result})
                continue
            params_seen.add(json.dumps(result.get("params"), sort_keys=True))
            values = {"energy": result["energy"], **derived(result)}
            values.update({f: dig(result, f) for f in args.field})
            for name, value in values.items():
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    samples.setdefault(name, []).append((threads, float(value)))

    report = {
        "structure": args.structure,
        "params": json.loads(args.params),
        "threads": args.threads,
        "runsPerThreadCount": args.runs,
        "effectiveParamsConsistent": len(params_seen) <= 1,
        "effectiveParams": json.loads(next(iter(params_seen))) if params_seen else None,
        "refusals": refusals,
        "quantities": {
            name: {
                "mean": sum(v for _, v in vals) / len(vals),
                "spread": max(v for _, v in vals) - min(v for _, v in vals),
                "n": len(vals),
                "byThreads": {str(t): [v for tt, v in vals if tt == t] for t in args.threads},
            }
            for name, vals in samples.items()
        },
    }
    json.dump(report, sys.stdout, indent=2)
    print()
    return 1 if refusals and not samples else 0


if __name__ == "__main__":
    sys.exit(main())
