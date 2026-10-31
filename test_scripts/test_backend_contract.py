"""
Contract, checkpoint-trust and refusal tests for the backend — no models needed.

Every test here is a refusal or a bound that used to be missing. Each one is
something that reviewed as fine and did the wrong thing at runtime, so each is
checked by execution: through contract.py, through the real torch.load guard,
or through calculate_local.py as a subprocess (the path the Next.js route uses).

    python3 -m unittest discover -s test_scripts -p "test_backend_contract.py"
"""

import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
API_DIR = REPO_ROOT / "mace-api"
sys.path.insert(0, str(API_DIR))

import contract  # noqa: E402
from contract import ContractError  # noqa: E402

ETHANOL = REPO_ROOT / "public" / "demo" / "ethanol.xyz"


class TestRegistry(unittest.TestCase):
    def test_default_model_is_mpa0(self):
        """Upstream's mace_mp() default since v0.3.10; MIT-licensed."""
        model = contract.resolve_model(None, has_model_path=False)
        self.assertEqual(model["id"], "MACE-MPA-0")
        self.assertEqual(model["license"]["id"], "MIT")
        self.assertEqual(contract.upstream_model_key(model, "medium"), "medium-mpa-0")

    def test_mace_off_alias_resolves_to_canonical_id(self):
        self.assertEqual(contract.resolve_model("MACE-OFF23", False)["id"], "MACE-OFF")

    def test_mace_off_carries_its_asl_notice(self):
        notice = contract.find_model("MACE-OFF")["license"]["notice"]
        self.assertIn("Academic Software License", notice)

    def test_every_foundation_size_has_a_sha256_pin(self):
        for model in contract.models():
            for size, spec in model["sizes"].items():
                self.assertRegex(spec["sha256"], r"^[0-9a-f]{64}$", f"{model['id']} {size}")

    def test_unknown_model_is_refused(self):
        with self.assertRaises(ContractError) as ctx:
            contract.resolve_model("MACE-MP", False)
        self.assertEqual(ctx.exception.code, "unsupported_model")


class TestRefusals(unittest.TestCase):
    def test_model_size_is_an_allow_list_not_a_url(self):
        """Upstream treats an unknown size as a URL or path and unpickles it (S3b)."""
        model = contract.find_model("MACE-MP-0")
        for bad in ("https://example.invalid/x.model", "/etc/passwd", "../evil.model", "xl"):
            with self.subTest(bad=bad), self.assertRaises(ContractError) as ctx:
                contract.resolve_model_size(model, bad)
            self.assertEqual(ctx.exception.code, "unsupported_model_size")

    def test_string_false_is_false_not_true(self):
        """bool("false") is True — it used to switch D3 dispersion on."""
        self.assertFalse(contract.resolve_bool("false", "dispersion"))
        self.assertTrue(contract.resolve_bool(True, "dispersion"))
        with self.assertRaises(ContractError):
            contract.resolve_bool("yes", "dispersion")

    def test_numbers_must_be_finite_and_in_range(self):
        for value in ("NaN", float("inf"), True, 10**9, -1, "abc"):
            with self.subTest(value=value), self.assertRaises(ContractError):
                contract.resolve_number({"mdSteps": value}, "mdSteps")
        self.assertEqual(contract.resolve_number({}, "mdSteps"), 100)

    def test_hosted_caps_are_tighter_than_physical_bounds(self):
        contract.check_step_cap("mdSteps", 10000, "hosted")
        with self.assertRaises(ContractError) as ctx:
            contract.check_step_cap("mdSteps", 10001, "hosted")
        self.assertEqual(ctx.exception.status, 422)
        with self.assertRaises(ContractError):
            contract.check_atom_caps(1001, "molecular-dynamics", 10, "hosted")

    def test_custom_models_are_opt_in_on_every_profile(self):
        # D40: a local dev server is reachable from the LAN (next dev binds
        # 0.0.0.0 by default) and from any website the developer visits, so
        # unpickling an upload is opt-in locally too, not only on hosted.
        previous = os.environ.pop("ALLOW_CUSTOM_MODELS", None)
        try:
            self.assertFalse(contract.custom_models_allowed("hosted"))
            self.assertFalse(contract.custom_models_allowed("local"))
            os.environ["ALLOW_CUSTOM_MODELS"] = "1"
            self.assertTrue(contract.custom_models_allowed("hosted"))
            self.assertTrue(contract.custom_models_allowed("local"))
        finally:
            os.environ.pop("ALLOW_CUSTOM_MODELS", None)
            if previous is not None:
                os.environ["ALLOW_CUSTOM_MODELS"] = previous

    def test_trajectory_stride_keeps_large_runs_inside_budget(self):
        self.assertEqual(contract.trajectory_stride(9, 500, "hosted"), 1)
        stride = contract.trajectory_stride(1000, 10000, "hosted")
        frames = 10001 // stride + 1
        self.assertLessEqual(frames * 1000 * 3, contract.profile("hosted")["trajectoryFloatBudget"] * 1.05)


