"""
How the engine treats inputs and outputs it must not pass through: non-finite
model results, and structures that ASE reads into something other than what
the file describes. Every case here used to come back as `status: success`.

    python -m unittest discover -s test_scripts -p "test_input_handling.py"

Most tests drive `calculate.run_calculation` with a scripted ASE calculator
patched in for the foundation model, so they need no checkpoint; the few that
need a real model skip when mace-torch is not importable.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "mace-api"))
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

WATER = str(REPO_ROOT / "public" / "demo" / "water.xyz")
ETHANOL = str(REPO_ROOT / "public" / "demo" / "ethanol.xyz")
OFF_SMALL = {"modelType": "MACE-OFF", "modelSize": "small"}


def _require_mace():
    try:
        import mace.calculators  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        raise unittest.SkipTest(f"mace-torch is not importable: {exc}")


def _scripted_calculator(bad_after: int, bad: str):
    """
    An ASE calculator with a harmonic restoring force (so MD and BFGS behave)
    that starts returning NaN in `bad` ("energy" or "forces") after `bad_after`
    evaluations. Stands in for a model that blows up partway through a run.
    """
    import numpy as np
    from ase.calculators.calculator import Calculator, all_changes

    class Scripted(Calculator):
        implemented_properties = ["energy", "forces", "stress"]

        def __init__(self):
            super().__init__()
            self.calls = 0
            self.origin = None

        def calculate(self, atoms=None, properties=("energy",), system_changes=all_changes):
            super().calculate(atoms, properties, system_changes)
            pos = self.atoms.get_positions()
            if self.origin is None:
                self.origin = pos.copy()
            disp = pos - self.origin
            energy = float(0.5 * (disp ** 2).sum()) - 10.0
            forces = -disp
            self.calls += 1
            if self.calls > bad_after:
                if bad == "energy":
                    energy = float("nan")
                else:
                    forces = forces.copy()
                    forces[0, 0] = float("inf")
            self.results = {"energy": energy, "forces": forces, "stress": np.zeros(6)}

    return Scripted()


def _run_with(calc, path, params):
    import calculate
    with mock.patch.object(calculate, "get_mace_calculator", return_value=calc):
        return calculate.run_calculation(path, {**OFF_SMALL, **params}, profile="local")


class TestNonFiniteResults(unittest.TestCase):
    """
    D129: a NaN energy or force was returned as "status": "success". JSON
    cannot carry NaN (Starlette refuses it: every poll was a 500), and a NaN
    is not a number the model computed for the structure. It is refused with
    a coded error that names the closest pair of atoms, the usual cause.
    """

    def assertRefused(self, ctx):
        from contract import ContractError
        exc = ctx.exception
        self.assertIsInstance(exc, ContractError)
        self.assertEqual((exc.code, exc.status, exc.field), ("non_finite_result", 422, "structure"))
        return str(exc)

    def test_nan_energy_in_a_single_point_is_refused(self):
        with self.assertRaises(ValueError) as ctx:
            _run_with(_scripted_calculator(0, "energy"), WATER, {})
        message = self.assertRefused(ctx)
        # Water's closest pair is O-H at 0.957 Å; the message names it.
        self.assertRegex(message, r"atoms? \d+ \((O|H)\) and \d+ \((O|H)\)")
        self.assertIn("0.957", message)

    def test_infinite_force_in_a_single_point_is_refused(self):
        with self.assertRaises(ValueError) as ctx:
            _run_with(_scripted_calculator(0, "forces"), WATER, {})
        self.assertIn("forces", self.assertRefused(ctx))

    def test_nan_partway_through_a_geometry_optimisation_is_refused(self):
        with self.assertRaises(ValueError) as ctx:
            _run_with(_scripted_calculator(3, "energy"), ETHANOL,
                      {"calculationType": "geometry-opt", "maxOptSteps": 20})
        self.assertRefused(ctx)

    def test_nan_partway_through_md_is_refused(self):
        with self.assertRaises(ValueError) as ctx:
            _run_with(_scripted_calculator(5, "forces"), ETHANOL,
                      {"calculationType": "molecular-dynamics", "mdSteps": 20})
        message = self.assertRefused(ctx)
        self.assertRegex(message, r"step \d+")

    def test_a_finite_run_is_untouched(self):
        result = _run_with(_scripted_calculator(10 ** 9, "energy"), WATER, {})
        self.assertEqual(result["status"], "success")
        self.assertAlmostEqual(result["energy"], -10.0)


class TestCliOutputIsStrictJson(unittest.TestCase):
    """
    D129, end to end: water with one H placed on the O made MACE return NaN,
    and the CLI printed `"energy": NaN`, which is not JSON (Node's JSON.parse
    and Starlette both refuse it). Whatever the engine decides, stdout must be
    strict JSON and the run must not be a success.
    """

    def test_overlapping_atoms_never_print_nan(self):
        _require_mace()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "overlap.xyz")
            pathlib.Path(path).write_text("3\nwater with an H on the O\nO 0 0 0\nH 0 0 0\nH 0.76 0.59 0\n")
            proc = subprocess.run(
                [sys.executable, str(REPO_ROOT / "mace-api" / "calculate_local.py"), path,
                 json.dumps(OFF_SMALL)],
                capture_output=True, text=True, timeout=300,
                env={**os.environ, "SIMPLEATOM_PROFILE": "local"})

        def refuse(token):
            raise ValueError(f"non-JSON constant {token}")

        out = json.loads(proc.stdout, parse_constant=refuse)
        self.assertEqual(out["status"], "error", out.get("message"))
        self.assertNotIn("NaN", proc.stdout)
        self.assertTrue(re.match(r"^[a-z_]+$", out["error"]["code"]))


if __name__ == "__main__":
    unittest.main()
