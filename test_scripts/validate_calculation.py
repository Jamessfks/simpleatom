#!/usr/bin/env python3
"""
MACE Calculation Validator — Validates scientific correctness of calculation results.

Usage:
    python validate_calculation.py <result_json>
    python validate_calculation.py --test          # Run built-in validation tests
    python validate_calculation.py --verify-models # Verify model loading & basic calculations

Returns JSON with validation status, warnings, and errors.
"""

import json
from pathlib import Path
import sys
import math
import warnings
import logging

# NOTE: this module is imported by mace-api/calculate.py, which attaches
# validate_result() to every calculation. Silencing warnings or disabling
# logging at import time would therefore mutate global state inside the
# calculation process — and specifically would re-break the fix that captures
# MACE's "Default dtype ... does not match model dtype, converting models to
# ..." warning into result["warnings"] (calculate.py::capture_model_warnings).
# That warning is the only signal a checkpoint was silently downcast.
#
# The suppression is genuinely wanted when this file is run as a CLI, where
# stdout must be pure JSON. So it happens in _quiet_cli_output(), called from
# the __main__ block only.


def _quiet_cli_output() -> None:
    """Silence library noise so CLI stdout stays parseable JSON. CLI only."""
    warnings.filterwarnings("ignore")
    logging.disable(logging.CRITICAL)


# Physical reasonableness bounds
# MACE-MP-0 uses PBE reference energies (small per-atom values, typically -1 to -15 eV/atom)
# MACE-OFF uses wB97M-D3BJ total energies (large per-atom values, typically -200 to -600 eV/atom)
ENERGY_PER_ATOM_MIN_MP = -20.0     # eV/atom for MACE-MP-0
ENERGY_PER_ATOM_MAX_MP = 100.0     # eV/atom for MACE-MP-0
ENERGY_PER_ATOM_MIN_OFF = -800.0   # eV/atom for MACE-OFF (includes core electrons)
ENERGY_PER_ATOM_MAX_OFF = 100.0    # eV/atom for MACE-OFF
ENERGY_PER_ATOM_MIN = -800.0  # eV/atom (conservative bound covering both models)
ENERGY_PER_ATOM_MAX = 100.0   # eV/atom (very high energy)
FORCE_MAX_REASONABLE = 50.0   # eV/Å (above this = likely overlapping atoms)
FORCE_MAX_CRITICAL = 200.0    # eV/Å (almost certainly unphysical)
MIN_INTERATOMIC_DIST = 0.4    # Å (below this = overlapping atoms)
MAX_INTERATOMIC_DIST = 100.0  # Å (above this = disconnected structure)


# Where the model registry lives: next to this file in the flat Hugging Face
# Space layout, or in mace-api/ in the repository.
_CONTRACT_CANDIDATES = (
    Path(__file__).resolve().parent / "contract.json",
    Path(__file__).resolve().parent.parent / "mace-api" / "contract.json",
)


def _energy_bounds(model_type: str):
    """(min, max) eV/atom enforced for this model, or (None, None) to skip."""
    for candidate in _CONTRACT_CANDIDATES:
        if candidate.is_file():
            data = json.loads(candidate.read_text(encoding="utf-8"))
            for model in data["models"]:
                if model_type == model["id"] or model_type in model["aliases"]:
                    enforced = data["energyConventions"][model["energyConvention"]]["enforced"]
                    if enforced is None:
                        return None, None
                    return enforced["minEvPerAtom"], enforced["maxEvPerAtom"]
            break
    # Registry not shipped alongside, or an unknown model: the historical rule.
    if model_type in ("MACE-OFF", "MACE-OFF23"):
        return ENERGY_PER_ATOM_MIN_OFF, ENERGY_PER_ATOM_MAX_OFF
    return ENERGY_PER_ATOM_MIN_MP, ENERGY_PER_ATOM_MAX_MP


