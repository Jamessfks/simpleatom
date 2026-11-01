#!/usr/bin/env python3
"""
The default model and D3 dispersion, run to a checked number (D82).

test_provenance.py pins MACE-OFF small and MACE-MP-0 small. Nothing pinned an
energy for MACE-MPA-0, the default, and nothing ever executed D3: the only
dispersion tests parsed the flag. A head-selection, dtype or neighbour-list
regression specific to MPA-0 passed every gate as long as it was
translation-invariant, and a torch-dftd that was missing or broken in the
image would have shipped.

The numbers live in golden_energies.json so CI docker-smoke can check the same
MPA-0 value inside the built image.

Run: python test_scripts/run_suite.py test_model_coverage.py --min 5
"""
import json
import os
import pathlib
import sys
import unittest

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "mace-api"))

GOLDEN = json.loads((pathlib.Path(__file__).with_name("golden_energies.json")).read_text())
ATOL = GOLDEN["energyAtol"]


class TestDefaultModelAndDispersion(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        import calculate
        cls.results = {
            name: calculate.run_calculation(str(REPO_ROOT / case["file"]), dict(case["params"]))
            for name, case in GOLDEN["cases"].items()
        }

    def _check(self, name):
        case, result = GOLDEN["cases"][name], self.results[name]
        self.assertEqual(result["status"], "success", result.get("message"))
        self.assertEqual(len(result["symbols"]), case["nAtoms"])
        self.assertEqual(result["params"]["precision"], case["precision"])
        self.assertEqual(result["params"]["dispersion"], case["dispersion"])
        self.assertAlmostEqual(result["energy"], case["energy"], delta=ATOL)
        return result

    def test_the_default_model_matches_its_golden_energy(self):
        result = self._check("silicon-mpa0")
        self.assertEqual(result["params"]["modelType"], "MACE-MPA-0")

    def test_the_mp0_baseline_matches_its_golden_energy(self):
        self._check("silicon-mp0-small")

    def test_d3_runs_and_matches_its_golden_energy(self):
        result = self._check("silicon-mp0-small-d3")
        self.assertFalse(any("NOT applied" in w for w in result.get("warnings", [])), result.get("warnings"))

    def test_d3_lowers_the_energy_by_the_pinned_amount(self):
        cases = GOLDEN["cases"]
        pinned = cases["silicon-mp0-small-d3"]["energy"] - cases["silicon-mp0-small"]["energy"]
        got = self.results["silicon-mp0-small-d3"]["energy"] - self.results["silicon-mp0-small"]["energy"]
        self.assertLess(got, 0, "D3 is attractive; a zero or positive shift means it did not run")
        self.assertAlmostEqual(got, pinned, delta=2 * ATOL)

    def test_the_d3_calculator_is_the_sum_upstream_builds(self):
        import calculate
        calc = calculate.get_mace_calculator("MACE-MP-0", "small", "cpu", True, "float32")
        self.assertTrue(calculate.dispersion_is_active(calc))
        self.assertFalse(calculate.dispersion_is_active(
            calculate.get_mace_calculator("MACE-MP-0", "small", "cpu", False, "float32")))


if __name__ == "__main__":
    unittest.main()
