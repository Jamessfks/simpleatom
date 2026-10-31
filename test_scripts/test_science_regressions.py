"""
Science regressions, by execution with real MACE models (MACE-OFF small,
MACE-MPA-0 medium, MACE-MP-0 small). Each test pins one defect that shipped.

    python3 -m unittest discover -s test_scripts -p "test_science_regressions.py"

Also the upgrade gate for mace-torch (docs/adr/0025): upstream `develop`
carried an aperiodic neighbour-list bug between #1533 and #1726 that made a
displaced molecule come out ~10 eV high with zero forces. No release has
shipped it; TestTranslationInvariance is what would catch the next one.
"""

import os
import pathlib
import sys
import tempfile
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "mace-api"))
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

ETHANOL = str(REPO_ROOT / "public" / "demo" / "ethanol.xyz")
SILICON = str(REPO_ROOT / "public" / "demo" / "silicon.cif")
OFF_SMALL = {"modelType": "MACE-OFF", "modelSize": "small"}


def _require_mace():
    try:
        import mace.calculators  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        raise unittest.SkipTest(f"mace-torch is not importable: {exc}")


class TestTranslationInvariance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _require_mace()
        cls.tmp = tempfile.TemporaryDirectory()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _check(self, model_type, model_size):
        import numpy as np
        from ase.io import read, write
        import calculate

        results = []
        for offset in (0.0, -10.0, 100.0):
            atoms = read(ETHANOL)
            atoms.positions += offset
            path = os.path.join(self.tmp.name, f"eth_{model_type}_{offset}.xyz")
            write(path, atoms, format="extxyz")
            r = calculate.run_calculation(path, {"modelType": model_type, "modelSize": model_size,
                                                 "precision": "float64"})
            results.append((r["energy"], np.array(r["forces"])))
        e0, f0 = results[0]
        for energy, forces in results[1:]:
            self.assertAlmostEqual(energy, e0, delta=1e-6)
            self.assertLess(float(np.abs(forces - f0).max()), 1e-6)

    def test_mace_off(self):
        self._check("MACE-OFF", "small")

    def test_mace_mpa0(self):
        self._check("MACE-MPA-0", "medium")


class TestDefectRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _require_mace()

    def test_d5_geometry_opt_records_each_step_once(self):
        import calculate

        r = calculate.run_calculation(ETHANOL, {**OFF_SMALL, "calculationType": "geometry-opt",
                                                "maxOptSteps": 30})
        steps = r["trajectory"]["step"]
        self.assertEqual(len(steps), r["params"]["optSteps"] + 1)
        self.assertEqual(steps[:2], [0, 1])
        self.assertEqual(len(set(steps)), len(steps))

    def test_d6_pressure_for_crystals_only(self):
        import calculate

        si = calculate.run_calculation(SILICON, {"modelType": "MACE-MP-0", "modelSize": "small"})
        self.assertEqual(len(si["properties"]["stress"]), 6)
        self.assertIsInstance(si["properties"]["pressure"], float)
        mol = calculate.run_calculation(ETHANOL, OFF_SMALL)
        self.assertIsNone(mol["properties"]["pressure"])
        self.assertIsNone(mol["properties"]["stress"])

    def test_d16_multiframe_file_computes_the_first_frame(self):
        import numpy as np
        from ase.io import read, write
        import calculate

        first = read(ETHANOL)
        second = first.copy()
        second.positions += 0.3 * np.random.default_rng(1).standard_normal(second.positions.shape)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "two.xyz")
            write(path, [first, second], format="extxyz")
            multi = calculate.run_calculation(path, OFF_SMALL)
        single = calculate.run_calculation(ETHANOL, OFF_SMALL)
        self.assertAlmostEqual(multi["energy"], single["energy"], delta=1e-9)

    def test_d18_nvt_equilibrates_at_the_target_temperature(self):
        """
        ASE's Langevin(fixcm=True) ran a mixed-mass molecule ~39% hot (ethanol
        at a 300 K target equilibrated at 417 K). Seeded, so deterministic.
        """
        import calculate

        r = calculate.run_calculation(ETHANOL, {
            **OFF_SMALL, "calculationType": "molecular-dynamics", "mdSteps": 3000,
            "timeStep": 0.5, "temperature": 300, "friction": 0.02, "precision": "float32"})
        temps = r["trajectory"]["temperatures"]
        tail = temps[len(temps) // 4:]
        mean = sum(tail) / len(tail)
        self.assertEqual(r["params"]["temperatureDegreesOfFreedom"], 27)
        self.assertGreater(mean, 270)
        self.assertLess(mean, 330)

    def test_nve_reports_temperature_over_3n_minus_3(self):
        import calculate

        r = calculate.run_calculation(ETHANOL, {**OFF_SMALL, "calculationType": "molecular-dynamics",
                                                "mdEnsemble": "NVE", "mdSteps": 5})
        self.assertEqual(r["params"]["temperatureDegreesOfFreedom"], 24)

    def test_mpa0_is_the_default_and_its_checkpoint_matches_the_pin(self):
        import calculate
        import contract

        r = calculate.run_calculation(SILICON, {})
        self.assertEqual(r["params"]["modelType"], "MACE-MPA-0")
        self.assertEqual(r["params"]["upstreamModel"], "medium-mpa-0")
        self.assertEqual(r["provenance"]["model"]["checkpoint"]["sha256"],
                         contract.find_model("MACE-MPA-0")["sizes"]["medium"]["sha256"])

    def test_mace_off_result_carries_the_licence_notice(self):
        import calculate

        r = calculate.run_calculation(ETHANOL, OFF_SMALL)
        self.assertIn("Academic Software License", r["licenseNotice"])
        self.assertNotIn("Academic Software License", " ".join(r.get("warnings", [])))


if __name__ == "__main__":
    unittest.main()


class TestDeviceFallback(unittest.TestCase):
    """
    ADR-0031 (D33): a local run that asks for CUDA on a machine without it runs
    on CPU and says so in the result, end to end through the real engine.
    """

    def test_cuda_request_without_cuda_is_recorded_and_warned(self):
        import torch
        if torch.cuda.is_available():
            self.skipTest("a CUDA device is present, so there is nothing to fall back from")
        from calculate import run_calculation
        result = run_calculation(ETHANOL, {"calculationType": "single-point", "modelType": "MACE-OFF",
                                           "modelSize": "small", "device": "cuda"}, profile="local")
        self.assertEqual(result["params"]["device"], "cpu")
        self.assertEqual(result["params"]["requestedDevice"], "cuda")
        self.assertTrue(any("CUDA was requested" in w for w in result.get("warnings", [])), result.get("warnings"))
        self.assertEqual(result["provenance"]["runtime"]["device"], "cpu")