def validate_result(result: dict) -> dict:
    """Validate a MACE calculation result for scientific correctness."""
    issues = []
    warnings_list = []
    info = []

    status = result.get("status", "unknown")
    if status != "success":
        issues.append(f"Calculation status is '{status}', not 'success'")
        return {"valid": False, "issues": issues, "warnings": warnings_list, "info": info}

    energy = result.get("energy")
    forces = result.get("forces")
    positions = result.get("positions")
    symbols = result.get("symbols")
    lattice = result.get("lattice")
    trajectory = result.get("trajectory")

    # Detect model type from params if available
    params = result.get("params", {})
    model_type = params.get("modelType", "unknown")

    # Select the energy bounds for this model's reference convention, from the
    # registry when it can be found (mace-api/contract.json). A custom
    # checkpoint has no known convention, so its range check is skipped rather
    # than judged against MACE-MP bounds it never promised to meet.
    e_min, e_max = _energy_bounds(model_type)

    # --- Energy validation ---
    if energy is not None and symbols and e_min is None:
        info.append(f"Energy range check skipped: no reference convention is known for {model_type}.")
    elif energy is not None and symbols:
        n_atoms = len(symbols)
        e_per_atom = energy / n_atoms if n_atoms > 0 else 0

        if math.isnan(energy) or math.isinf(energy):
            issues.append(f"Energy is {energy} (NaN or Inf)")
        elif e_per_atom < e_min:
            warnings_list.append(
                f"Energy/atom = {e_per_atom:.4f} eV/atom is unusually low "
                f"(< {e_min} eV/atom for {model_type}). Check structure."
            )
        elif e_per_atom > e_max:
            issues.append(
                f"Energy/atom = {e_per_atom:.4f} eV/atom is unphysically high "
                f"(> {e_max} eV/atom). Structure likely has issues."
            )
        else:
            info.append(f"Energy/atom = {e_per_atom:.4f} eV/atom — within reasonable range for {model_type}")

    # --- Force validation ---
    if forces is not None:
        force_mags = []
        for f in forces:
            if len(f) == 3:
                mag = math.sqrt(f[0]**2 + f[1]**2 + f[2]**2)
                force_mags.append(mag)
                if math.isnan(mag) or math.isinf(mag):
                    issues.append("Force contains NaN or Inf values")
                    break

        if force_mags:
            max_force = max(force_mags)
            rms_force = math.sqrt(sum(f**2 for f in force_mags) / len(force_mags))

            if max_force > FORCE_MAX_CRITICAL:
                issues.append(
                    f"Max force = {max_force:.2f} eV/Å is extremely large "
                    f"(> {FORCE_MAX_CRITICAL} eV/Å). Atoms likely overlapping."
                )
            elif max_force > FORCE_MAX_REASONABLE:
                warnings_list.append(
                    f"Max force = {max_force:.2f} eV/Å is large "
                    f"(> {FORCE_MAX_REASONABLE} eV/Å). Structure may have close contacts."
                )
            else:
                info.append(f"Max force = {max_force:.4f} eV/Å, RMS = {rms_force:.4f} eV/Å — reasonable")

        # Check force sum (should be near zero for isolated systems)
        if forces and not lattice:
            fx_sum = sum(f[0] for f in forces)
            fy_sum = sum(f[1] for f in forces)
            fz_sum = sum(f[2] for f in forces)
            net_force = math.sqrt(fx_sum**2 + fy_sum**2 + fz_sum**2)
            if net_force > 0.1:
                warnings_list.append(
                    f"Net force on isolated system = {net_force:.4f} eV/Å "
                    f"(should be ~0). May indicate numerical issues."
                )

    # --- Position validation ---
    if positions is not None and len(positions) > 1:
        min_dist = float("inf")
        n = len(positions)
        for i in range(min(n, 200)):  # Cap for performance
            for j in range(i + 1, min(n, 200)):
                dx = positions[i][0] - positions[j][0]
                dy = positions[i][1] - positions[j][1]
                dz = positions[i][2] - positions[j][2]
                d = math.sqrt(dx**2 + dy**2 + dz**2)
                min_dist = min(min_dist, d)

        if min_dist < MIN_INTERATOMIC_DIST:
            warnings_list.append(
                f"Minimum interatomic distance = {min_dist:.3f} Å "
                f"(< {MIN_INTERATOMIC_DIST} Å). Atoms may be overlapping."
            )
        else:
            info.append(f"Min interatomic distance = {min_dist:.3f} Å — reasonable")

    # --- Lattice validation ---
    if lattice is not None:
        if len(lattice) == 3 and all(len(v) == 3 for v in lattice):
            # Check volume (should be positive)
            a, b, c = lattice
            vol = (a[0] * (b[1]*c[2] - b[2]*c[1]) -
                   a[1] * (b[0]*c[2] - b[2]*c[0]) +
                   a[2] * (b[0]*c[1] - b[1]*c[0]))
            if vol <= 0:
                issues.append(f"Cell volume = {vol:.4f} ų is non-positive (should be > 0)")
            elif vol < 1.0:
                warnings_list.append(f"Cell volume = {vol:.4f} ų is very small")
            else:
                info.append(f"Cell volume = {vol:.2f} ų — valid")
        else:
            issues.append("Lattice is not a valid 3x3 matrix")

    # --- Trajectory validation (MD) ---
    if trajectory is not None:
        energies = trajectory.get("energies", [])
        if energies:
            if any(math.isnan(e) or math.isinf(e) for e in energies):
                issues.append("Trajectory contains NaN or Inf energies — MD diverged")
            else:
                e_range = max(energies) - min(energies)
                e_mean = sum(energies) / len(energies)
                if abs(e_mean) > 0:
                    relative_fluct = e_range / abs(e_mean)
                    if relative_fluct > 0.5:
                        warnings_list.append(
                            f"Large energy fluctuation in MD trajectory "
                            f"(range/mean = {relative_fluct:.2%}). "
                            f"May indicate instability or large timestep."
                        )
                    else:
                        info.append(f"MD energy fluctuation = {relative_fluct:.4%} — stable")

    # --- Symbol validation ---
    if symbols:
        valid_elements = {
            "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
            "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
            "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
            "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
            "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
            "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
            "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
            "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
            "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th",
            "Pa", "U", "Np", "Pu", "Am",
        }
        invalid = [s for s in symbols if s not in valid_elements]
        if invalid:
            issues.append(f"Unknown element symbols: {invalid}")

    # --- Consistency checks ---
    if symbols and positions:
        if len(symbols) != len(positions):
            issues.append(
                f"Mismatch: {len(symbols)} symbols but {len(positions)} positions"
            )
    if symbols and forces:
        if len(symbols) != len(forces):
            issues.append(
                f"Mismatch: {len(symbols)} symbols but {len(forces)} forces"
            )

    return {
        "valid": len(issues) == 0,
        "issues": issues,
        "warnings": warnings_list,
        "info": info,
    }


