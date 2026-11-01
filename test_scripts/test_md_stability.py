"""
Molecular dynamics: what is reported about a run must be true of the run.

    python -m unittest discover -s test_scripts -p "test_md_stability.py"

Temperature bookkeeping is tested with a scripted harmonic calculator (no
checkpoint needed, deterministic with the default seed); divergence is tested
on real MACE-OFF small trajectories and skips when mace-torch is absent.
"""

import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "mace-api"))
sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from test_input_handling import _require_mace, _scripted_calculator  # noqa: E402

ETHANOL = str(REPO_ROOT / "test" / "fixtures" / "ethanol-golden.xyz")  # D119: the strained file the goldens were measured on


def _cu_slab_poscar(fixed: bool) -> str:
    """Cu fcc 2x2x2 conventional (32 atoms); with `fixed`, the lower half is F F F."""
    from ase.build import bulk
    from ase.constraints import FixAtoms
    from ase.io import write

    atoms = bulk("Cu", "fcc", a=3.615, cubic=True).repeat((2, 2, 2))
    if fixed:
        atoms.set_constraint(FixAtoms(indices=[a.index for a in atoms if a.position[2] < 3.6]))
    with tempfile.NamedTemporaryFile("w", suffix=".vasp", delete=False) as fh:
        path = fh.name
    write(path, atoms, format="vasp", direct=True)
    return path


def _md(path: str, **params):
    import calculate
    with mock.patch.object(calculate, "get_mace_calculator",
                           return_value=_scripted_calculator(10 ** 9, "energy")):
        return calculate.run_calculation(
            path, {"modelType": "MACE-MPA-0", "modelSize": "medium",
                   "calculationType": "molecular-dynamics", **params}, profile="local")


