"""
Physical invariants of the engine's numbers, by execution with real models
(MACE-OFF small on ethanol, MACE-MPA-0 medium on silicon, float64).

    python -m unittest discover -s test_scripts -p "test_invariants.py"

These hold for any correct implementation, so they catch a broken unit
conversion, sign, integrator setting or seed even when every golden number
was regenerated alongside the bug (D78, D80). Each test names the mutant it
exists to kill. Budget: under 3 minutes on 2 threads.
"""

import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "mace-api"))
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

ETHANOL = str(REPO_ROOT / "test" / "fixtures" / "ethanol-golden.xyz")  # D119: the strained file the goldens were measured on
SILICON = str(REPO_ROOT / "public" / "demo" / "silicon.cif")
OFF = {"modelType": "MACE-OFF", "modelSize": "small"}
MPA = {"modelType": "MACE-MPA-0", "modelSize": "medium"}


def _require_mace():
    try:
        import mace.calculators  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        raise unittest.SkipTest(f"mace-torch is not importable: {exc}")


def _calculator(model):
    import calculate
    import contract
    import safe_load
    with safe_load.trusted_checkpoints(contract.allowed_checkpoint_sha256()):
        return calculate.get_mace_calculator(model["modelType"], model["modelSize"], "cpu", False, "float64")


def _strained_silicon():
    """Demo Si with a 1 % random symmetric strain and 0.02 Å rattles: every stress component non-zero."""
    import numpy as np
    from ase.io import read
    atoms = read(SILICON, index=0)
    rng = np.random.default_rng(3)
    eps = rng.uniform(-0.01, 0.01, (3, 3))
    eps = 0.5 * (eps + eps.T)
    atoms.set_cell(atoms.cell @ (np.eye(3) + eps), scale_atoms=True)
    atoms.positions += rng.normal(0, 0.02, atoms.positions.shape)
    return atoms


def _write(tmp, name, atoms):
    from ase.io import write
    path = os.path.join(tmp, name)
    write(path, atoms, format="extxyz")
    return path