def validate_params(params: dict) -> dict:
    """Validate calculation parameters for scientific correctness."""
    issues = []
    warnings_list = []

    model_type = params.get("modelType", "MACE-MP-0")
    dispersion = params.get("dispersion", False)
    calc_type = params.get("calculationType", "single-point")
    precision = params.get("precision", "float32")

    # D3 + MACE-OFF = double counting
    if model_type in ("MACE-OFF", "MACE-OFF23") and dispersion:
        warnings_list.append(
            "D3 dispersion enabled with MACE-OFF — this double-counts dispersion "
            "since MACE-OFF is trained on wB97M-D3BJ data."
        )

    # Precision for phonons/vibrations
    if calc_type == "phonon" and precision == "float32":
        issues.append(
            "Phonon/vibrational calculations require float64 precision. "
            "float32 introduces noise in Hessian computation."
        )

    # MD timestep sanity
    time_step = params.get("timeStep", 1.0)
    if time_step > 5.0:
        warnings_list.append(
            f"MD timestep = {time_step} fs is large. "
            f"May cause energy drift. Recommended: 0.5-2.0 fs."
        )
    elif time_step < 0.1:
        warnings_list.append(
            f"MD timestep = {time_step} fs is very small. "
            f"Calculation will be slow with minimal accuracy gain."
        )

    # Temperature bounds
    temp = params.get("temperature", 300)
    if temp is not None and temp > 5000:
        warnings_list.append(
            f"Temperature = {temp} K is very high. "
            f"Structure may dissociate. MACE accuracy degrades at extreme conditions."
        )

    # Force threshold for optimization
    fmax = params.get("forceThreshold", 0.05)
    if calc_type == "geometry-opt" and fmax > 0.5:
        warnings_list.append(
            f"Force threshold = {fmax} eV/Å is loose. "
            f"Recommended: 0.01-0.05 eV/Å for meaningful optimization."
        )

    return {"valid": len(issues) == 0, "issues": issues, "warnings": warnings_list}