class TestFixedAtomsTemperature(unittest.TestCase):
    """
    D131: the reported temperature divided the kinetic energy by 3N (NVT) or
    3N-3 (NVE/NPT) whatever the file's constraints. Selective dynamics with
    half the atoms fixed (a typical slab CONTCAR) reported ~150 K while the
    thermostat held the free atoms at 300 K. The divisor now comes from
    ASE's constraint-aware degree-of-freedom count, and centre-of-mass removal
    is skipped when atoms are fixed (momentum is not conserved then).
    """

    @classmethod
    def setUpClass(cls):
        cls.fixed = _cu_slab_poscar(True)
        cls.free = _cu_slab_poscar(False)

    @classmethod
    def tearDownClass(cls):
        os.unlink(cls.fixed)
        os.unlink(cls.free)

    def test_nvt_divides_by_the_free_degrees_of_freedom(self):
        r = _md(self.fixed, mdEnsemble="NVT", temperature=300, friction=0.02, mdSteps=1000)
        self.assertEqual(r["params"]["temperatureDegreesOfFreedom"], 48)
        temps = r["trajectory"]["temperatures"]
        tail = temps[len(temps) // 2:]
        self.assertAlmostEqual(sum(tail) / len(tail), 300, delta=60)

    def test_nve_with_fixed_atoms_does_not_subtract_the_centre_of_mass(self):
        r = _md(self.fixed, mdEnsemble="NVE", temperature=300, mdSteps=5)
        self.assertEqual(r["params"]["temperatureDegreesOfFreedom"], 48)
        self.assertFalse(r["params"]["comMomentumRemoved"])

    def test_without_constraints_nothing_changes(self):
        nvt = _md(self.free, mdEnsemble="NVT", mdSteps=5)
        nve = _md(self.free, mdEnsemble="NVE", mdSteps=5)
        self.assertEqual(nvt["params"]["temperatureDegreesOfFreedom"], 96)
        self.assertEqual(nve["params"]["temperatureDegreesOfFreedom"], 93)
        self.assertTrue(nve["params"]["comMomentumRemoved"])


def _misbehaving_calculator(kind: str, after: int = 20):
    """
    Harmonic wells around the input positions, except:
    "repel"  - the spring constant flips sign after `after` calls, so the
               atoms accelerate away from each other (kinetic temperature
               explodes, as in a timestep blow-up);
    "jump"   - the potential energy jumps by 1 eV/atom after `after` calls
               while the forces stay harmonic (NVE total energy is no longer
               conserved, temperature stays sane).
    """
    import numpy as np
    from ase.calculators.calculator import Calculator, all_changes

    class Misbehaving(Calculator):
        implemented_properties = ["energy", "forces"]

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
            self.calls += 1
            k = 5.0
            if kind == "repel" and self.calls > after:
                k = -50.0
            energy = 0.5 * k * float((disp ** 2).sum())
            if kind == "jump" and self.calls > after:
                energy += 1.0 * len(pos)
            self.results = {"energy": energy, "forces": -k * disp}

    return Misbehaving()


def _md_with(calc, path, **params):
    import calculate
    with mock.patch.object(calculate, "get_mace_calculator", return_value=calc):
        return calculate.run_calculation(
            path, {"modelType": "MACE-OFF", "modelSize": "small",
                   "calculationType": "molecular-dynamics", **params}, profile="local")


class TestDivergenceIsNotCompletion(unittest.TestCase):
    """
    D130: MD at contract-allowed timesteps blew H-containing molecules apart
    (ethanol, MACE-OFF small, 2.5 fs: 2,500 Å between atoms, mean temperature
    1e13 K) and the run was reported as "MD (NVT) completed", exportable and
    shareable. A run now stops with md_diverged when the kinetic temperature
    passes max(10 x target, 5000 K), or (NVE) when the total energy has moved
    more than 0.1 eV/atom from its start.
    """

    def assertDiverged(self, ctx):
        from contract import ContractError
        self.assertIsInstance(ctx.exception, ContractError)
        self.assertEqual((ctx.exception.code, ctx.exception.status), ("md_diverged", 422))
        self.assertRegex(str(ctx.exception), r"step \d+")
        self.assertNotIn("completed", str(ctx.exception))
        return str(ctx.exception)

    def test_a_temperature_blow_up_stops_the_run(self):
        with self.assertRaises(ValueError) as ctx:
            _md_with(_misbehaving_calculator("repel"), ETHANOL, mdEnsemble="NVT", mdSteps=400)
        self.assertIn("5000", self.assertDiverged(ctx))

    def test_an_nve_energy_jump_stops_the_run(self):
        with self.assertRaises(ValueError) as ctx:
            _md_with(_misbehaving_calculator("jump"), ETHANOL, mdEnsemble="NVE", mdSteps=100)
        self.assertIn("eV/atom", self.assertDiverged(ctx))

    def test_a_well_behaved_run_completes(self):
        r = _md_with(_misbehaving_calculator("none"), ETHANOL, mdEnsemble="NVE", mdSteps=100)
        self.assertIn("completed", r["message"])

    def test_real_ethanol_at_2_5_fs_is_md_diverged(self):
        _require_mace()
        import calculate
        with self.assertRaises(ValueError) as ctx:
            calculate.run_calculation(ETHANOL, {"modelType": "MACE-OFF", "modelSize": "small",
                                                "calculationType": "molecular-dynamics",
                                                "mdEnsemble": "NVE", "timeStep": 2.5, "mdSteps": 150},
                                      profile="local")
        self.assertDiverged(ctx)


def _si_primitive_poscar(fixed: bool = False) -> str:
    """ASE's bulk('Si'): the 2-atom primitive FCC cell, whose matrix is not triangular."""
    from ase.build import bulk
    from ase.constraints import FixAtoms
    from ase.io import write

    atoms = bulk("Si", "diamond", a=5.43)
    if fixed:
        atoms.set_constraint(FixAtoms(indices=[0]))
    with tempfile.NamedTemporaryFile("w", suffix=".vasp", delete=False) as fh:
        path = fh.name
    write(path, atoms, format="vasp", direct=True)
    return path


class TestNptCellOrientation(unittest.TestCase):
    """
    D134: ASE's MelchionnaNPT runs only on a triangular cell matrix. A
    primitive cell (or any rotated POSCAR) failed after the model had loaded,
    as a 500 quoting ASE internals. The cell is now rotated rigidly to ASE's
    standard (lower-triangular) orientation before the run, and the result
    says so; with constraints attached (whose axes would rotate too) it is
    refused before any model I/O.
    """

    def test_npt_runs_on_a_primitive_cell_and_says_it_was_rotated(self):
        import numpy as np
        path = _si_primitive_poscar()
        try:
            r = _md(path, mdEnsemble="NPT", mdSteps=5, pressure=0.0)
        finally:
            os.unlink(path)
        cell = np.array(r["lattice"])
        self.assertTrue(np.allclose(np.triu(cell, 1), 0.0), cell)
        self.assertTrue(any("rotated" in w for w in r.get("warnings", [])), r.get("warnings"))

    def test_constraints_with_a_non_triangular_cell_are_refused_before_loading(self):
        import calculate
        from contract import ContractError
        path = _si_primitive_poscar(fixed=True)
        try:
            with mock.patch.object(calculate, "get_mace_calculator") as loader, \
                    self.assertRaises(ContractError) as ctx:
                calculate.run_calculation(path, {"modelType": "MACE-MPA-0", "calculationType":
                                                 "molecular-dynamics", "mdEnsemble": "NPT",
                                                 "mdSteps": 5}, profile="local")
        finally:
            os.unlink(path)
        self.assertEqual(ctx.exception.code, "npt_requires_triangular_cell")
        loader.assert_not_called()


class TestMdSummary(unittest.TestCase):
    """
    D53: the MD summary called last-minus-first total energy the "drift"
    (opposite in sign to the fitted drift on the NVE golden) and printed it for
    NVT/NPT too, and the "mean temperature" averaged every frame, warm-up
    included, with no uncertainty. D54: the pressure reported after MD was the
    virial alone (ASE's get_stress default), unlabelled.
    """

    @classmethod
    def setUpClass(cls):
        cls.free = _cu_slab_poscar(False)

    @classmethod
    def tearDownClass(cls):
        os.unlink(cls.free)

    def test_nve_drift_is_the_fitted_slope_per_atom_per_ps(self):
        import numpy as np
        r = _md(self.free, mdEnsemble="NVE", mdSteps=200, timeStep=1.0)
        tr = r["trajectory"]
        t_ps = np.array(tr["step"]) * 1.0 / 1000.0
        slope = np.polyfit(t_ps, np.array(tr["totalEnergies"]) / len(r["symbols"]), 1)[0] * 1000
        summary = r["mdSummary"]
        self.assertAlmostEqual(summary["nveDriftMeVPerAtomPerPs"], slope, places=6)
        self.assertIn("meV/atom/ps", r["message"])

    def test_thermostatted_runs_report_no_drift(self):
        r = _md(self.free, mdEnsemble="NVT", mdSteps=50)
        self.assertNotIn("nveDriftMeVPerAtomPerPs", r["mdSummary"])
        self.assertNotIn("drift", r["message"])

    def test_mean_temperature_discards_warm_up_and_carries_a_block_error(self):
        import numpy as np
        r = _md(self.free, mdEnsemble="NVT", temperature=300, friction=0.02, mdSteps=500)
        summary = r["mdSummary"]
        temps = np.array(r["trajectory"]["temperatures"])
        kept = temps[summary["warmupFrames"]:]
        self.assertGreater(summary["warmupFrames"], 0)
        self.assertAlmostEqual(summary["meanTemperature"], float(kept.mean()), places=6)
        self.assertGreater(summary["temperatureStdError"], 0)
        self.assertIn("±", r["message"])

    def test_md_pressure_includes_the_kinetic_term(self):
        from ase import units
        # The scripted calculator's virial stress is zero, so the pressure is
        # exactly the ideal-gas term 2 KE / 3V: positive, in GPa.
        r = _md(self.free, mdEnsemble="NVT", mdSteps=20)
        ke = r["trajectory"]["kineticEnergies"][-1]
        expected = 2.0 * ke / (3.0 * r["properties"]["volume"]) / units.GPa
        self.assertGreater(expected, 0)
        self.assertAlmostEqual(r["properties"]["pressure"], expected, places=9)
        self.assertTrue(r["properties"]["stressIncludesKineticTerm"])


if __name__ == "__main__":
    unittest.main()
