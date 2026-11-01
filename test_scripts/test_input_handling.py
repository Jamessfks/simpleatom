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


def _run_text(text: str, suffix: str, params=None, _profile="local"):
    """Run a structure given as text through the engine with a scripted calculator."""
    import calculate
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "upload" + suffix)
        pathlib.Path(path).write_text(text)
        with mock.patch.object(calculate, "get_mace_calculator",
                               return_value=_scripted_calculator(10 ** 9, "energy")):
            return calculate.run_calculation(
                path, {"modelType": "MACE-MPA-0", "modelSize": "medium", **(params or {})},
                profile=_profile)


def _run_file(path: str, params=None, _profile="local"):
    return _run_text(pathlib.Path(path).read_text(), pathlib.Path(path).suffix or ".vasp", params,
                     _profile=_profile)


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
    237 GPa. An explicit ':2' was ignored too, and ':1' crashed ASE. Now
    ':1'/':2' is honoured; with a bare symbol both origins are tried and the
    one that puts the listed sites on special positions (fewer atoms) is used
    and announced. Equal counts cannot be told apart, and are refused.
    """

    NN = 5.4309 * 3 ** 0.5 / 4  # diamond nearest-neighbour distance for the fixtures' a

    def _nn(self, result):
        from ase import Atoms
        atoms = Atoms(result["symbols"], positions=result["positions"], cell=result["lattice"], pbc=True)
        d = atoms.get_all_distances(mic=True)
        return float(d[d > 1e-6].min())

    def test_bare_hm_symbol_in_origin_2_is_read_in_origin_2_and_says_so(self):
        result = _run_file(_fixture("cif_diamond_origin2_hm_only"))
        self.assertEqual(len(result["symbols"]), 8)
        self.assertAlmostEqual(self._nn(result), self.NN, delta=1e-4)
        self.assertTrue(any("origin choice 2" in w and ":2" in w for w in result.get("warnings", [])),
                        result.get("warnings"))

    def test_bare_hm_symbol_in_origin_1_is_read_in_origin_1(self):
        result = _run_file(_fixture("cif_diamond_origin1_hm_only"))
        self.assertEqual(len(result["symbols"]), 8)
        self.assertAlmostEqual(self._nn(result), self.NN, delta=1e-4)

    def test_a_general_position_with_a_bare_symbol_is_refused(self):
        # One Ar on a general position: 192 atoms in either origin, a different
        # crystal in each, and nothing in the file to choose between them.
        text = (pathlib.Path(_fixture("cif_diamond_origin1_hm_only")).read_text()
                .replace("5.4309", "30.0").replace("Si1 Si 0 0 0", "Ar1 Ar 0.11 0.23 0.37"))
        self.assertIn("Ar1 Ar", text)
        message = self.assertRefusedWith("ambiguous_origin_choice", _run_text, text, ".cif")
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


class TestPlaceholderCellAndOverlaps(_RefusalMixin, unittest.TestCase):
    """
    D89: the PDB format prescribes `CRYST1 1.000 1.000 1.000 90 90 90 P 1` for
    every structure not solved by diffraction, and ASE read it as a periodic
    1 Å cube: water came out at +3.9e15 eV, as success, with a pressure. That
    record is read as "no cell", with a warning. And any structure with two
    atoms closer than 0.5 Å (minimum image) is refused before a model loads.
    """

    def test_the_cryst1_placeholder_is_not_a_cell(self):
        result = _run_file(_fixture("pdb_cryst1_placeholder"))
        self.assertIsNone(result["lattice"])
        self.assertIsNone(result["properties"]["stress"])
        self.assertTrue(any("CRYST1" in w for w in result.get("warnings", [])), result.get("warnings"))

    def test_the_placeholder_energy_equals_the_molecule_without_it(self):
        _require_mace()
        import calculate
        text = pathlib.Path(_fixture("pdb_cryst1_placeholder")).read_text()
        energies = []
        with tempfile.TemporaryDirectory() as tmp:
            for name, body in (("with.pdb", text),
                               ("without.pdb", "\n".join(l for l in text.splitlines()
                                                          if not l.startswith("CRYST1")) + "\n")):
                path = os.path.join(tmp, name)
                pathlib.Path(path).write_text(body)
                energies.append(calculate.run_calculation(path, {**OFF_SMALL, "precision": "float64"},
                                                          profile="local")["energy"])
        self.assertAlmostEqual(energies[0], energies[1], delta=1e-6)

    def test_a_real_cryst1_cell_stays_periodic(self):
        text = pathlib.Path(_fixture("pdb_cryst1_placeholder")).read_text().replace(
            "CRYST1    1.000    1.000    1.000", "CRYST1   20.000   20.000   20.000")
        result = _run_text(text, ".pdb")
        self.assertEqual([round(result["lattice"][i][i], 6) for i in range(3)], [20.0, 20.0, 20.0])

    def test_atoms_0_3_angstrom_apart_are_refused(self):
        message = self.assertRefusedWith("overlapping_atoms", _run_text,
                                         "2\n\nH 0 0 0\nH 0 0 0.3\n", ".xyz")
        self.assertIn("0.300", message)

    def test_an_overlap_across_the_periodic_boundary_is_refused(self):
        message = self.assertRefusedWith("overlapping_atoms", _run_file, _fixture("xyz_overlap_across_boundary"))
        self.assertIn("0.200", message)

    def test_0_6_angstrom_is_accepted(self):
        result = _run_text("2\n\nH 0 0 0\nH 0 0 0.6\n", ".xyz")
        self.assertEqual(result["status"], "success")


def _bomb_cif(n_sites: int) -> str:
    """Fm-3m with n random general sites: up to 192 atoms per site after expansion."""
    import numpy as np
    rng = np.random.default_rng(0)
    lines = ["data_bomb", "_cell_length_a 60", "_cell_length_b 60", "_cell_length_c 60",
             "_cell_angle_alpha 90", "_cell_angle_beta 90", "_cell_angle_gamma 90",
             "_symmetry_space_group_name_H-M 'F m -3 m'", "_space_group_IT_number 225",
             "loop_", "_atom_site_label", "_atom_site_type_symbol",
             "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z"]
    for i, (x, y, z) in enumerate(rng.random((n_sites, 3)) * 0.5):
        lines.append(f"C{i} C {x:.5f} {y:.5f} {z:.5f}")
    return "\n".join(lines) + "\n"


class TestCifExpansionBomb(_RefusalMixin, unittest.TestCase):
    """
    D133: ASE expanded a CIF's symmetry with no limit, and the atom cap was
    checked only afterwards. 1000 general sites in Fm-3m (a 31 kB file) took
    4.6 s to expand to 188,883 atoms, 8000 sites 165 s, growing ~N^1.9, all on
    the hosted Space's single worker. The expansion is now counted first and
    refused over the profile's cap without being carried out.
    """

    def test_a_symmetry_bomb_is_refused_before_it_is_expanded(self):
        import time
        import ase.io.cif
        import ase.spacegroup
        real = ase.spacegroup.crystal
        calls = []

        def counting(*args, **kwargs):
            calls.append(1)
            return real(*args, **kwargs)

        started = time.monotonic()
        with mock.patch.object(ase.spacegroup, "crystal", counting), \
                mock.patch.object(ase.io.cif, "crystal", counting):
            message = self.assertRefusedWith("limit_exceeded", _run_text, _bomb_cif(1000), ".cif",
                                             _profile="hosted")
        self.assertEqual(calls, [], "the symmetry expansion ran before the cap was checked")
        self.assertLess(time.monotonic() - started, 5.0)
        self.assertIn("5000", message)  # the hosted single-point cap, from contract.json

    def test_the_count_is_exact_for_special_positions(self):
        # NaCl: 2 sites x 192 operations, but both on special positions: 8 atoms.
        result = _run_file(_fixture("cif_nacl_asym_symops"), _profile="hosted")
        self.assertEqual(len(result["symbols"]), 8)


class TestConstrainedForces(unittest.TestCase):
    """
    D132: a single point reported ASE's constrained forces, so atoms fixed by
    selective dynamics showed exactly zero force; the model's real forces on
    them were discarded (true max |F| there 1.12 eV/Å for a Cu slab), and the
    structure hash could not tell the constrained file from the free one.
    """

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
        from test_md_stability import _cu_slab_poscar
        cls.fixed = _cu_slab_poscar(True)
        cls.free = _cu_slab_poscar(False)

    @classmethod
    def tearDownClass(cls):
        os.unlink(cls.fixed)
        os.unlink(cls.free)

    def test_single_point_reports_the_model_forces_on_fixed_atoms(self):
        import numpy as np
        fixed = _run_file(self.fixed)
        free = _run_file(self.free)
        np.testing.assert_allclose(fixed["forces"], free["forces"], atol=1e-9)
        self.assertEqual(len(fixed["constrainedAtoms"]), 16)
        self.assertTrue(any("16" in w and "fixed" in w for w in fixed.get("warnings", [])),
                        fixed.get("warnings"))
        self.assertNotIn("constrainedAtoms", free)

    def test_the_structure_hash_tells_the_constraints_apart(self):
        fixed = _run_file(self.fixed)["provenance"]["input"]
        free = _run_file(self.free)["provenance"]["input"]
        self.assertNotEqual(fixed["structureSha256"], free["structureSha256"])
        self.assertEqual(fixed["structureHashSpec"], "simpleatom-structure-v2")


class TestDegenerateCells(_RefusalMixin, unittest.TestCase):
    """
    D137: a periodic structure with no cell, or a flat one, reached the model
    and failed after it loaded, with "You have 0 lattice vectors: volume not
    defined" or "Singular matrix". It is refused before any model I/O.
    """

    def _refused_before_loading(self, text):
        import calculate
        with mock.patch.object(calculate, "get_mace_calculator") as loader:
            message = self.assertRefusedWith("invalid_cell", _run_text, text, ".xyz")
        loader.assert_not_called()
        return message

    def test_pbc_without_a_lattice_is_refused(self):
        self._refused_before_loading(
            '3\nProperties=species:S:1:pos:R:3 pbc="T T T"\nO 0 0 0.119\nH 0 0.763 -0.477\nH 0 -0.763 -0.477\n')

    def test_a_flat_cell_is_refused(self):
        self._refused_before_loading(
            '2\nLattice="3 0 0 0 3 0 0 0 0" Properties=species:S:1:pos:R:3 pbc="T T T"\nCu 0 0 0\nCu 1.5 1.5 0\n')

    def test_a_slab_needs_no_third_vector(self):
        result = _run_text('2\nLattice="3 0 0 0 3 0 0 0 0" Properties=species:S:1:pos:R:3 pbc="T T F"\n'
                           'Cu 0 0 0\nCu 1.5 1.5 0\n', ".xyz")
        self.assertEqual(result["status"], "success")

    def test_the_overlap_check_never_measures_an_invented_cell(self):
        """
        D154: ASE's neighbour list completes a missing periodic vector with a
        1 Å one, so the overlap check on demo water with pbc and no Lattice
        named a 0.479 Å pair that does not exist (the real O-H is 0.96 Å). The
        check refuses the cell itself, whoever calls it first.
        """
        import calculate
        from ase.io import read
        atoms = read(WATER)
        atoms.set_pbc(True)
        message = self.assertRefusedWith("invalid_cell", calculate.refuse_overlaps, atoms, "water.xyz")
        self.assertNotIn("apart", message)

    def test_the_message_names_the_periodic_axis_that_has_no_vector(self):
        message = self._refused_before_loading(
            '2\nLattice="3 0 0 0 3 0 0 0 0" Properties=species:S:1:pos:R:3 pbc="T T T"\nCu 0 0 0\nCu 1.5 1.5 0\n')
        self.assertIn("no lattice vector along c", message)
        message = self._refused_before_loading(
            '3\nProperties=species:S:1:pos:R:3 pbc="T T F"\nO 0 0 0.119\nH 0 0.763 -0.477\nH 0 -0.763 -0.477\n')
        self.assertIn("no lattice vector along a, b", message)

    def test_a_slab_without_a_third_vector_is_checked_with_real_distances(self):
        import calculate
        from ase.io import read
        text = '2\nLattice="3 0 0 0 3 0 0 0 0" Properties=species:S:1:pos:R:3 pbc="T T F"\nH 0 0 0\nH 0 0 {z}\n'
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "slab.xyz")
            pathlib.Path(path).write_text(text.format(z=0.6))
            calculate.refuse_overlaps(read(path), "slab.xyz")  # 0.6 Å along the open axis: accepted
            pathlib.Path(path).write_text(text.format(z=0.3))
            message = self.assertRefusedWith("overlapping_atoms", calculate.refuse_overlaps, read(path), "slab.xyz")
        self.assertIn("atoms 0 (H) and 1 (H), 0.300 Å apart", message)


class TestReferenceData(unittest.TestCase):
    """
    D91: ASE >= 3.23 moves an extended-XYZ `energy=` and `forces` column into
    a SinglePointCalculator, and the engine read only atoms.info/arrays, so
    reference data written by ase.io.write (any DFT result exported to
    extxyz) was silently dropped. It is read from the calculator's results,
    preferring `energy` over `free_energy`, and the source is recorded.
    """

    def test_energy_and_forces_columns_are_the_reference(self):
        result = _run_file(_fixture("xyz_energy_forces_columns"))
        self.assertEqual(result["referenceEnergy"], -12.5)
        self.assertEqual(result["referenceForces"][0], [0.1, 0.2, 0.3])
        self.assertEqual(result["referenceSource"]["energy"], "energy")

    def test_energy_is_preferred_to_free_energy(self):
        self.assertEqual(_run_file(_fixture("xyz_free_energy_first"))["referenceEnergy"], -2.0)

    def test_mace_training_keys_still_work(self):
        result = _run_file(_fixture("xyz_REF_energy_forces"))
        self.assertEqual(result["referenceEnergy"], -12.5)
        self.assertEqual(len(result["referenceForces"]), 3)

    def test_an_ase_written_dft_result_round_trips(self):
        import numpy as np
        from ase.calculators.singlepoint import SinglePointCalculator
        from ase.io import read, write
        atoms = read(WATER)
        forces = np.arange(9, dtype=float).reshape(3, 3) / 10
        atoms.calc = SinglePointCalculator(atoms, energy=-2079.86, forces=forces)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "dft.xyz")
            write(path, atoms, format="extxyz")
            result = _run_file(path)
        self.assertEqual(result["referenceEnergy"], -2079.86)
        np.testing.assert_allclose(result["referenceForces"], forces)


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
