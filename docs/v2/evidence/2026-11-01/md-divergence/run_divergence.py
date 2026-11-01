#!/usr/bin/env python3
"""
D130 reproduction: at which step does SimpleAtom's md_diverged stop an MD run?

Everything goes through SimpleAtom's own engine, calculate.run_calculation, on
the pinned stack (MACE-OFF small, float64, seed 42, profile "local"):

  1. Relax ethanol (the strained demo file, kept as test/fixtures/ethanol-golden.xyz)
     and water (public/demo/water.xyz): BFGS, fmax 0.005 eV/Å, up to 2000 steps.
  2. NVT at 300 K (friction 0.01 /fs, the contract default), 1000 steps, at
     1.5, 2.0, 2.5, 3.0 and 4.0 fs, on each relaxed molecule.
  3. Controls for false triggers: the relaxed molecules at 0.5 and 1.0 fs NVT and
     1.0 fs NVE, and the strained demo ethanol at 1.0 and 2.0 fs NVT.

md_diverged fires when the kinetic temperature passes max(10 x target, 5000 K)
(5000 K here), or, in NVE only, when the total energy has moved more than
0.1 eV/atom from its start. Every step's temperature is recorded through the
engine's per-step hook (the stopping step's from the md_diverged message), so
the first step above 3000 K is reported too: the reviewer's original
observation on the strained demo was "T > 3000 K at step 218" (D130).

Run from the repository root (about 3 minutes of CPU on an M-series Mac):

    KMP_DUPLICATE_LIB_OK=TRUE python docs/v2/evidence/2026-11-01/md-divergence/run_divergence.py

Writes results.json next to this file. Needs the MACE-OFF small checkpoint in
~/.cache/mace (downloaded by mace-torch on first use; it is SHA-256 pinned).
"""

import hashlib
import json
import os
import pathlib
import platform
import re
import sys
import tempfile
import time

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[4]
sys.path.insert(0, str(ROOT / "mace-api"))

import calculate  # noqa: E402
from contract import ContractError  # noqa: E402

OFF = {"modelType": "MACE-OFF", "modelSize": "small", "precision": "float64"}
SEED = 42
TEMPERATURE_K = 300.0
MD_STEPS = 1000
SOURCES = {
    "ethanol": ROOT / "test" / "fixtures" / "ethanol-golden.xyz",
    "water": ROOT / "public" / "demo" / "water.xyz",
}
SCAN_FS = (1.5, 2.0, 2.5, 3.0, 4.0)
CONTROLS = [  # (structure, ensemble, timestep fs)
    ("ethanol (relaxed)", "NVT", 0.5), ("ethanol (relaxed)", "NVT", 1.0), ("ethanol (relaxed)", "NVE", 1.0),
    ("water (relaxed)", "NVT", 0.5), ("water (relaxed)", "NVT", 1.0), ("water (relaxed)", "NVE", 1.0),
    ("ethanol (strained demo)", "NVT", 1.0), ("ethanol (strained demo)", "NVT", 2.0),
]


class EveryStep(calculate.RunHooks):
    """The engine's per-step hook, keeping every MD step's kinetic temperature."""

    def __init__(self):
        super().__init__()
        self.temperatures = {}

    def tick(self, phase, step, total, **extra):
        if "temperature" in extra:
            self.temperatures[int(step)] = float(extra["temperature"])
        super().tick(phase, step, total, **extra)


