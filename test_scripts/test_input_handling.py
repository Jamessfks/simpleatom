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
            # Minimum 0.3 Å away from the input, so BFGS has steps to take.
            disp = pos - self.origin - 0.3
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
        # Water's closest pair is O-H at 0.958 Å; the message names it.
        self.assertRegex(message, r"atoms? \d+ \((O|H)\) and \d+ \((O|H)\)")
        self.assertIn("0.958", message)

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
        self.assertAlmostEqual(result["energy"], -10.0 + 0.5 * 0.09 * 9)


ADVERSARIAL = REPO_ROOT / "test" / "fixtures" / "structures" / "adversarial"


def _fixture(name: str) -> str:
    return str(next(ADVERSARIAL.glob(f"{name}__*")))


def _run_text(text: str, suffix: str, params=None):
    """Run a structure given as text through the engine with a scripted calculator."""
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "upload" + suffix)
        pathlib.Path(path).write_text(text)
        return _run_with(_scripted_calculator(10 ** 9, "energy"), path,
                         {"modelType": "MACE-MPA-0", "modelSize": "medium", **(params or {})})


def _run_file(path: str, params=None):
    return _run_text(pathlib.Path(path).read_text(), pathlib.Path(path).suffix or ".vasp", params)


def _formula(result) -> dict:
    from collections import Counter
    return dict(Counter(result["symbols"]))


class _RefusalMixin:
    def assertRefusedWith(self, code, fn, *args, **kwargs):
        from contract import ContractError
        with self.assertRaises(ContractError) as ctx:
            fn(*args, **kwargs)
        self.assertEqual(ctx.exception.code, code, str(ctx.exception))
        self.assertEqual(ctx.exception.field, "structure")
        return str(ctx.exception)


NACL_P1 = """data_NaCl
_symmetry_space_group_name_H-M 'P 1'
_cell_length_a 5.64
_cell_length_b 5.64
_cell_length_c 5.64
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_site_type_symbol
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
{na} Na1 0 0 0
{na} Na2 0 0.5 0.5
{na} Na3 0.5 0 0.5
{na} Na4 0.5 0.5 0
{cl} Cl5 0.5 0 0
{cl} Cl6 0 0.5 0
{cl} Cl7 0 0 0.5
{cl} Cl8 0.5 0.5 0.5
"""


class TestCifElementSymbols(_RefusalMixin, unittest.TestCase):
    """
    D113: ASE reads a CIF type symbol with the regex [A-Z][a-z]?, so upper-case
    NA/CL became N/C (NaCl computed as C4N4), FE became F, CU became C, and a
    lower-case symbol crashed. Type symbols are element symbols, case-blind,
    optionally followed by a charge; they are normalised before ASE sees them.
    """

    def test_upper_case_type_symbols_are_the_elements_they_name(self):
        result = _run_file(_fixture("cif_uppercase_symbols"))
        self.assertEqual(_formula(result), {"Na": 4, "Cl": 4})

    def test_case_and_charge_spellings_give_the_same_structure(self):
        import numpy as np
        reference = _run_text(NACL_P1.format(na="Na", cl="Cl"), ".cif")
        for na, cl in (("NA", "CL"), ("na", "cl"), ("Na1+", "Cl1-"), ("NA+", "CL-")):
            with self.subTest(na=na, cl=cl):
                result = _run_text(NACL_P1.format(na=na, cl=cl), ".cif")
                self.assertEqual(result["symbols"], reference["symbols"])
                np.testing.assert_allclose(result["positions"], reference["positions"], atol=1e-9)

    def test_oxidation_states_are_stripped(self):
        self.assertEqual(_formula(_run_file(_fixture("cif_type_symbol_oxidation"))), {"Fe": 1, "O": 1})

    def test_an_all_caps_label_that_reads_as_two_elements_is_refused(self):
        # No type symbol, label "CA1": calcium, or the alpha carbon of a residue?
        text = NACL_P1.replace("_atom_site_type_symbol\n", "").replace("{na} ", "").replace("{cl} ", "")
        text = text.replace("Na1 ", "CA1 ")
        self.assertRefusedWith("ambiguous_element", _run_text, text, ".cif")

    def test_an_unknown_type_symbol_is_refused(self):
        self.assertRefusedWith("unknown_element", _run_text, NACL_P1.format(na="Xq", cl="Cl"), ".cif")


