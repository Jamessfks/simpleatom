#!/usr/bin/env python3
"""
Geometry optimisation through SimpleAtom's own path: calculate.run_calculation
-> _run_geometry_opt, with the foundation model swapped for a cheap ASE
calculator (a Morse potential, or EMT), so no checkpoint loads.

    python test_scripts/run_suite.py test_geometry_opt.py --min 10

D86: these tests used to build a BFGS optimiser of their own and never import
calculate.py, so they passed with SimpleAtom's convergence logic deleted. Each
one here reads only what the engine returned: the convergence verdict (D46:
ASE's strict max|F| < fmax on the final forces), the frame count (optSteps + 1,
D5), the message that travels with a shared result, and the effective params.
mace-api/test_geometry_opt.py holds the edge cases of the verdict itself.
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

OFF_SMALL = {"modelType": "MACE-OFF", "modelSize": "small"}
MPA = {"modelType": "MACE-MPA-0", "modelSize": "medium"}
H2_STRETCHED = "2\nProperties=species:S:1:pos:R:3\nH 0 0 0\nH 0 0 1.2\n"
MORSE_R0 = 0.97  # the Morse minimum, Å


def _morse():
    from ase.calculators.morse import MorsePotential
    return MorsePotential(epsilon=4.0, r0=MORSE_R0, rho0=5.0)


def _optimise(text, calc, *, model=OFF_SMALL, name="h2.xyz", hooks=None, **params):
    """Run a geometry optimisation of `text` through the engine with `calc` as the model."""
    import calculate
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, name)
        pathlib.Path(path).write_text(text)
        with mock.patch.object(calculate, "get_mace_calculator", return_value=calc) as loader:
            result = calculate.run_calculation(
                path, {**model, "calculationType": "geometry-opt", **params},
                profile="local", hooks=hooks)
        loader.assert_called_once()  # the swapped-in calculator is what ran
        return result


def _max_force(forces):
    import numpy as np
    return float(np.linalg.norm(np.asarray(forces), axis=1).max())


class TestConvergedRun(unittest.TestCase):
    """Stretched H2 on a Morse potential: BFGS reaches fmax 0.05 in a handful of steps."""

    @classmethod
    def setUpClass(cls):
        cls.result = _optimise(H2_STRETCHED, _morse(), forceThreshold=0.05, maxOptSteps=200)

    def test_the_result_says_converged_in_every_place_it_travels(self):
        r = self.result
        steps = r["params"]["optSteps"]
        self.assertGreater(steps, 0)
        self.assertIs(r["converged"], True)
        self.assertIs(r["params"]["converged"], True)
        self.assertTrue(r["message"].startswith("Geometry optimization CONVERGED for h2.xyz"), r["message"])
        self.assertIn(f"reached in {steps} of at most 200 BFGS steps", r["message"])
        self.assertNotIn("NOT CONVERGE", r["message"])
        self.assertFalse(any("not converged" in w for w in r.get("warnings", [])), r.get("warnings"))
        self.assertNotIn("stoppedEarly", r)

    def test_the_final_max_force_is_below_fmax_and_is_the_largest_reported_force(self):
        r = self.result
        self.assertLess(r["params"]["finalFmax"], 0.05)
        # Per-atom vector norm, the quantity ASE's criterion uses, read off the
        # forces the result reports: not a component, not an RMS.
        self.assertAlmostEqual(r["params"]["finalFmax"], _max_force(r["forces"]), places=12)
        self.assertIn(f"max force {r['params']['finalFmax']:.4f} eV/Å", r["message"])

    def test_the_trajectory_has_one_frame_per_step_plus_the_start(self):
        traj = self.result["trajectory"]
        steps = self.result["params"]["optSteps"]
        self.assertEqual(traj["step"], list(range(steps + 1)))
        self.assertEqual(len(traj["energies"]), steps + 1)
        self.assertEqual(len(traj["positions"]), steps + 1)

    def test_the_trajectory_runs_from_the_input_to_the_reported_geometry(self):
        r = self.result
        traj = r["trajectory"]
        self.assertEqual(traj["positions"][0], [[0.0, 0.0, 0.0], [0.0, 0.0, 1.2]])
        self.assertEqual(traj["positions"][-1], r["positions"])
        self.assertEqual(traj["energies"][-1], r["energy"])

    def test_the_optimiser_moved_the_bond_downhill_to_the_minimum(self):
        import numpy as np
        r = self.result
        bond = float(np.linalg.norm(np.subtract(*r["positions"])))
        self.assertAlmostEqual(bond, MORSE_R0, delta=0.005)
        self.assertLess(r["energy"], r["trajectory"]["energies"][0] - 0.1)

    def test_the_effective_params_echo_what_ran(self):
        p = self.result["params"]
        self.assertEqual((p["calculationType"], p["forceThreshold"], p["maxOptSteps"]),
                         ("geometry-opt", 0.05, 200))
        self.assertIsInstance(p["optSteps"], int)
        self.assertNotIn("trajectoryStride", p)


class TestStepLimitedRun(unittest.TestCase):
    """The same molecule with fmax 0.001 and room for only 3 BFGS steps."""

    @classmethod
    def setUpClass(cls):
        cls.result = _optimise(H2_STRETCHED, _morse(), forceThreshold=0.001, maxOptSteps=3)

    def test_running_out_of_steps_is_not_converged_and_the_message_says_why(self):
        r = self.result
        self.assertIs(r["converged"], False)
        self.assertIs(r["params"]["converged"], False)
        self.assertEqual(r["params"]["optSteps"], 3)
        self.assertGreaterEqual(r["params"]["finalFmax"], 0.001)
        self.assertTrue(r["message"].startswith("Geometry optimization DID NOT CONVERGE for h2.xyz"),
                        r["message"])
        self.assertIn("the maxOptSteps limit of 3", r["message"])
        self.assertIn("NOT a relaxed minimum", r["message"])
        self.assertTrue(any(w.startswith("Optimization not converged") and "after 3/3 steps" in w
                            for w in r["warnings"]), r["warnings"])
        self.assertNotIn("stoppedEarly", r)

    def test_every_step_that_ran_is_a_frame(self):
        self.assertEqual(self.result["trajectory"]["step"], [0, 1, 2, 3])


class TestTheLimitAndTheVerdict(unittest.TestCase):
    """
    Hitting maxOptSteps is not by itself a failure: a run that reaches fmax on
    its last allowed step converged, and one step fewer did not.
    """

    def test_reaching_fmax_on_the_last_allowed_step_is_converged(self):
        needed = _optimise(H2_STRETCHED, _morse(), forceThreshold=0.05, maxOptSteps=200)["params"]["optSteps"]
        exact = _optimise(H2_STRETCHED, _morse(), forceThreshold=0.05, maxOptSteps=needed)
        short = _optimise(H2_STRETCHED, _morse(), forceThreshold=0.05, maxOptSteps=needed - 1)
        self.assertIs(exact["converged"], True, exact["message"])
        self.assertEqual(exact["params"]["optSteps"], needed)
        self.assertIs(short["converged"], False, short["message"])
        self.assertIn(f"the maxOptSteps limit of {needed - 1}", short["message"])


class TestBudgetStopMidRun(unittest.TestCase):
    """A time-budget stop at step 3, above fmax: the frames and the record agree on where it stopped."""

    def test_a_budget_stop_reports_the_steps_that_ran(self):
        import calculate

        class StopAtStep3(calculate.RunHooks):
            def tick(self, phase, step, total, **extra):
                if step == 3:
                    raise calculate._StopEarly(step)

        r = _optimise(H2_STRETCHED, _morse(), hooks=StopAtStep3(deadline=float("inf")),
                      forceThreshold=0.001, maxOptSteps=200)
        self.assertIs(r["converged"], False)
        self.assertEqual(r["params"]["optSteps"], 3)
        self.assertEqual(r["stoppedEarly"]["atStep"], 3)
        self.assertEqual(r["trajectory"]["step"], [0, 1, 2, 3])
        self.assertIn("the time budget after 3 BFGS steps", r["message"])


class TestStridedTrajectory(unittest.TestCase):
    """A large run keeps every k-th frame, and always the last one."""

    def test_the_final_frame_is_kept_whatever_the_stride(self):
        import calculate
        with mock.patch.object(calculate.contract, "trajectory_stride", return_value=3):
            r = _optimise(H2_STRETCHED, _morse(), forceThreshold=0.001, maxOptSteps=200)
        n = r["params"]["optSteps"]
        self.assertNotEqual(n % 3, 0, "pick a case whose last step is off the stride")
        self.assertEqual(r["trajectory"]["step"], list(range(0, n + 1, 3)) + [n])
        self.assertEqual(len(r["trajectory"]["energies"]), len(r["trajectory"]["step"]))
        self.assertEqual(r["trajectory"]["positions"][-1], r["positions"])
        self.assertEqual(r["params"]["trajectoryStride"], 3)


class TestPeriodicCellIsHeld(unittest.TestCase):
    """CLAUDE.md: only atomic positions are optimised; the cell is never relaxed."""

    def test_a_displaced_atom_in_a_copper_cell_relaxes_and_the_cell_stays(self):
        import numpy as np
        from ase.calculators.emt import EMT
        text = ('4\nLattice="3.6 0 0 0 3.6 0 0 0 3.6" Properties=species:S:1:pos:R:3 pbc="T T T"\n'
                "Cu 0.15 0 0\nCu 0 1.8 1.8\nCu 1.8 0 1.8\nCu 1.8 1.8 0\n")
        r = _optimise(text, EMT(), model=MPA, name="cu.xyz", forceThreshold=0.01, maxOptSteps=100)
        self.assertIs(r["converged"], True, r["message"])
        self.assertLess(_max_force(r["forces"]), 0.01)
        self.assertEqual(r["lattice"], [[3.6, 0.0, 0.0], [0.0, 3.6, 0.0], [0.0, 0.0, 3.6]])
        self.assertLess(r["energy"], r["trajectory"]["energies"][0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
