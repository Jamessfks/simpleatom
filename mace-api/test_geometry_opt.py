#!/usr/bin/env python3
"""
The convergence verdict of calculate._run_geometry_opt, at its edges.

    python test_scripts/run_suite.py "test_*.py" --start-dir mace-api --min 31

D86: this file used to drive ASE's BFGS directly and check ASE's unit
constants, never importing calculate.py, so it passed with SimpleAtom's
convergence logic deleted. Every test here runs SimpleAtom's own optimiser
step with a cheap ASE calculator (a Morse potential, or a scripted constant
force) and judges only what it returned.

The rule (D46, CLAUDE.md): converged means ASE's strict test on the final
forces, max over atoms of |F_i| < fmax. Exhausting maxOptSteps without that is
not converged; reaching it on the last allowed step is. The full pipeline
(run_calculation, messages, trajectories) is in test_scripts/test_geometry_opt.py.
"""

import time
import unittest

import numpy as np
from ase import Atoms
from ase.calculators.calculator import Calculator, all_changes
from ase.calculators.morse import MorsePotential

import calculate

MORSE_R0 = 0.97


class ConstantForce(Calculator):
    """Every atom feels the same force vector everywhere (a linear potential)."""

    implemented_properties = ["energy", "forces"]

    def __init__(self, force):
        super().__init__()
        self.force = np.asarray(force, dtype=float)

    def calculate(self, atoms=None, properties=("energy",), system_changes=all_changes):
        super().calculate(atoms, properties, system_changes)
        pos = self.atoms.get_positions()
        self.results = {"energy": float(-(pos @ self.force).sum()),
                        "forces": np.tile(self.force, (len(pos), 1))}


class OneAtomForce(Calculator):
    """Only the first atom feels a force (the others none), so RMS and max differ."""

    implemented_properties = ["energy", "forces"]

    def __init__(self, force):
        super().__init__()
        self.force = np.asarray(force, dtype=float)

    def calculate(self, atoms=None, properties=("energy",), system_changes=all_changes):
        super().calculate(atoms, properties, system_changes)
        pos = self.atoms.get_positions()
        forces = np.zeros_like(pos)
        forces[0] = self.force
        self.results = {"energy": float(-(pos[0] @ self.force)), "forces": forces}


def _h2(bond, calc=None):
    atoms = Atoms("H2", positions=[[0, 0, 0], [0, 0, bond]])
    atoms.calc = calc or MorsePotential(epsilon=4.0, r0=MORSE_R0, rho0=5.0)
    return atoms


def _optimise(atoms, fmax, max_steps, deadline=None):
    ctx = calculate._RunContext(atoms=atoms, filename="h2.xyz", calc_start=time.time(), ref_data={},
                                effective_params={}, warnings=[], manifest=None,
                                hooks=calculate.RunHooks(deadline=deadline), profile_name="local")
    return calculate._run_geometry_opt(ctx, {"forceThreshold": fmax, "maxOptSteps": max_steps})


class TestConvergenceVerdict(unittest.TestCase):

    def test_reaching_fmax_is_converged(self):
        r = _optimise(_h2(1.2), 0.05, 200)
        self.assertIs(r["converged"], True, r["message"])
        self.assertGreater(r["params"]["optSteps"], 0)
        self.assertLess(r["params"]["finalFmax"], 0.05)
        self.assertAlmostEqual(abs(r["positions"][1][2] - r["positions"][0][2]), MORSE_R0, delta=0.01)

    def test_exhausting_max_opt_steps_is_not_converged(self):
        r = _optimise(_h2(1.2), 0.001, 3)
        self.assertIs(r["converged"], False, r["message"])
        self.assertEqual(r["params"]["optSteps"], 3)
        self.assertGreaterEqual(r["params"]["finalFmax"], 0.001)
        self.assertIn("DID NOT CONVERGE", r["message"])

    def test_reaching_fmax_on_the_last_allowed_step_is_converged(self):
        needed = _optimise(_h2(1.2), 0.05, 200)["params"]["optSteps"]
        r = _optimise(_h2(1.2), 0.05, needed)
        self.assertIs(r["converged"], True, r["message"])
        self.assertEqual(r["params"]["optSteps"], needed)

    def test_one_step_short_of_fmax_is_not_converged(self):
        needed = _optimise(_h2(1.2), 0.05, 200)["params"]["optSteps"]
        r = _optimise(_h2(1.2), 0.05, needed - 1)
        self.assertIs(r["converged"], False, r["message"])
        self.assertGreaterEqual(r["params"]["finalFmax"], 0.05)

    def test_a_relaxed_input_converges_at_step_zero_with_one_frame(self):
        r = _optimise(_h2(MORSE_R0), 0.05, 200)
        self.assertIs(r["converged"], True, r["message"])
        self.assertEqual(r["params"]["optSteps"], 0)
        self.assertEqual(r["trajectory"]["step"], [0])
        self.assertIn("reached in 0 of at most 200", r["message"])


class TestStrictThreshold(unittest.TestCase):
    """
    A time-budget stop is the one case where SimpleAtom, not ASE, decides
    convergence from the final forces (D46). Stopped at step 0, so BFGS never
    updates its Hessian on the linear potential.
    """

    def test_a_budget_stop_at_exactly_fmax_is_not_converged(self):
        r = _optimise(_h2(3.0, ConstantForce([0.05, 0.0, 0.0])), 0.05, 50,
                      deadline=time.monotonic() - 1)
        self.assertIn("stoppedEarly", r)
        self.assertEqual(r["params"]["finalFmax"], 0.05)
        self.assertIs(r["converged"], False, r["message"])

    def test_the_verdict_uses_each_atoms_force_vector_not_a_component(self):
        # Every component is 0.04 < fmax, but |F| = 0.04·sqrt(3) = 0.069 > fmax.
        r = _optimise(_h2(3.0, ConstantForce([0.04, 0.04, 0.04])), 0.05, 50,
                      deadline=time.monotonic() - 1)
        self.assertAlmostEqual(r["params"]["finalFmax"], 0.04 * 3 ** 0.5, places=12)
        self.assertIs(r["converged"], False, r["message"])

    def test_the_verdict_uses_the_largest_atom_force_not_an_rms(self):
        # D166: every earlier fixture was symmetric (RMS = max), so a mutant that judged
        # convergence by the RMS force survived. One atom at 0.06, the other at 0:
        # RMS 0.042 < fmax 0.05 < max 0.06.
        r = _optimise(_h2(3.0, OneAtomForce([0.06, 0.0, 0.0])), 0.05, 50,
                      deadline=time.monotonic() - 1)
        self.assertAlmostEqual(r["params"]["finalFmax"], 0.06, places=12)
        self.assertIs(r["converged"], False, r["message"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