class TestCifOriginChoice(_RefusalMixin, unittest.TestCase):
    """
    D114: Fd-3m has two origin choices. A CIF that gives only the H-M symbol
    (no symmetry operations) was expanded with origin-1 operators whatever the
    coordinates meant: origin-2 diamond came out as 16 atoms 1.92 Å apart at
    237 GPa. An explicit ':2' was ignored too. Now ':1'/':2' (or
    _symmetry_space_group_setting) is honoured and a bare H-M symbol for a
    two-origin group is refused.
    """

    NN = 5.4309 * 3 ** 0.5 / 4  # diamond nearest-neighbour distance for the fixtures' a

    def _nn(self, result):
        from ase import Atoms
        atoms = Atoms(result["symbols"], positions=result["positions"], cell=result["lattice"], pbc=True)
        d = atoms.get_all_distances(mic=True)
        return float(d[d > 1e-6].min())

    def test_bare_hm_symbol_for_a_two_origin_group_is_refused(self):
        message = self.assertRefusedWith("ambiguous_origin_choice", _run_file,
                                         _fixture("cif_diamond_origin2_hm_only"))
        self.assertIn(":2", message)

    def test_an_explicit_origin_2_is_honoured(self):
        result = _run_file(_fixture("cif_diamond_origin2_colon2"))
        self.assertEqual(len(result["symbols"]), 8)
        self.assertAlmostEqual(self._nn(result), self.NN, delta=1e-4)

    def test_an_explicit_origin_1_is_honoured(self):
        text = pathlib.Path(_fixture("cif_diamond_origin1_hm_only")).read_text()
        result = _run_text(text.replace("'F d -3 m'", "'F d -3 m :1'"), ".cif")
        self.assertEqual(len(result["symbols"]), 8)
        self.assertAlmostEqual(self._nn(result), self.NN, delta=1e-4)

    def test_a_single_origin_group_still_expands_from_its_symbol(self):
        result = _run_file(_fixture("cif_nacl_asym_hm_only"))
        self.assertEqual(_formula(result), {"Na": 4, "Cl": 4})

    def test_explicit_symmetry_operations_need_no_origin_label(self):
        result = _run_file(_fixture("cif_nacl_asym_symops"))
        self.assertEqual(_formula(result), {"Na": 4, "Cl": 4})


class TestCifOccupancyAndDuplicates(_RefusalMixin, unittest.TestCase):
    """
    D115: partial occupancy was silently made full (disordered Cu0.5Au0.5 came
    out as pure Au4; a 25 %-occupied site as a full one). MACE computes one
    ordered configuration, so a disordered site is refused, and so is a site
    that lands on another one after expansion.
    """

    def test_mixed_occupancy_is_refused(self):
        self.assertRefusedWith("partial_occupancy", _run_file, _fixture("cif_partial_occupancy_mixed"))

    def test_a_vacancy_is_refused(self):
        message = self.assertRefusedWith("partial_occupancy", _run_file,
                                         _fixture("cif_partial_occupancy_vacancy"))
        self.assertIn("0.25", message)

    def test_full_occupancy_columns_are_accepted(self):
        self.assertEqual(_formula(_run_file(_fixture("cif_aniso_loop_after"))), {"Na": 4, "Cl": 4})

    def test_two_sites_on_the_same_position_are_refused(self):
        text = NACL_P1.format(na="Na", cl="Cl").replace("Cl8 0.5 0.5 0.5", "Cl8 0 0 0")
        self.assertRefusedWith("overlapping_atoms", _run_text, text, ".cif")


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
        self.assertNotRegex(proc.stdout, r":\s*-?(NaN|Infinity)")
        self.assertTrue(re.match(r"^[a-z_]+$", out["error"]["code"]))


if __name__ == "__main__":
    unittest.main()