class TestModelInvariants(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _require_mace()
        from ase.io import read
        cls.off = _calculator(OFF)
        cls.mpa = _calculator(MPA)
        cls.ethanol = read(ETHANOL, index=0)
        cls.si = _strained_silicon()

    def _efs(self, atoms, calc, stress=False):
        import numpy as np
        atoms = atoms.copy()
        atoms.calc = calc
        out = [atoms.get_potential_energy(), np.array(atoms.get_forces())]
        if stress:
            out.append(np.array(atoms.get_stress(voigt=False)))
        return out

    def test_forces_are_minus_the_energy_gradient(self):
        """Kills: a force sign flip, or forces from a different geometry than the energy."""
        import numpy as np
        e0, f0 = self._efs(self.ethanol, self.off)
        delta = 1e-3
        for atom, axis in ((0, 0), (2, 1), (5, 2), (8, 0)):
            plus, minus = self.ethanol.copy(), self.ethanol.copy()
            plus.positions[atom, axis] += delta
            minus.positions[atom, axis] -= delta
            fd = -(self._efs(plus, self.off)[0] - self._efs(minus, self.off)[0]) / (2 * delta)
            self.assertAlmostEqual(f0[atom, axis], fd, delta=5e-4, msg=(atom, axis))
        self.assertLess(float(np.abs(f0.sum(axis=0)).max()), 1e-6)  # isolated molecule: no net force

    def test_permuting_atoms_permutes_forces(self):
        import numpy as np
        e0, f0 = self._efs(self.ethanol, self.off)
        order = np.random.default_rng(1).permutation(len(self.ethanol))
        e1, f1 = self._efs(self.ethanol[order], self.off)
        self.assertAlmostEqual(e0, e1, delta=1e-8)
        np.testing.assert_allclose(f1, f0[order], atol=1e-8)

    def test_rotation_rotates_forces_and_stress(self):
        """Kills: forces or stress reported in a frame other than the structure's."""
        import numpy as np
        from scipy.spatial.transform import Rotation
        rot = Rotation.from_euler("zyx", [31, -47, 12], degrees=True).as_matrix()
        e0, f0 = self._efs(self.ethanol, self.off)
        mol = self.ethanol.copy()
        mol.positions = mol.positions @ rot.T
        e1, f1 = self._efs(mol, self.off)
        self.assertAlmostEqual(e0, e1, delta=1e-8)
        np.testing.assert_allclose(f1, f0 @ rot.T, atol=1e-7)

        e0, f0, s0 = self._efs(self.si, self.mpa, stress=True)
        crystal = self.si.copy()
        crystal.set_cell(crystal.cell @ rot.T, scale_atoms=True)
        e1, f1, s1 = self._efs(crystal, self.mpa, stress=True)
        self.assertAlmostEqual(e0, e1, delta=1e-7)
        np.testing.assert_allclose(f1, f0 @ rot.T, atol=1e-6)
        np.testing.assert_allclose(s1, rot @ s0 @ rot.T, atol=1e-7)

    def test_a_wrapped_translation_changes_nothing(self):
        import numpy as np
        e0, f0, s0 = self._efs(self.si, self.mpa, stress=True)
        moved = self.si.copy()
        moved.positions += [1.37, -2.11, 4.03]
        moved.wrap()
        e1, f1, s1 = self._efs(moved, self.mpa, stress=True)
        self.assertAlmostEqual(e0, e1, delta=1e-7)
        np.testing.assert_allclose(f1, f0, atol=1e-6)
        np.testing.assert_allclose(s1, s0, atol=1e-8)

    def test_energy_is_extensive_and_stress_intensive(self):
        import numpy as np
        e0, f0, s0 = self._efs(self.si, self.mpa, stress=True)
        e2, f2, s2 = self._efs(self.si.repeat((2, 1, 1)), self.mpa, stress=True)
        self.assertAlmostEqual(e2, 2 * e0, delta=1e-6)
        np.testing.assert_allclose(f2[: len(self.si)], f0, atol=1e-6)
        np.testing.assert_allclose(s2, s0, atol=1e-8)


class TestEngineUnitsAndSettings(unittest.TestCase):
    """The engine's own conversions, checked against physics rather than goldens."""

    @classmethod
    def setUpClass(cls):
        _require_mace()
        cls.tmp = tempfile.TemporaryDirectory()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_reported_stress_is_the_finite_strain_derivative_in_gpa(self):
        """
        Kills: a dropped or doubled GPa conversion, a stress or pressure sign
        flip, and a Voigt order mix-up. sigma_ij = (1/V) dE/d(eps_ij), Voigt
        xx yy zz yz xz xy, pressure = -mean(diagonal).
        """
        import numpy as np
        from ase import units
        import calculate

        si = _strained_silicon()
        r = calculate.run_calculation(_write(self.tmp.name, "si.xyz", si),
                                      {**MPA, "precision": "float64"}, profile="local")
        reported = np.array(r["properties"]["stress"])  # GPa
        calc = _calculator(MPA)
        h, volume = 1e-4, si.get_volume()
        voigt = [(0, 0), (1, 1), (2, 2), (1, 2), (0, 2), (0, 1)]
        fd = []
        for i, j in voigt:
            energies = []
            for sign in (1, -1):
                eps = np.zeros((3, 3))
                eps[i, j] += sign * h / (1 if i == j else 2)
                eps[j, i] = eps[i, j]
                strained = si.copy()
                strained.set_cell(si.cell @ (np.eye(3) + eps), scale_atoms=True)
                strained.calc = calc
                energies.append(strained.get_potential_energy())
            fd.append((energies[0] - energies[1]) / (2 * h) / volume / units.GPa)
        fd = np.array(fd)
        self.assertGreater(float(np.abs(fd).min()), 0.05, fd)  # every component is exercised
        np.testing.assert_allclose(reported, fd, atol=2e-3)
        self.assertAlmostEqual(r["properties"]["pressure"], -fd[:3].mean(), delta=2e-3)

    def test_reported_forces_are_minus_the_energy_gradient(self):
        """
        Kills a perturbed or rescaled force in the returned result (D78): the
        calculator-level gradient check above never sees what the engine reports.
        F_i = -dE/dx_i by central differences on the returned geometry.
        """
        import numpy as np
        import calculate

        si = _strained_silicon()
        r = calculate.run_calculation(_write(self.tmp.name, "si-f.xyz", si),
                                      {**MPA, "precision": "float64"}, profile="local")
        reported = np.array(r["forces"])
        calc = _calculator(MPA)
        h = 1e-4
        fd = np.zeros_like(reported)
        for atom in range(len(si)):
            for axis in range(3):
                energies = []
                for sign in (1, -1):
                    moved = si.copy()
                    moved.positions[atom, axis] += sign * h
                    moved.calc = calc
                    energies.append(moved.get_potential_energy())
                fd[atom, axis] = -(energies[0] - energies[1]) / (2 * h)
        self.assertGreater(float(np.abs(fd).max()), 0.05, fd)  # the forces are exercised
        np.testing.assert_allclose(reported, fd, atol=2e-4)

    def test_langevin_friction_is_converted_from_per_fs(self):
        """Kills: passing friction (1/fs) to ASE without dividing by ase.units.fs."""
        from ase import units
        import ase.md.langevin
        import calculate

        real = ase.md.langevin.Langevin
        seen = {}

        def spy(*args, **kwargs):
            seen.update(kwargs)
            return real(*args, **kwargs)

        with mock.patch.object(ase.md.langevin, "Langevin", spy):
            calculate.run_calculation(ETHANOL, {**OFF, "calculationType": "molecular-dynamics",
                                                "mdEnsemble": "NVT", "friction": 0.02, "mdSteps": 3},
                                      profile="local")
        self.assertAlmostEqual(seen["friction"], 0.02 / units.fs, places=12)
        self.assertFalse(seen["fixcm"])

    def test_npt_runs_with_the_documented_barostat(self):
        """Kills: the D17 pfactor (75 fs)^2 without the 100 GPa bulk modulus, and lost GPa units."""
        from ase import units
        import ase.md.melchionna
        import calculate

        real = ase.md.melchionna.MelchionnaNPT
        seen = {}

        def spy(*args, **kwargs):
            seen.update(kwargs)
            return real(*args, **kwargs)

        with mock.patch.object(ase.md.melchionna, "MelchionnaNPT", spy):
            r = calculate.run_calculation(SILICON, {**MPA, "calculationType": "molecular-dynamics",
                                                    "mdEnsemble": "NPT", "pressure": 1.5, "mdSteps": 5},
                                          profile="local")
        self.assertAlmostEqual(seen["pfactor"], (75 * units.fs) ** 2 * 100 * units.GPa, places=6)
        self.assertAlmostEqual(seen["externalstress"], 1.5 * units.GPa, places=12)
        self.assertAlmostEqual(seen["ttime"], 25 * units.fs, places=12)
        self.assertEqual(len(r["trajectory"]["step"]), 6)

    def test_nve_conserves_energy_on_the_shipped_ethanol(self):
        """Kills: a timestep unit error or a non-conservative integrator setting."""
        import calculate
        r = calculate.run_calculation(ETHANOL, {**OFF, "calculationType": "molecular-dynamics",
                                                "mdEnsemble": "NVE", "timeStep": 0.5, "mdSteps": 400,
                                                "precision": "float64"}, profile="local")
        # Measured: |slope| 3e-4 meV/atom/ps over 1000 steps at 0.5 fs (D130 probe).
        self.assertLess(abs(r["mdSummary"]["nveDriftMeVPerAtomPerPs"]), 0.5)

    def test_the_seed_determines_the_trajectory(self):
        import calculate
        params = {**OFF, "calculationType": "molecular-dynamics", "mdEnsemble": "NVT", "mdSteps": 10}
        a = calculate.run_calculation(ETHANOL, {**params, "seed": 7}, profile="local")
        b = calculate.run_calculation(ETHANOL, {**params, "seed": 7}, profile="local")
        c = calculate.run_calculation(ETHANOL, {**params, "seed": 8}, profile="local")
        self.assertEqual(a["trajectory"]["positions"], b["trajectory"]["positions"])
        self.assertNotEqual(a["trajectory"]["positions"][-1], c["trajectory"]["positions"][-1])


if __name__ == "__main__":
    unittest.main()