class TestCheckpointTrust(unittest.TestCase):
    """The torch.load guard, exercised against real files."""

    def setUp(self):
        try:
            import torch  # noqa: F401
        except Exception as exc:  # noqa: BLE001
            self.skipTest(f"torch not importable: {exc}")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_untrusted_checkpoint_is_refused_before_it_is_unpickled(self):
        import torch
        import safe_load

        marker = pathlib.Path(self.tmp.name) / "PWNED"

        class Trap:
            def __reduce__(self):
                return (pathlib.Path.touch, (marker,))

        trap_path = pathlib.Path(self.tmp.name) / "MACE-OFF23_small.model"
        torch.save(Trap(), trap_path)
        with safe_load.trusted_checkpoints(contract.allowed_checkpoint_sha256()):
            with self.assertRaises(safe_load.UntrustedCheckpointError):
                torch.load(trap_path, map_location="cpu", weights_only=False)
        self.assertFalse(marker.exists(), "the pickle payload ran")

    def test_explicitly_trusted_path_loads(self):
        import torch
        import safe_load

        path = pathlib.Path(self.tmp.name) / "mine.model"
        torch.save({"ok": torch.zeros(2)}, path)
        with safe_load.trusted_checkpoints(frozenset(), trusted_paths=(str(path),)):
            self.assertIn("ok", torch.load(path, map_location="cpu"))

    def test_plain_tensor_files_still_load_with_weights_only(self):
        """e3nn's constants.pt goes through the guard during model construction."""
        import torch
        import safe_load

        path = pathlib.Path(self.tmp.name) / "constants.pt"
        torch.save((torch.ones(3), torch.zeros(2)), path)
        with safe_load.trusted_checkpoints(frozenset()):
            a, _ = torch.load(path)
        self.assertEqual(float(a.sum()), 3.0)

    def test_guard_restores_torch_load(self):
        import torch
        import safe_load

        before = torch.load
        with safe_load.trusted_checkpoints(frozenset()):
            self.assertIsNot(torch.load, before)
        self.assertIs(torch.load, before)


class TestCliGuards(unittest.TestCase):
    """
    Refusals through calculate_local.py — the exact path the Next.js route
    spawns. Each must come back as status "error" with a 4xx code and must not
    load a model (they return in well under a second).
    """

    def run_cli(self, params, *extra, env=None):
        proc = subprocess.run(
            [sys.executable, str(API_DIR / "calculate_local.py"), str(ETHANOL),
             json.dumps(params), *extra],
            capture_output=True, text=True, timeout=120,
            env={**os.environ, "KMP_DUPLICATE_LIB_OK": "TRUE", **(env or {})},
        )
        return json.loads(proc.stdout)

    def assertRefused(self, params, code, *extra, env=None):
        out = self.run_cli(params, *extra, env=env)
        self.assertEqual(out["status"], "error", out)
        self.assertEqual(out["error"]["code"], code, out["message"])
        self.assertGreaterEqual(out["error"]["status"], 400)
        self.assertLess(out["error"]["status"], 500)

    def test_guards(self):
        cases = [
            ({"calculationType": "phonon"}, "unsupported_calculation"),
            ({"modelType": "custom"}, "custom_model_missing"),
            ({"modelType": "MACE-MP"}, "unsupported_model"),
            ({"modelType": "MACE-MP-0", "modelSize": "https://example.invalid/x.model"},
             "unsupported_model_size"),
            ({"calculationType": "molecular-dynamics", "mdEnsemble": "NPH"},
             "unsupported_mdEnsemble"),
            ({"calculationType": "molecular-dynamics", "mdEnsemble": "NPT"},
             "npt_requires_periodic"),
            ({"calculationType": "molecular-dynamics", "timeStep": "NaN"}, "invalid_number"),
            ({"dispersion": "yes"}, "invalid_boolean"),
        ]
        for params, code in cases:
            with self.subTest(params=params):
                self.assertRefused(params, code)

    def test_custom_model_refused_when_disabled(self):
        self.assertRefused({}, "custom_models_disabled", "--model-path", "/nonexistent.model",
                           env={"ALLOW_CUSTOM_MODELS": "0"})

    def test_hosted_profile_caps_md_steps(self):
        self.assertRefused({"calculationType": "molecular-dynamics", "mdSteps": 20000},
                           "limit_exceeded", env={"SIMPLEATOM_PROFILE": "hosted"})


class TestSharedFixtures(unittest.TestCase):
    """
    test/fixtures/contract-requests.json is checked here against
    calculate.validate_request() and in test/contract.test.ts against the
    TypeScript mirror. Both must give the same outcome for every case.
    """

    def test_every_fixture(self):
        import calculate

        data = json.loads((REPO_ROOT / "test" / "fixtures" / "contract-requests.json").read_text())
        previous = os.environ.pop("ALLOW_CUSTOM_MODELS", None)
        try:
            for case in data["cases"]:
                with self.subTest(case["name"]):
                    try:
                        calculate.validate_request(dict(case["params"]),
                                                   case.get("hasModelFile", False), case["profile"])
                        outcome = "ok"
                    except ContractError as exc:
                        outcome = exc.code
                    self.assertEqual(outcome, case["expect"])
        finally:
            if previous is not None:
                os.environ["ALLOW_CUSTOM_MODELS"] = previous


class TestFrameRecorder(unittest.TestCase):
    def test_stride_keeps_arrays_aligned_and_always_records_the_end(self):
        import numpy as np
        import calculate

        rec = calculate._FrameRecorder(3, ("energies",))
        for step in range(8):
            rec.offer(step, np.zeros((2, 3)), energies=float(step))
        rec.finish(7, np.zeros((2, 3)), energies=7.0)
        self.assertEqual(rec.step, [0, 3, 6, 7])
        self.assertEqual(rec.series["energies"], [0.0, 3.0, 6.0, 7.0])
        self.assertEqual(len(rec.positions), 4)


if __name__ == "__main__":
    unittest.main()