def _engine():
    """SimpleAtom's own engine: mace-api/ in the repo, or beside this file in the Space image."""
    here = Path(__file__).resolve().parent
    for candidate in (here.parent / "mace-api", here):
        if (candidate / "calculate.py").exists():
            if str(candidate) not in sys.path:
                sys.path.insert(0, str(candidate))
            break
    import calculate
    return calculate


def _check(name: str, result: dict | None, verdict, **details) -> dict:
    """One self-test entry. A failed or missing run fails the check, never passes it."""
    entry = {"test": name, **details}
    if not result or result.get("status") != "success":
        error = (result or {}).get("error") or {}
        entry.update(passed=False, error=error.get("message") if isinstance(error, dict) else str(error))
        return entry
    entry["passed"] = bool(verdict(result))
    return entry


def run_verification_tests():
    """
    Run SimpleAtom's engine on known structures and judge every result (D38).

    The self-test used to call upstream mace_mp/mace_off directly — so it never
    exercised SimpleAtom's code — ran its geometry optimisation in float32, and
    hard-coded two of its five verdicts. Every check below is computed from a
    result calculate.run_calculation() returned.
    """
    import tempfile
    results = []
    try:
        import numpy as np
        from ase.build import bulk, molecule
        from ase.io import write

        calculate = _engine()
        mp_typical = calculate.contract.energy_convention("MACE-MPA-0")["typical"]

        def run(atoms, params):
            with tempfile.TemporaryDirectory() as tmp:
                path = str(Path(tmp) / "structure.xyz")
                write(path, atoms, format="extxyz")
                return calculate.run_calculation(path, params, profile="local")

        def net_force(result):
            return float(np.linalg.norm(np.sum(np.asarray(result["forces"]), axis=0)))

        def max_force(result):
            return float(np.max(np.linalg.norm(np.asarray(result["forces"]), axis=1)))

        print("Test 1: MACE-MPA-0 single point on Si (engine)...", file=sys.stderr)
        si = run(bulk("Si", "diamond", a=5.43, cubic=True), {"calculationType": "single-point"})
        results.append(_check(
            "MACE-MPA-0 Si bulk (engine)", si,
            lambda r: max_force(r) < 1e-3 and
            mp_typical["minEvPerAtom"] <= r["energy"] / len(r["symbols"]) <= mp_typical["maxEvPerAtom"],
            note="Diamond Si, 8-atom cell: forces vanish by symmetry; energy per atom in the MP band",
            energy_per_atom=si["energy"] / len(si["symbols"]) if si.get("status") == "success" else None,
        ))

        print("Test 2: MACE-OFF single point on H2O (engine)...", file=sys.stderr)
        water = molecule("H2O")
        water.center(vacuum=5.0)
        water.pbc = False
        h2o = run(water, {"calculationType": "single-point", "modelType": "MACE-OFF", "modelSize": "small"})
        results.append(_check(
            "MACE-OFF H2O molecule (engine)", h2o,
            lambda r: r["params"].get("modelType") == "MACE-OFF" and math.isfinite(r["energy"]),
            note="Isolated water through the full engine path",
        ))

        print("Test 3: MACE-OFF geometry optimisation of ethanol (engine)...", file=sys.stderr)
        ethanol = molecule("CH3CH2OH")
        ethanol.center(vacuum=5.0)
        ethanol.pbc = False
        opt = run(ethanol, {"calculationType": "geometry-opt", "modelType": "MACE-OFF", "modelSize": "small",
                            "forceThreshold": 0.05, "maxOptSteps": 200})
        results.append(_check(
            "MACE-OFF ethanol geometry opt (engine, float64)", opt,
            lambda r: r.get("converged") is True and r["params"].get("precision") == "float64"
            and r["trajectory"]["energies"][-1] <= r["trajectory"]["energies"][0] + 1e-9
            and max_force(r) < 0.05,
            note="Converged, in float64 (CLAUDE.md), energy did not rise, final max|F| below fmax",
        ))

        print("Test 4: Force conservation...", file=sys.stderr)
        results.append(_check(
            "Force conservation (H2O)", h2o, lambda r: net_force(r) < 0.01,
            note="Net force should be ~0 for an isolated molecule",
            net_force_magnitude=net_force(h2o) if h2o.get("status") == "success" else None,
        ))

        print("Test 5: Result validation...", file=sys.stderr)
        results.append(_check(
            "Result validation (Si and H2O engine results)", si,
            lambda r: validate_result(r)["valid"] and h2o.get("status") == "success" and validate_result(h2o)["valid"],
            note="validate_result() on real engine output",
        ))

    except ImportError as e:
        results.append({
            "test": "Import check",
            "passed": False,
            "error": f"Missing package: {e}. Install the locked backend (mace-api/requirements.lock.txt).",
        })
    except Exception as e:  # noqa: BLE001 — the self-test reports, never crashes
        results.append({"test": "Unexpected error", "passed": False, "error": f"{type(e).__name__}: {e}"})

    all_passed = bool(results) and all(r.get("passed", False) for r in results)
    return {"all_passed": all_passed, "tests": results}