def sha256(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def relax(name, source, tmp):
    started = time.process_time()
    r = calculate.run_calculation(str(source), {**OFF, "calculationType": "geometry-opt",
                                                "forceThreshold": 0.005, "maxOptSteps": 2000},
                                  profile="local")
    if not r["converged"]:
        raise SystemExit(f"{name} did not relax: {r['message']}")
    lines = [str(len(r["symbols"])), f"{name} relaxed: MACE-OFF small float64, BFGS fmax 0.005"]
    lines += [f"{s} {x:.10f} {y:.10f} {z:.10f}" for s, (x, y, z) in zip(r["symbols"], r["positions"])]
    path = pathlib.Path(tmp) / f"{name}-relaxed.xyz"
    path.write_text("\n".join(lines) + "\n")
    return path, {"optSteps": r["params"]["optSteps"], "finalFmaxEvPerA": r["params"]["finalFmax"],
                  "energyEv": r["energy"], "cpuSeconds": round(time.process_time() - started, 1),
                  "positions": r["positions"], "symbols": r["symbols"]}


def md(structure, path, ensemble, dt_fs):
    hooks = EveryStep()
    started = time.process_time()
    row = {"structure": structure, "ensemble": ensemble, "timeStepFs": dt_fs, "mdSteps": MD_STEPS}
    try:
        r = calculate.run_calculation(str(path), {**OFF, "calculationType": "molecular-dynamics",
                                                  "mdEnsemble": ensemble, "timeStep": dt_fs,
                                                  "temperature": TEMPERATURE_K, "mdSteps": MD_STEPS,
                                                  "seed": SEED}, profile="local", hooks=hooks)
        row.update(outcome="completed", divergedAtStep=None,
                   meanTemperatureK=r["mdSummary"].get("meanTemperature"))
    except ContractError as exc:
        if exc.code != "md_diverged":
            raise
        step = int(re.search(r"MD diverged at step (\d+)", str(exc)).group(1))
        row.update(outcome="md_diverged", divergedAtStep=step, message=str(exc).split(". The trajectory")[0])
        # The stopping step never reaches the hook (the engine raises first); its
        # temperature is in the message.
        reached = re.search(r"kinetic temperature reached (\d+) K", str(exc))
        if reached:
            hooks.temperatures[step] = float(reached.group(1))
    temps = hooks.temperatures
    row["maxTemperatureK"] = round(max(temps.values()), 1) if temps else None
    row["firstStepAbove3000K"] = next((s for s in sorted(temps) if temps[s] > 3000.0), None)
    row["cpuSeconds"] = round(time.process_time() - started, 1)
    print(f"{structure:24s} {ensemble} {dt_fs:3.1f} fs: {row['outcome']:11s} "
          f"step {row['divergedAtStep']}, first T>3000 K {row['firstStepAbove3000K']}, "
          f"max T {row['maxTemperatureK']} K ({row['cpuSeconds']} s)", flush=True)
    return row


def main():
    import ase
    import mace
    import torch
    total = time.process_time()
    with tempfile.TemporaryDirectory() as tmp:
        relaxed, paths = {}, {}
        for name, source in SOURCES.items():
            paths[f"{name} (relaxed)"], relaxed[name] = relax(name, source, tmp)
        paths["ethanol (strained demo)"] = SOURCES["ethanol"]
        runs = [md(f"{name} (relaxed)", paths[f"{name} (relaxed)"], "NVT", dt)
                for name in SOURCES for dt in SCAN_FS]
        controls = [md(structure, paths[structure], ensemble, dt) for structure, ensemble, dt in CONTROLS]
    results = {
        "defect": "D130",
        "command": "KMP_DUPLICATE_LIB_OK=TRUE python docs/v2/evidence/2026-11-01/md-divergence/run_divergence.py",
        "settings": {"model": "MACE-OFF small", "precision": "float64", "seed": SEED,
                     "temperatureK": TEMPERATURE_K, "friction": "contract default (NVT only)",
                     "mdSteps": MD_STEPS, "profile": "local",
                     "divergenceLimits": {
                         "temperatureK": max(calculate.MD_DIVERGENCE_TEMPERATURE_FACTOR * TEMPERATURE_K,
                                             calculate.MD_DIVERGENCE_TEMPERATURE_FLOOR_K),
                         "nveDriftEvPerAtom": calculate.MD_NVE_DRIFT_LIMIT_EV_PER_ATOM},
                     "relaxation": "SimpleAtom geometry-opt: BFGS, fmax 0.005 eV/Å, float64"},
        "inputs": {name: {"path": str(path.relative_to(ROOT)), "sha256": sha256(path)}
                   for name, path in SOURCES.items()},
        "relaxed": relaxed,
        "scan": runs,
        "controls": controls,
        "environment": {"python": platform.python_version(), "machine": platform.machine(),
                        "system": platform.system(), "torch": torch.__version__,
                        "maceTorch": getattr(mace, "__version__", None), "ase": ase.__version__,
                        "torchThreads": torch.get_num_threads()},
        "totalCpuSeconds": round(time.process_time() - total, 1),
    }
    (HERE / "results.json").write_text(json.dumps(results, indent=1) + "\n")
    print(f"wrote {HERE / 'results.json'} ({results['totalCpuSeconds']} s CPU)")


if __name__ == "__main__":
    main()
