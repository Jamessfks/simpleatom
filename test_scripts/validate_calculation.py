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
                f"Energy/atom = {e_per_atom:.4f} eV is unusually low "
                f"(< {e_min} eV/atom for {model_type}). Check structure."
            )
        elif e_per_atom > e_max:
            issues.append(
                f"Energy/atom = {e_per_atom:.4f} eV is unphysically high "
                f"(> {e_max} eV/atom). Structure likely has issues."
            )
        else:
            info.append(f"Energy/atom = {e_per_atom:.4f} eV — within reasonable range for {model_type}")

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
                    f"(> {FORCE_MAX_CRITICAL}). Atoms likely overlapping."
                )
            elif max_force > FORCE_MAX_REASONABLE:
                warnings_list.append(
                    f"Max force = {max_force:.2f} eV/Å is large "
                    f"(> {FORCE_MAX_REASONABLE}). Structure may have close contacts."
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


def run_verification_tests():
    """Run basic model verification tests with real MACE calculations."""
    results = []

    try:
        import numpy as np
        from ase import Atoms
        from ase.build import bulk, molecule
        from mace.calculators import mace_mp, mace_off

        # Test 1: MACE-MP-0 on silicon bulk
        print("Test 1: MACE-MP-0 single-point on Si bulk...", file=sys.stderr)
        si = bulk("Si", "diamond", a=5.43)
        calc_mp = mace_mp(model="small", default_dtype="float32", device="cpu")
        si.calc = calc_mp
        e_si = si.get_potential_energy()
        f_si = si.get_forces()
        results.append({
            "test": "MACE-MP-0 Si bulk",
            "passed": True,
            "energy_per_atom": e_si / len(si),
            "max_force": float(np.max(np.linalg.norm(f_si, axis=1))),
            "note": "Si diamond (a=5.43 Å), 2 atoms"
        })

        # Test 2: MACE-OFF on water molecule
        print("Test 2: MACE-OFF single-point on H2O...", file=sys.stderr)
        water = molecule("H2O")
        water.center(vacuum=5.0)
        calc_off = mace_off(model="small", default_dtype="float32", device="cpu")
        water.calc = calc_off
        e_water = water.get_potential_energy()
        f_water = water.get_forces()
        results.append({
            "test": "MACE-OFF H2O molecule",
            "passed": True,
            "energy": float(e_water),
            "max_force": float(np.max(np.linalg.norm(f_water, axis=1))),
            "note": "Isolated water molecule"
        })

        # Test 3: Geometry optimization of ethanol
        print("Test 3: MACE-OFF geometry opt on ethanol...", file=sys.stderr)
        from ase.optimize import BFGS
        ethanol = molecule("CH3CH2OH")
        ethanol.center(vacuum=5.0)
        ethanol.calc = calc_off
        e_before = ethanol.get_potential_energy()
        opt = BFGS(ethanol, logfile=None)
        opt.run(fmax=0.05, steps=100)
        e_after = ethanol.get_potential_energy()
        f_after = ethanol.get_forces()
        results.append({
            "test": "MACE-OFF ethanol geometry opt",
            "passed": e_after <= e_before + 0.001,  # Energy should decrease
            "energy_before": float(e_before),
            "energy_after": float(e_after),
            "max_force_after": float(np.max(np.linalg.norm(f_after, axis=1))),
            "opt_steps": opt.nsteps,
            "note": "Energy should decrease during optimization"
        })

        # Test 4: Force sum check (should be ~zero for isolated molecule)
        print("Test 4: Force conservation check...", file=sys.stderr)
        net_force = np.sum(f_water, axis=0)
        net_mag = float(np.linalg.norm(net_force))
        results.append({
            "test": "Force conservation (H2O)",
            "passed": net_mag < 0.01,
            "net_force_magnitude": net_mag,
            "note": "Net force should be ~0 for isolated system"
        })

        # Test 5: Validate a sample result
        sample_result = {
            "status": "success",
            "energy": float(e_si),
            "forces": f_si.tolist(),
            "positions": si.get_positions().tolist(),
            "symbols": si.get_chemical_symbols(),
            # `params` is what selects the model-aware energy bounds below.
            # Omitting it made this self-test report "within reasonable range
            # for unknown" — the tell that the MACE-OFF branch of the bounds
            # was never exercised. calculate.py::_build_result() always emits
            # params now; this fixture mirrors that.
            "params": {
                "modelType": "MACE-MP-0",
                "modelSize": "small",
                "calculationType": "single-point",
                "precision": "float32",
                "device": "cpu",
                "dispersion": False,
            },
        }
        validation = validate_result(sample_result)
        results.append({
            "test": "Result validation (Si)",
            "passed": validation["valid"],
            "validation": validation,
        })

    except ImportError as e:
        results.append({
            "test": "Import check",
            "passed": False,
            "error": f"Missing package: {e}. Install with: pip install mace-torch ase"
        })
    except Exception as e:
        results.append({
            "test": "Unexpected error",
            "passed": False,
            "error": str(e)
        })

    all_passed = all(r.get("passed", False) for r in results)
    return {"all_passed": all_passed, "tests": results}


if __name__ == "__main__":
    _quiet_cli_output()
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