def cli(argv: list[str]) -> int:
    """The command line; --test exits 1 unless every check passed (D79)."""
    if argv and argv[0] == "--test":
        output = run_verification_tests()
        print(json.dumps(output, indent=2))
        return 0 if output.get("all_passed") is True else 1
    return _legacy_cli(argv)


def _legacy_cli(argv: list[str]) -> int:
    sys.argv = [sys.argv[0], *argv]
    if len(sys.argv) > 1:
        if sys.argv[1] == "--test":
            output = run_verification_tests()
            print(json.dumps(output, indent=2))
        elif sys.argv[1] == "--verify-models":
            output = run_verification_tests()
            print(json.dumps(output, indent=2))
        else:
            # Validate a result JSON
            try:
                result = json.loads(sys.argv[1])
                validation = validate_result(result)
                params = result.get("params", {})
                if params:
                    param_validation = validate_params(params)
                    validation["param_validation"] = param_validation
                print(json.dumps(validation, indent=2))
            except json.JSONDecodeError:
                # Try reading as file
                try:
                    with open(sys.argv[1]) as f:
                        result = json.load(f)
                    validation = validate_result(result)
                    print(json.dumps(validation, indent=2))
                except Exception as e:
                    print(json.dumps({"error": f"Could not parse input: {e}"}))
    else:
        print("Usage:")
        print("  python validate_calculation.py <result_json_or_file>")
        print("  python validate_calculation.py --test")
        print("  python validate_calculation.py --verify-models")
    return 0


if __name__ == "__main__":
    _quiet_cli_output()
    sys.exit(cli(sys.argv[1:]))
