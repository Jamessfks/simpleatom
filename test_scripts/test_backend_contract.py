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
import time
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
API_DIR = REPO_ROOT / "mace-api"
sys.path.insert(0, str(API_DIR))

import contract  # noqa: E402
from contract import ContractError  # noqa: E402

ETHANOL = REPO_ROOT / "test" / "fixtures" / "ethanol-golden.xyz"   # strained, pre-D119 demo
ETHANOL_DEMO = REPO_ROOT / "public" / "demo" / "ethanol.xyz"


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

    def test_a_cache_link_to_a_file_outside_the_cache_is_refused_as_untrusted(self):
        """D141: the link's own location decides, not only where it points."""
        import torch
        import safe_load

        cache = pathlib.Path(self.tmp.name) / "cache"
        cache.mkdir()
        outside = pathlib.Path(self.tmp.name) / "elsewhere.bin"
        torch.save({"weights": torch.zeros(2)}, outside)
        link = cache / "2023-12-03-mace-128-L1_epoch-199"
        link.symlink_to(outside)
        with mock.patch.object(safe_load.provenance, "mace_cache_dir", return_value=str(cache)):
            with safe_load.trusted_checkpoints(contract.allowed_checkpoint_sha256()):
                with self.assertRaises(safe_load.UntrustedCheckpointError):
                    torch.load(link, map_location="cpu")

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

    def run_cli(self, params, *extra, env=None, structure=ETHANOL):
        proc = subprocess.run(
            [sys.executable, str(API_DIR / "calculate_local.py"), str(structure),
             json.dumps(params), *extra],
            capture_output=True, text=True, timeout=120,
            env={**os.environ, "KMP_DUPLICATE_LIB_OK": "TRUE", **(env or {})},
        )
        return json.loads(proc.stdout)

    def assertRefused(self, params, code, *extra, env=None, structure=ETHANOL):
        out = self.run_cli(params, *extra, env=env, structure=structure)
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

    def test_element_refusal_happens_before_any_model_is_built(self):
        # D127: the CLI test above checks the code, but would still pass if the
        # check moved after loading. Building a calculator here fails the test.
        import calculate
        with tempfile.NamedTemporaryFile("w", suffix=".xyz", delete=False) as handle:
            handle.write("2\nNaCl\nNa 0 0 0\nCl 2.36 0 0\n")
        self.addCleanup(os.unlink, handle.name)
        boom = AssertionError("a model was built before the element check")
        with mock.patch.object(calculate, "get_mace_calculator", side_effect=boom), \
             mock.patch.object(calculate, "get_custom_calculator", side_effect=boom):
            with self.assertRaises(ContractError) as ctx:
                calculate.run_calculation(handle.name, {"modelType": "MACE-OFF", "modelSize": "small"},
                                          profile="local")
        self.assertEqual(ctx.exception.code, "unsupported_element")

    def test_the_mp_family_refuses_elements_outside_its_table_before_loading(self):
        # D135: MPA-0 and MP-0 cover Z 1-94 except Po, At, Rn, Fr and Ra; the
        # registry said null, so radon failed only after the model loaded.
        import calculate
        with tempfile.NamedTemporaryFile("w", suffix=".xyz", delete=False) as handle:
            handle.write("2\nRnH\nRn 0 0 0\nH 1.8 0 0\n")
        self.addCleanup(os.unlink, handle.name)
        boom = AssertionError("a model was built before the element check")
        for model, size in (("MACE-MPA-0", "medium"), ("MACE-MP-0", "small")):
            with self.subTest(model=model), \
                 mock.patch.object(calculate, "get_mace_calculator", side_effect=boom):
                with self.assertRaises(ContractError) as ctx:
                    calculate.run_calculation(handle.name, {"modelType": model, "modelSize": size},
                                              profile="local")
                self.assertEqual(ctx.exception.code, "unsupported_element")
                self.assertIn("Rn", str(ctx.exception))

    def test_mace_off_refuses_elements_outside_its_training_set(self):
        # D47: the registry lists MACE-OFF's ten elements, and nothing enforced
        # them: NaCl failed only after the model loaded, with
        # "np.int64(11) is not in list".
        with tempfile.NamedTemporaryFile("w", suffix=".xyz", delete=False) as handle:
            handle.write("2\nNaCl\nNa 0 0 0\nCl 2.36 0 0\n")
        self.addCleanup(os.unlink, handle.name)
        out = self.run_cli({"modelType": "MACE-OFF", "modelSize": "small"}, structure=handle.name)
        self.assertEqual(out["status"], "error", out)
        self.assertEqual((out["error"]["code"], out["error"]["field"]), ("unsupported_element", "modelType"))
        self.assertIn("Na", out["error"]["message"])
        self.assertNotIn("np.int64", out["error"]["message"])

    def test_hosted_profile_refuses_cuda(self):
        self.assertRefused({"device": "cuda"}, "device_unavailable",
                           env={"SIMPLEATOM_PROFILE": "hosted"})


class TestHugeNumbers(unittest.TestCase):
    """D138: a numeric parameter far beyond any cap is a 400, never a 500 — even past
    Python's 4300-digit limit for printing an int in the refusal message."""

    def test_huge_integers_are_refused_with_a_code(self):
        import calculate
        for field, extra in (("mdSteps", {"calculationType": "molecular-dynamics"}),
                             ("maxOptSteps", {"calculationType": "geometry-opt"}),
                             ("temperature", {"calculationType": "molecular-dynamics"}),
                             ("seed", {})):
            for value in (10 ** 400, 10 ** 5000):
                with self.subTest(field=field, digits=len(str(value)) if value < 10 ** 4000 else "5000+"):
                    with self.assertRaises(ContractError) as ctx:
                        calculate.validate_request({**extra, field: value}, False, "local")
                    self.assertIn(ctx.exception.code, ("invalid_number", "out_of_range"))
                    self.assertEqual(ctx.exception.status, 400)


class TestSeed(unittest.TestCase):
    """D48: a seed is a finite whole number in range, never coerced; infinity was a 500."""

    def test_non_finite_and_fractional_seeds_are_refused(self):
        import calculate
        for raw in (float("inf"), float("nan"), 3.7, "3.7", True):
            with self.subTest(raw=raw):
                with self.assertRaises(ContractError) as ctx:
                    calculate.resolve_seed(raw)
                self.assertEqual(ctx.exception.code, "invalid_number")
                self.assertEqual(ctx.exception.status, 400)

    def test_whole_seeds_pass_through(self):
        import calculate
        self.assertEqual(calculate.resolve_seed(None), 42)
        self.assertEqual(calculate.resolve_seed(7), 7)
        self.assertEqual(calculate.resolve_seed("7"), 7)
        self.assertEqual(calculate.resolve_seed(7.0), 7)


class TestDevice(unittest.TestCase):
    """
    ADR-0031 (D33-D35): the device asked for and the device used never differ
    silently. The public profile refuses CUDA; a local run falls back to CPU
    with a warning; only devices that work are reported; CUDA out-of-memory is
    a coded refusal, never a silent retry.
    """

    def setUp(self):
        import calculate
        self.calculate = calculate

    def test_hosted_refuses_cuda_before_any_work(self):
        with self.assertRaises(ContractError) as ctx:
            self.calculate.validate_request({"device": "cuda"}, False, "hosted")
        e = ctx.exception
        self.assertEqual((e.code, e.status, e.field), ("device_unavailable", 400, "device"))

    def test_local_falls_back_to_cpu_with_a_warning(self):
        with mock.patch("torch.cuda.is_available", return_value=False):
            device, warning = self.calculate.resolve_device("cuda", "local")
        self.assertEqual(device, "cpu")
        self.assertIn("CUDA was requested", warning)
        self.assertIn("ran on CPU", warning)

    def test_cpu_needs_no_warning(self):
        self.assertEqual(self.calculate.resolve_device("cpu", "hosted"), ("cpu", None))
        self.assertEqual(self.calculate.resolve_device(None, "local"), ("cpu", None))

    def test_report_lists_only_usable_devices(self):
        with mock.patch("torch.cuda.is_available", return_value=False):
            local = self.calculate.device_report("local")
            hosted = self.calculate.device_report("hosted")
        self.assertEqual(local["available"], ["cpu"])
        self.assertFalse(local["cuda"]["available"])
        self.assertIn("torch.cuda.is_available()", local["unavailableReason"])
        self.assertEqual(hosted["available"], ["cpu"])
        self.assertIn("CPU-only", hosted["unavailableReason"])

        with mock.patch("torch.cuda.is_available", return_value=True), \
             mock.patch("torch.cuda.get_device_name", return_value="Test GPU"):
            local = self.calculate.device_report("local")
            hosted = self.calculate.device_report("hosted")
        self.assertEqual(local["available"], ["cpu", "cuda"])
        self.assertEqual(local["cuda"]["name"], "Test GPU")
        self.assertIsNone(local["unavailableReason"])
        self.assertEqual(hosted["available"], ["cpu"])  # never offered publicly

    def test_cuda_out_of_memory_is_a_coded_refusal(self):
        import torch
        oom = torch.OutOfMemoryError("CUDA out of memory. Tried to allocate 2.00 GiB")
        with mock.patch.object(self.calculate, "get_mace_calculator", side_effect=oom):
            with self.assertRaises(ContractError) as ctx:
                self.calculate.run_calculation(
                    str(ETHANOL), {"modelType": "MACE-OFF", "modelSize": "small"}, profile="local")
        self.assertEqual((ctx.exception.code, ctx.exception.status), ("cuda_out_of_memory", 507))
        self.assertIn("Nothing was computed", str(ctx.exception))


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


class TestCliOutputIsJson(unittest.TestCase):
    """D129 follow-up: the CLI's stdout is parsed by Node's JSON.parse, which rejects NaN."""

    def test_a_non_finite_number_is_never_printed(self):
        import io
        import calculate_local
        out = io.StringIO()
        with mock.patch.object(calculate_local, "_REAL_STDOUT", out):
            calculate_local.emit({"status": "success", "energy": float("nan")})

        def refuse(token):
            raise ValueError(f"{token} is not JSON")

        doc = json.loads(out.getvalue(), parse_constant=refuse)
        self.assertEqual(doc["status"], "error")
        self.assertEqual(doc["error"]["code"], "non_finite_result")


class TestClientIdentity(unittest.TestCase):
    """
    D43: per-visitor limits key on who the request is from. The visitor IP the
    Vercel proxy forwards is trusted only when MACE_API_TOKEN authenticated
    the proxy; otherwise any caller could name a fresh "visitor" per request.
    """

    @staticmethod
    def _request(xff=None, peer="10.0.0.1"):
        from starlette.requests import Request
        headers = [(b"x-forwarded-for", xff.encode())] if xff else []
        return Request({"type": "http", "method": "POST", "path": "/", "headers": headers,
                        "client": (peer, 4321)})

    def _with_token(self, value):
        previous = os.environ.pop("MACE_API_TOKEN", None)
        if value is not None:
            os.environ["MACE_API_TOKEN"] = value
        self.addCleanup(lambda: (os.environ.pop("MACE_API_TOKEN", None),
                                 previous is not None and os.environ.__setitem__("MACE_API_TOKEN", previous)))

    def test_forwarded_ip_is_ignored_without_a_proxy_key(self):
        import main
        self._with_token(None)
        key = main._client_key(self._request(xff="198.51.100.9, 10.0.0.2"), "203.0.113.7")
        self.assertEqual(key, "10.0.0.2")

    def test_forwarded_ip_is_trusted_from_the_authenticated_proxy(self):
        import main
        self._with_token("proxy-secret")
        key = main._client_key(self._request(xff="198.51.100.9, 10.0.0.2"), "203.0.113.7")
        self.assertEqual(key, "203.0.113.7")

    def test_spoofed_forwarded_for_entries_do_not_mint_new_visitors(self):
        import main
        self._with_token(None)
        a = main._client_key(self._request(xff="1.1.1.1, 10.0.0.2"), None)
        b = main._client_key(self._request(xff="2.2.2.2, 10.0.0.2"), None)
        self.assertEqual(a, b)
        self.assertEqual(main._client_key(self._request(), None), "10.0.0.1")


class TestGeometryOptStops(unittest.TestCase):
    """
    D46: convergence is judged from the final forces, whatever stopped BFGS. A
    time-budget stop on the step that reaches fmax (or before step 0, on an
    already relaxed structure) used to be labelled "DID NOT CONVERGE" with a
    max force below the target. ASE's own test is strict: max|F| < fmax.
    """

    @staticmethod
    def _run(atoms, deadline):
        import calculate
        from ase.calculators.emt import EMT
        atoms.calc = EMT()
        ctx = calculate._RunContext(atoms=atoms, filename="cu.xyz", calc_start=time.time(), ref_data={},
                                    effective_params={}, warnings=[], manifest=None,
                                    hooks=calculate.RunHooks(deadline=deadline), profile_name="local")
        return calculate._run_geometry_opt(ctx, {"forceThreshold": 0.05, "maxOptSteps": 50})

    def test_budget_stop_on_a_relaxed_structure_reports_convergence(self):
        from ase.build import bulk
        result = self._run(bulk("Cu", "fcc", a=3.6, cubic=True), deadline=time.monotonic() - 1)
        self.assertTrue(result["converged"], result["message"])
        self.assertNotIn("DID NOT CONVERGE", result["message"])
        self.assertIn("below the fmax target", result["message"])
        self.assertNotIn("at or below", result["message"])

    def test_budget_stop_above_fmax_is_not_converged(self):
        from ase.build import bulk
        atoms = bulk("Cu", "fcc", a=3.6, cubic=True)
        atoms.positions[0] += [0.15, 0.0, 0.0]
        result = self._run(atoms, deadline=time.monotonic() - 1)
        self.assertFalse(result["converged"])
        self.assertIn("DID NOT CONVERGE", result["message"])
        self.assertIn("time budget", result["message"])


class TestMdEffectiveParams(unittest.TestCase):
    """D55: only parameters that acted are echoed as effective; NVE and NPT have no friction."""

    @staticmethod
    def _md(ensemble):
        import calculate
        from ase.build import bulk
        from ase.calculators.emt import EMT
        atoms = bulk("Cu", "fcc", a=3.6, cubic=True)
        atoms.calc = EMT()
        ctx = calculate._RunContext(atoms=atoms, filename="cu.xyz", calc_start=time.time(), ref_data={},
                                    effective_params={}, warnings=[], manifest=None,
                                    hooks=calculate.RunHooks(), profile_name="local")
        run_params = {"temperature": 300.0, "timeStep": 1.0, "friction": 0.01, "mdSteps": 3,
                      "mdEnsemble": ensemble, "pressure": 0.0}
        return calculate._run_md(ctx, run_params, 42)["params"]

    def test_friction_is_reported_only_where_a_thermostat_used_it(self):
        self.assertEqual(self._md("NVT")["friction"], 0.01)
        self.assertNotIn("friction", self._md("NVE"))
        self.assertNotIn("friction", self._md("NPT"))


class TestResourceBounds(unittest.TestCase):
    """
    D44: refused requests leave no per-visitor entry, windows older than an
    hour are pruned, and the proxy key and the declared body size are checked
    before the multipart body is parsed and spooled.
    """

    def test_refused_submissions_leave_no_trace(self):
        import jobs
        store = jobs.JobStore(max_queued=0)  # every submission is refused as busy
        for i in range(300):
            with self.assertRaises(ContractError):
                store.submit(f"198.51.{i // 256}.{i % 256}", lambda job: {"status": "success"})
        self.assertEqual(len(store._submissions), 0)

    def test_expired_windows_are_pruned(self):
        import jobs
        from collections import deque
        store = jobs.JobStore(per_client_hourly=1000, max_queued=1000)
        store._submissions["203.0.113.9"] = deque([time.time() - 3601])
        store.submit("203.0.113.10", lambda job: {"status": "success"})
        self.assertNotIn("203.0.113.9", store._submissions)

    @staticmethod
    def _post(headers, env):
        """POST a malformed multipart body straight into the ASGI app (no HTTP client
        dependency): a pre-parse check answers 401/413, the old path answered 422."""
        import asyncio
        import importlib
        body = b"not a multipart body"
        headers = {"content-type": "multipart/form-data; boundary=x",
                   "content-length": str(len(body)), **headers}
        with mock.patch.dict(os.environ, env):
            import main
            app = importlib.reload(main).app
        scope = {"type": "http", "method": "POST", "path": "/v1/jobs", "raw_path": b"/v1/jobs",
                 "query_string": b"", "root_path": "", "scheme": "http", "http_version": "1.1",
                 "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
                 "client": ("198.51.100.7", 4321), "server": ("testserver", 80)}
        sent, messages = [False], []

        async def receive():
            if not sent[0]:
                sent[0] = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)

        with mock.patch.dict(os.environ, env):
            asyncio.run(app(scope, receive, send))
        status = next(m["status"] for m in messages if m["type"] == "http.response.start")
        payload = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
        return status, json.loads(payload or b"{}")

    def test_proxy_key_is_checked_before_the_body_is_parsed(self):
        status, payload = self._post({}, {"SIMPLEATOM_PROFILE": "hosted", "MACE_API_TOKEN": "proxy-secret"})
        self.assertEqual(status, 401, payload)
        self.assertEqual(payload["error"]["code"], "proxy_key_required")

    def test_declared_oversize_body_is_refused_before_it_is_read(self):
        status, payload = self._post({"content-length": str(40_000_000)}, {"SIMPLEATOM_PROFILE": "hosted"})
        self.assertEqual(status, 413, payload)
        self.assertEqual(payload["error"]["code"], "upload_too_large")


class TestHostileParamsJson(unittest.TestCase):
    """D138: a 4301-digit integer literal (ValueError) or deep nesting (RecursionError) in
    params gave a plain-text 500, even in a field nothing reads."""

    HOSTILE = {"huge integer": '{"seed": ' + "9" * 5000 + "}",
               # 20,000 levels is far past the decoder's recursion limit and, at 40 KB, inside
               # Linux's 128 KB limit on one command-line argument (the CLI case).
               "deep nesting": '{"x": ' + "[" * 20_000 + "]" * 20_000 + "}"}

    def _post(self, params):
        import asyncio
        import main
        body = (b"--x\r\nContent-Disposition: form-data; name=\"files\"; filename=\"w.xyz\"\r\n\r\n"
                b"1\n\nH 0 0 0\n\r\n--x\r\nContent-Disposition: form-data; name=\"params\"\r\n\r\n"
                + params.encode() + b"\r\n--x--\r\n")
        scope = {"type": "http", "method": "POST", "path": "/calculate", "raw_path": b"/calculate",
                 "query_string": b"", "root_path": "", "scheme": "http", "http_version": "1.1",
                 "headers": [(b"content-type", b"multipart/form-data; boundary=x"),
                             (b"content-length", str(len(body)).encode())],
                 "client": ("198.51.100.43", 4321), "server": ("testserver", 80)}
        sent, messages = [False], []

        async def receive():
            if not sent[0]:
                sent[0] = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)

        with mock.patch.dict(os.environ, {"MACE_API_TOKEN": ""}):
            asyncio.run(main.app(scope, receive, send))
        status = next(m["status"] for m in messages if m["type"] == "http.response.start")
        return status, json.loads(b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body"))

    def test_the_api_refuses_them_as_invalid_params(self):
        for name, params in self.HOSTILE.items():
            with self.subTest(name):
                status, payload = self._post(params)
                self.assertEqual(status, 400, payload)
                self.assertEqual(payload["error"]["code"], "invalid_params")

    def test_the_cli_refuses_them_as_invalid_params(self):
        for name, params in self.HOSTILE.items():
            with self.subTest(name):
                run = subprocess.run([sys.executable, str(API_DIR / "calculate_local.py"), str(ETHANOL), params],
                                     capture_output=True, text=True, timeout=120,
                                     env={**os.environ, "KMP_DUPLICATE_LIB_OK": "TRUE"})
                doc = json.loads(run.stdout.strip().splitlines()[-1])
                self.assertEqual(doc["error"]["code"], "invalid_params", run.stderr[-500:])


class TestChunkedUploadCap(unittest.TestCase):
    """D142: a body sent without Content-Length (chunked) was received in full before its 413."""

    def test_an_undeclared_body_is_refused_once_it_passes_the_cap(self):
        import asyncio
        import importlib
        with mock.patch.dict(os.environ, {"SIMPLEATOM_PROFILE": "hosted", "MACE_API_TOKEN": ""}):
            import main
            main = importlib.reload(main)
        cap = main.LIMITS["maxUploadBytes"] + main.LIMITS["maxModelUploadBytes"] + (1 << 20)
        chunk = 1 << 20
        head = (b"--x\r\nContent-Disposition: form-data; name=\"files\"; filename=\"big.xyz\"\r\n"
                b"Content-Type: text/plain\r\n\r\n")
        scope = {"type": "http", "method": "POST", "path": "/calculate", "raw_path": b"/calculate",
                 "query_string": b"", "root_path": "", "scheme": "http", "http_version": "1.1",
                 "headers": [(b"content-type", b"multipart/form-data; boundary=x"),
                             (b"transfer-encoding", b"chunked")],
                 "client": ("198.51.100.42", 4321), "server": ("testserver", 80)}
        reads, messages = [0], []
        limit = cap // chunk + 40   # never ends on its own: an unbounded upload

        async def receive():
            reads[0] += 1
            if reads[0] > limit:
                return {"type": "http.disconnect"}
            return {"type": "http.request", "body": head if reads[0] == 1 else b"x" * chunk, "more_body": True}

        async def send(message):
            messages.append(message)

        with mock.patch.dict(os.environ, {"SIMPLEATOM_PROFILE": "hosted", "MACE_API_TOKEN": ""}):
            asyncio.run(main.app(scope, receive, send))
        status = next(m["status"] for m in messages if m["type"] == "http.response.start")
        payload = json.loads(b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body"))
        self.assertEqual(status, 413, payload)
        self.assertEqual(payload["error"]["code"], "upload_too_large")
        self.assertLessEqual(reads[0], cap // chunk + 3, "the body was read past the cap before refusing")


class TestDeployWorkflow(unittest.TestCase):
    """D50: the Space deploy runs only from main, and every action it uses is pinned by SHA."""

    def setUp(self):
        self.text = (REPO_ROOT / ".github" / "workflows" / "deploy-hf-space.yml").read_text()

    def test_manual_dispatch_cannot_deploy_another_branch(self):
        if "workflow_dispatch" in self.text:
            self.assertIn("github.ref != 'refs/heads/main'", self.text)

    def test_actions_are_pinned_to_a_commit(self):
        import re
        uses = re.findall(r"uses:\s*(\S+)", self.text)
        self.assertTrue(uses)
        for ref in uses:
            self.assertRegex(ref, r"@[0-9a-f]{40}$", ref)


class TestWorkflowScripts(unittest.TestCase):
    """D144: an expression interpolated into a run: script is a script-injection path."""

    def test_no_run_script_interpolates_an_expression(self):
        import yaml
        for name in ("ci.yml", "deploy-hf-space.yml"):
            flow = yaml.safe_load((REPO_ROOT / ".github" / "workflows" / name).read_text())
            for job_id, job in flow["jobs"].items():
                for step in job.get("steps", []):
                    with self.subTest(workflow=name, job=job_id, step=step.get("name")):
                        self.assertNotIn("${{", step.get("run", ""),
                                         "pass it through env: or use the default GITHUB_* variable")


class TestDeployStaging(unittest.TestCase):
    """D88 (F12): the staged Space is the commit that GIT_COMMIT names, nothing else."""

    SCRIPT = REPO_ROOT / "scripts" / "stage-hf-space.sh"

    def _repo(self, files):
        root = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(lambda: subprocess.run(["rm", "-rf", str(root)]))
        (root / "scripts").mkdir()
        (root / "scripts" / "stage-hf-space.sh").write_bytes(self.SCRIPT.read_bytes())
        (root / "test_scripts").mkdir()
        (root / "test_scripts" / "validate_calculation.py").write_text("# validator\n")
        for rel, text in files.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(text)
        git = ["git", "-C", str(root), "-c", "user.name=t", "-c", "user.email=t@example.invalid"]
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        subprocess.run([*git, "add", "-A"], check=True)
        subprocess.run([*git, "commit", "-q", "-m", "c"], check=True)
        head = subprocess.run([*git, "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
        return root, head

    def _stage(self, root, *args):
        dest = root.parent / (root.name + "-stage")
        self.addCleanup(lambda: subprocess.run(["rm", "-rf", str(dest)]))
        run = subprocess.run(["bash", "scripts/stage-hf-space.sh", str(dest), *args],
                             cwd=root, capture_output=True, text=True)
        return run, dest

    def test_a_clean_tree_stages_the_commit_and_names_it(self):
        root, head = self._repo({"mace-api/calculate.py": "committed\n", "mace-api/test_x.py": "t\n"})
        run, dest = self._stage(root)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual((dest / "calculate.py").read_text(), "committed\n")
        self.assertEqual((dest / "GIT_COMMIT").read_text().strip(), head)
        self.assertFalse((dest / "test_x.py").exists(), "tests must not ship")

    def test_uncommitted_backend_edits_are_refused(self):
        root, _ = self._repo({"mace-api/calculate.py": "committed\n"})
        (root / "mace-api" / "calculate.py").write_text("edited, never committed\n")
        run, dest = self._stage(root)
        self.assertNotEqual(run.returncode, 0, "a dirty tree was staged under a clean commit's name")
        self.assertIn("uncommitted", run.stderr)

    def test_dirty_staging_is_labelled_dirty(self):
        root, head = self._repo({"mace-api/calculate.py": "committed\n"})
        (root / "mace-api" / "calculate.py").write_text("edited\n")
        run, dest = self._stage(root, "--dirty")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual((dest / "calculate.py").read_text(), "edited\n")
        self.assertEqual((dest / "GIT_COMMIT").read_text().strip(), head + "-dirty")

    def test_two_files_with_one_name_are_refused(self):
        root, _ = self._repo({"mace-api/calculate.py": "a\n", "mace-api/sub/calculate.py": "b\n"})
        run, _ = self._stage(root)
        self.assertNotEqual(run.returncode, 0, "the flat Space tree would silently keep one of them")
        self.assertIn("calculate.py", run.stderr)


class TestCiGates(unittest.TestCase):
    """D82, D83, D88 (F8, F9, F13, F14, F21): what CI checks before the Space is built."""

    @classmethod
    def setUpClass(cls):
        cls.ci = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text()
        cls.dockerfile = (API_DIR / "Dockerfile").read_text()
        cls.lock = (API_DIR / "requirements.lock.txt").read_text()

    def _job(self, name):
        import re
        match = re.search(rf"(?ms)^  {re.escape(name)}:\n(.*?)(?=^  [\w-]+:\n|\Z)", self.ci)
        self.assertIsNotNone(match, f"no {name} job in ci.yml")
        return match.group(1)

    def test_the_deploy_waits_for_every_other_job(self):
        import re
        jobs = set(re.findall(r"(?m)^  ([\w-]+):\n", self.ci.split("\njobs:\n", 1)[1]))
        needs = re.search(r"needs:\s*\[([^\]]*)\]", self._job("deploy-hf")).group(1)
        self.assertEqual({n.strip() for n in needs.split(",")}, jobs - {"deploy-hf"})

    def test_the_lock_header_regenerates_the_index_lines(self):
        header = "\n".join(line for line in self.lock.splitlines() if line.startswith("#"))
        self.assertIn("--emit-index-url", header)
        self.assertIn("--extra-index-url https://download.pytorch.org/whl/cpu", header)
        self.assertIn("\n--extra-index-url https://download.pytorch.org/whl/cpu\n", self.lock)

    def test_ci_regenerates_the_lock_and_diffs_it(self):
        job = self._job("python-unit")
        self.assertIn("uv pip compile mace-api/requirements.in", job)
        self.assertIn("--emit-index-url", job)
        self.assertIn("git diff --exit-code mace-api/requirements.lock.txt", job)

    def test_the_checkpoint_cache_is_keyed_on_the_pins_alone(self):
        job = self._job("python-models")
        self.assertNotIn("hashFiles('mace-api/contract.json')", job,
                         "every limit or version edit to contract.json throws the cache away")
        self.assertIn("sha256", job)

    def test_the_image_installs_only_hashed_files(self):
        import re
        self.assertRegex(self.dockerfile, r"(?m)^FROM python:3\.11-slim@sha256:[0-9a-f]{64}\b",
                         "the base image must be pinned by digest")
        self.assertNotIn("--upgrade pip", self.dockerfile, "an unpinned pip ran before the hashed install")
        self.assertIn("--only-binary=:all:", self.dockerfile, "a new sdist would be built unnoticed")
        self.assertIn("--no-build-isolation", self.dockerfile,
                      "build isolation fetches setuptools unhashed for the two locked sdists")
        build = (API_DIR / "build-requirements.lock.txt").read_text()
        self.assertRegex(build, r"(?m)^setuptools==\S+ \\\n\s+--hash=sha256:[0-9a-f]{64}")
        sdists = re.search(r"--no-binary=(\S+)", self.dockerfile).group(1).split(",")
        self.assertEqual(sorted(sdists), ["bibtexparser", "python-hostlist"])

    def test_the_smoke_runs_the_default_model_from_the_baked_checkpoints(self):
        job = self._job("docker-smoke")
        self.assertIn("--network none", job, "a checkpoint fetched at run time would hide a missing bake")
        self.assertIn("MACE-MPA-0", job)
        self.assertIn("golden_energies.json", job)
        self.assertIn("provenance", job)
        self.assertIn("GITHUB_SHA", job.split("provenance", 1)[1],
                      "the manifest commit must be the commit under test, not just truthy")


class TestHardwareClaims(unittest.TestCase):
    """D104: every place that names the hosted hardware names the same hardware."""

    def test_the_hosted_cpu_count_is_stated_once_and_agrees(self):
        import calculate
        claims = {
            "contract.json hosted description": contract.profile("hosted")["description"],
            "calculate.device_report": calculate.device_report("hosted")["unavailableReason"],
            "lib/contract.ts": (REPO_ROOT / "lib" / "contract.ts").read_text(),
        }
        for where, text in claims.items():
            self.assertIn("2 shared vCPUs", text, where)
            self.assertNotIn("one shared CPU", text, where)


class TestHourlyCap(unittest.TestCase):
    """
    D42: every (model, structure) pair of a benchmark is one admission, and the
    hosted 30-per-hour cap was smaller than one allowed benchmark (30 x 200,
    then 429). The cap now lives in the contract and admits the largest one.
    """

    MAX_BENCHMARK_MODELS = 3  # app/api/benchmark/route.ts accepts 2-3 models

    def test_hourly_cap_admits_the_largest_allowed_benchmark(self):
        for name in ("hosted", "local"):
            p = contract.profile(name)
            largest = self.MAX_BENCHMARK_MODELS * (p["maxBenchmarkStructures"] + p["maxBenchmarkUploads"])
            self.assertGreaterEqual(p["maxCalculationsPerHour"], largest, name)

    def test_job_store_enforces_the_contract_cap(self):
        import main
        self.assertEqual(main.JOBS.per_client_hourly, main.LIMITS["maxCalculationsPerHour"])


class TestSyncLifecycle(unittest.TestCase):
    """
    D45: a cancel requested while a step-less phase runs is honoured (the job
    used to finish "succeeded"); the synchronous wait counts run time from the
    job's start, not queue time; and a caller who disconnects cancels the job
    instead of holding the single worker.
    """

    def test_cancel_during_a_stepless_run_ends_cancelled(self):
        import jobs
        store = jobs.JobStore()
        started = __import__("threading").Event()

        def run(job):
            started.set()
            job.cancel_requested.wait(5)   # a phase with no step hook to stop it
            return {"status": "success"}

        job = store.submit("203.0.113.20", run)
        self.assertTrue(started.wait(5))
        store.cancel(job.id)
        self.assertTrue(job.done.wait(5))
        self.assertEqual(job.status, "cancelled")
        self.assertIsNone(job.result)

    def test_queue_time_is_not_run_time(self):
        import main
        from types import SimpleNamespace
        import threading
        queued = SimpleNamespace(done=threading.Event(), started=None)
        self.assertEqual(main._await_job(queued, run_budget=60, queue_budget=0.2, poll=0.05), "queue_timeout")
        running = SimpleNamespace(done=threading.Event(), started=time.time() - 0.5)
        self.assertEqual(main._await_job(running, run_budget=0.2, queue_budget=60, poll=0.05), "run_timeout")
        finished = SimpleNamespace(done=threading.Event(), started=time.time())
        finished.done.set()
        self.assertEqual(main._await_job(finished, run_budget=60, queue_budget=60, poll=0.05), "done")

    def test_a_disconnected_caller_cancels_its_job(self):
        import asyncio
        import threading
        import main
        seen = {}

        def run(job):
            seen["job"] = job
            job.cancel_requested.wait(10)
            return {"status": "success"}

        async def fake_intake(files, params, model):
            return run, None

        boundary = "sa-boundary"
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"h.xyz\"\r\n"
                f"Content-Type: text/plain\r\n\r\n1\n\nH 0 0 0\n\r\n"
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"params\"\r\n\r\n{{}}\r\n"
                f"--{boundary}--\r\n").encode()
        scope = {"type": "http", "method": "POST", "path": "/calculate", "raw_path": b"/calculate",
                 "query_string": b"", "root_path": "", "scheme": "http", "http_version": "1.1",
                 "headers": [(b"content-type", f"multipart/form-data; boundary={boundary}".encode()),
                             (b"content-length", str(len(body)).encode())],
                 "client": ("198.51.100.30", 4321), "server": ("testserver", 80)}
        state = {"sent": False}

        async def receive():
            if not state["sent"]:
                state["sent"] = True
                return {"type": "http.request", "body": body, "more_body": False}
            # The caller has gone. A real server queues this message at once;
            # Starlette's is_disconnected() reads it without waiting.
            return {"type": "http.disconnect"}

        async def send(message):
            pass

        with mock.patch.object(main, "_intake", fake_intake), \
             mock.patch.dict(os.environ, {"MACE_API_TOKEN": ""}):
            asyncio.run(asyncio.wait_for(main.app(scope, receive, send), 15))
        job = seen["job"]
        self.assertTrue(job.done.wait(5))
        self.assertEqual(job.status, "cancelled")


class TestValidatorSelfTest(unittest.TestCase):
    """
    D38: `validate_calculation.py --test` is "the scientific gate", but it called
    upstream mace_mp/mace_off directly, ran its geometry optimisation in float32,
    and hard-coded `passed: True` for two of its five checks. It now runs
    SimpleAtom's own engine and computes every verdict, so a broken engine fails it.
    """

    def test_a_broken_engine_fails_every_check(self):
        sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
        import calculate
        import validate_calculation
        broken = {"status": "error", "error": {"code": "broken", "message": "engine broken"}}
        with mock.patch.object(calculate, "run_calculation", return_value=broken):
            out = validate_calculation.run_verification_tests()
        self.assertFalse(out["all_passed"])
        self.assertTrue(out["tests"])
        self.assertTrue(all(not t["passed"] for t in out["tests"]), out["tests"])

    def test_no_check_passes_unconditionally(self):
        text = (REPO_ROOT / "test_scripts" / "validate_calculation.py").read_text()
        self.assertNotIn('"passed": True', text)


class TestDocumentedTestsExist(unittest.TestCase):
    """The upgrade gate in requirements.in named test_translation_invariance.py, which never existed."""

    def test_every_test_file_named_in_requirements_exists(self):
        import re
        text = (API_DIR / "requirements.in").read_text() + (API_DIR / "requirements.txt").read_text()
        named = re.findall(r"(test_scripts/test_\w+\.py)", text)
        self.assertTrue(named)
        for path in named:
            self.assertTrue((REPO_ROOT / path).exists(), path)


class TestLocalStack(unittest.TestCase):
    """
    Local mode runs whatever `python3` resolves to (on the audit machine:
    miniconda 3.13 with mace-torch 0.3.15, not the pinned 0.3.16). A run on a
    stack that drifts from requirements.in now says so in its result.
    """

    def test_drift_from_the_pins_is_named(self):
        import calculate_local
        pins = calculate_local.pinned_versions()
        self.assertEqual(pins["mace-torch"], "0.3.16")
        installed = {**pins, "mace-torch": "0.3.15", "torch": pins["torch"] + "+cpu", "numpy": None}
        self.assertEqual(calculate_local.stack_drift(installed, pins),
                         ["mace-torch 0.3.15 (pinned 0.3.16)", f"numpy not installed (pinned {pins['numpy']})"])

    def test_the_pinned_stack_has_no_drift(self):
        import calculate_local
        pins = calculate_local.pinned_versions()
        self.assertEqual(calculate_local.stack_drift(dict(pins), pins), [])


class TestOneOverlapThreshold(unittest.TestCase):
    """D153: the engine refused below 0.5 Å while the preview and the validator said 0.4 Å."""

    def test_engine_and_validator_read_the_contract_value(self):
        import calculate
        sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
        import validate_calculation
        value = contract.load_contract()["structureChecks"]["minInteratomicDistanceA"]
        self.assertEqual(calculate.MIN_INTERATOMIC_DISTANCE_A, value)
        self.assertEqual(validate_calculation.MIN_INTERATOMIC_DIST, value)


class TestDemoEthanol(unittest.TestCase):
    """D119: the demo and hero ethanol is a relaxed trans geometry; the strained one is a fixture."""

    def test_the_demo_is_the_relaxed_trans_conformer(self):
        from ase.io import read
        demo = read(str(ETHANOL_DEMO))
        h = min(range(3, len(demo)), key=lambda i: demo.get_distance(2, i))
        self.assertAlmostEqual(demo.get_distance(0, 1), 1.512, delta=0.01, msg="C-C vs CCCBDB")
        self.assertAlmostEqual(abs(demo.get_dihedral(0, 1, 2, h) - 180.0), 0.0, delta=5.0, msg="C-C-O-H")
        self.assertIn("docs/v2/evidence/2026-11-01/demo-ethanol", ETHANOL_DEMO.read_text().splitlines()[1])

    def test_the_golden_input_is_never_edited(self):
        import hashlib
        self.assertEqual(hashlib.sha256(ETHANOL.read_bytes()).hexdigest(),
                         "d670288bc0fa424c5585bd5e2d0d5106029a26b6124d8ff3ccad6437be1413fc",
                         "the goldens were computed on this exact file; give a new input its own golden")


class TestFixturePeriodicity(unittest.TestCase):
    """D120: an extended-XYZ Lattice= with no pbc= is read as periodic by ASE."""

    def test_every_lattice_line_in_the_harness_states_its_pbc(self):
        import re
        for path in sorted((REPO_ROOT / "test_scripts").glob("*.py")):
            for line in path.read_text().splitlines():
                if re.match(r'\s*Lattice="', line):
                    with self.subTest(file=path.name, line=line.strip()):
                        self.assertIn("pbc=", line)


class TestHarnessDocFacts(unittest.TestCase):
    """
    D39: the harness docs carried stale facts — Matbench ranks 34/21 (36/22 of
    43 on 2026-10-28) and "calculate_local.py exits 0" on refusal (it exits 1).
    The ranks now have one source, app/v2/bars.ts; the docs must agree with it.
    """

    def setUp(self):
        import re
        bars = (REPO_ROOT / "app" / "v2" / "bars.ts").read_text()
        self.ranks = {m: int(r) for m, r in re.findall(r'"(MACE-MPA?-0)":\s*(\d+)', bars)}
        self.retrieved = re.search(r'retrieved:\s*"([\d-]+)"', bars).group(1)
        self.criteria = (REPO_ROOT / "docs" / "v2" / "SUCCESS-CRITERIA.md").read_text()

    def test_success_criteria_ranks_match_the_single_source(self):
        import re
        for model, rank in self.ranks.items():
            row = re.search(rf"\|\s*\**{re.escape(model)}\**[^|]*\|\s*(\d+)\s*\|", self.criteria)
            self.assertIsNotNone(row, model)
            self.assertEqual(int(row.group(1)), rank, model)
        self.assertIn(self.retrieved, self.criteria)

    def test_progress_board_does_not_repeat_stale_ranks(self):
        progress = (REPO_ROOT / "docs" / "v2" / "progress.json").read_text()
        self.assertNotIn("MACE-MP-0 ranks 34", progress)
        self.assertNotIn("offers it nowhere", progress)

    def test_no_doc_says_refusals_exit_zero(self):
        self.assertNotIn("exits 0 and reports refusal", self.criteria)


class TestUnitLabels(unittest.TestCase):
    """D56: the Units page listed stress in eV/Å³ while results report GPa; the CIF comment said 2.3517 Å."""

    def test_units_page_reports_stress_in_gpa(self):
        import re
        page = (REPO_ROOT / "app" / "docs" / "units" / "page.tsx").read_text()
        row = re.search(r"<td>Stress</td>\s*<td>([^<]+)</td>", page)
        self.assertIsNotNone(row)
        self.assertIn("GPa", row.group(1))

    def test_silicon_fixture_comment_states_the_right_neighbour_distance(self):
        text = (REPO_ROOT / "public" / "demo" / "silicon.cif").read_text()
        self.assertNotIn("2.3517", text)
        self.assertIn("2.3516", text)


class TestDailyGateCoverage(unittest.TestCase):
    """
    The daily gate is "every gate at once", but it ran neither vitest, the
    typecheck, the contract-sync check, the mace-api/ unit tests nor
    test_scripts/test_geometry_opt.py, so a red CI job could hide behind a
    green gate.
    """

    def test_every_ci_check_has_a_gate(self):
        sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
        import daily_gate
        frontend = {name for name, _cmd, _min in daily_gate.FRONTEND_CHECKS}
        self.assertTrue({"vitest", "typecheck", "contract-sync"} <= frontend, frontend)
        patterns = {args[0] for args in daily_gate.ci_suites()}
        self.assertIn("test_geometry_opt.py", patterns)
        self.assertIn('"test_*.py"', patterns)   # the mace-api/ unit tests, as CI runs them


class TestEverySuiteRuns(unittest.TestCase):
    """A suite that neither CI nor the daily gate runs protects nothing (D86's lesson, again)."""

    SUITES = sorted(p.name for p in (REPO_ROOT / "test_scripts").glob("test_*.py"))

    def test_ci_runs_every_suite(self):
        ci = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text()
        missing = [name for name in self.SUITES if name not in ci]
        self.assertEqual(missing, [], "test_scripts suites CI never runs")

    def test_the_daily_gate_runs_every_suite(self):
        sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
        import daily_gate
        gated = {args[0] for args in daily_gate.ci_suites()}
        self.assertEqual([name for name in self.SUITES if name not in gated], [],
                         "test_scripts suites the daily gate never runs")


class TestVerifyModelsExitCode(unittest.TestCase):
    """D150: `validate_calculation.py --verify-models` exited 0 whatever the verdict."""

    def test_a_failed_check_exits_one(self):
        sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
        import io
        import validate_calculation
        failed = {"all_passed": False, "tests": [{"test": "x", "passed": False}]}
        with mock.patch.object(validate_calculation, "run_verification_tests", return_value=failed), \
             mock.patch("sys.stdout", new=io.StringIO()):
            self.assertEqual(validate_calculation.cli(["--verify-models"]), 1)


class TestLintBaseline(unittest.TestCase):
    """D88 (F14): one total let a new lint error hide behind a fixed warning."""

    def setUp(self):
        sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
        import daily_gate
        self.gate = daily_gate

    def test_ci_and_the_gate_read_separate_error_and_warning_baselines(self):
        script = (REPO_ROOT / "scripts" / "lint-baseline.mjs").read_text()
        for name in ("LINT_ERROR_BASELINE", "LINT_WARNING_BASELINE"):
            self.assertIsInstance(getattr(self.gate, name, None), int, name)
            self.assertIn(name, script)

    def test_a_new_error_fails_even_when_a_warning_was_fixed(self):
        errors, warnings = self.gate.LINT_ERROR_BASELINE + 1, max(self.gate.LINT_WARNING_BASELINE - 1, 0)
        out = f"\u2716 {errors + warnings} problems ({errors} errors, {warnings} warnings)\n"
        done = subprocess.CompletedProcess([], 1, stdout=out, stderr="")
        with mock.patch.object(self.gate, "run", return_value=done):
            self.assertFalse(self.gate.gate_lint().ok)


class TestGeneratedHeaders(unittest.TestCase):
    """A generated file's header must come from its generator, or the next regeneration undoes it."""

    def test_the_mp_reference_header_is_what_the_generator_writes(self):
        sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
        import fetch_mp_reference
        data = (REPO_ROOT / "lib" / "mp-reference-data.ts").read_text()
        written = data[: data.index("*/") + 2]
        emitted = fetch_mp_reference.emit_fixture([], "test")
        self.assertEqual(emitted[: emitted.index("*/") + 2], written,
                         "lib/mp-reference-data.ts's header was edited by hand (D106, D121)")


class TestValidatorGateCanFail(unittest.TestCase):
    """
    D79: the validator printed all_passed: false, exited 0, and the daily gate
    reported PASS (it accepted exit 0 without the marker). The validator now
    exits 1 on failure and the gate judges the JSON verdict.
    """

    def test_gate_fails_on_a_false_verdict_even_with_exit_zero(self):
        sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
        import daily_gate
        fake = subprocess.CompletedProcess([], 0, stdout='{"all_passed": false, "tests": []}', stderr="")
        with mock.patch.object(daily_gate, "run", return_value=fake):
            self.assertFalse(daily_gate.gate_validator().ok)
        silent = subprocess.CompletedProcess([], 0, stdout="no json at all", stderr="")
        with mock.patch.object(daily_gate, "run", return_value=silent):
            self.assertFalse(daily_gate.gate_validator().ok)

    def test_validator_exits_nonzero_when_a_check_fails(self):
        sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
        import validate_calculation
        with mock.patch.object(validate_calculation, "run_verification_tests",
                               return_value={"all_passed": False, "tests": [{"test": "x", "passed": False}]}):
            self.assertEqual(validate_calculation.cli(["--test"]), 1)
        with mock.patch.object(validate_calculation, "run_verification_tests",
                               return_value={"all_passed": True, "tests": [{"test": "x", "passed": True}]}):
            self.assertEqual(validate_calculation.cli(["--test"]), 0)


class TestSuitesCannotPassEmpty(unittest.TestCase):
    """
    D86: on Python 3.11 `unittest discover` that finds nothing prints "Ran 0 tests
    ... OK" and exits 0, so a renamed or broken test file passed CI. D88: the
    daily gate counted any error as a refusal; each guard now names its code.
    """

    def _suite(self, *args):
        return subprocess.run([sys.executable, str(REPO_ROOT / "test_scripts" / "run_suite.py"), *args],
                              capture_output=True, text=True, timeout=300, cwd=REPO_ROOT,
                              env={**os.environ, "KMP_DUPLICATE_LIB_OK": "TRUE"})

    def test_a_pattern_that_matches_nothing_fails(self):
        self.assertNotEqual(self._suite("test_no_such_suite_*.py").returncode, 0)

    def test_minimum_count_is_enforced(self):
        self.assertEqual(self._suite("test_geometry_opt.py", "--min", "1").returncode, 0)
        self.assertNotEqual(self._suite("test_geometry_opt.py", "--min", "100000").returncode, 0)

    def test_skipped_tests_do_not_count_toward_the_minimum(self):
        # D146: a suite whose every test skips (a broken mace import skips per test) passed.
        tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(lambda: subprocess.run(["rm", "-rf", str(tmp)]))
        (tmp / "test_allskip.py").write_text(
            "import unittest\n"
            "class T(unittest.TestCase):\n"
            "    def test_a(self): self.skipTest('no mace')\n"
            "    def test_b(self): self.skipTest('no mace')\n")
        self.assertNotEqual(self._suite("test_allskip.py", "--start-dir", str(tmp), "--min", "1").returncode, 0)

    def test_the_daily_gate_runs_what_ci_runs_with_cis_floors(self):
        # D145: the gate's floors trailed CI's (contract 20 vs 60) and its
        # backend-unit check had none, so it showed "[PASS] 0 tests OK".
        import re
        sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
        import daily_gate
        ci = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text()
        expected = sorted(tuple(m.split()) for m in re.findall(r"python test_scripts/run_suite\.py ([^\n]+)", ci))
        self.assertTrue(expected)
        self.assertEqual(sorted(tuple(args) for args in daily_gate.ci_suites()), expected)
        self.assertGreaterEqual(dict((n, m) for n, _c, m in daily_gate.FRONTEND_CHECKS)["vitest"], 300)

    def test_guards_judge_the_refusal_code(self):
        sys.path.insert(0, str(REPO_ROOT / "test_scripts"))
        import daily_gate
        self.assertTrue(all(len(g) == 4 and g[2] for g in daily_gate.GUARDS))
        wrong = subprocess.CompletedProcess([], 1, stdout=json.dumps(
            {"status": "error", "error": {"code": "calculation_failed"}}), stderr="")
        with mock.patch.object(daily_gate, "run", return_value=wrong):
            self.assertTrue(all(not r.ok for r in daily_gate.gate_guards()))


class TestSmilesAdmission(unittest.TestCase):
    """D136: /smiles-to-xyz (about 13 s of CPU per request) bypassed every admission limit."""

    def test_smiles_conversion_goes_through_the_job_admission(self):
        import asyncio
        import jobs
        import main
        body = json.dumps({"smiles": "CCO"}).encode()
        scope = {"type": "http", "method": "POST", "path": "/smiles-to-xyz", "raw_path": b"/smiles-to-xyz",
                 "query_string": b"", "root_path": "", "scheme": "http", "http_version": "1.1",
                 "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
                 "client": ("198.51.100.40", 4321), "server": ("testserver", 80)}
        sent, messages = [False], []

        async def receive():
            if not sent[0]:
                sent[0] = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)

        full = jobs.JobStore(max_queued=0)   # admission refuses everything
        with mock.patch.object(main, "JOBS", full), mock.patch.dict(os.environ, {"MACE_API_TOKEN": ""}):
            asyncio.run(main.app(scope, receive, send))
        status = next(m["status"] for m in messages if m["type"] == "http.response.start")
        self.assertEqual(status, 429)


class TestErrorShape(unittest.TestCase):
    """D140: a body FastAPI itself rejects answers in the same shape as every other refusal."""

    @staticmethod
    def _call(path, body, content_type):
        import asyncio
        import main
        scope = {"type": "http", "method": "POST", "path": path, "raw_path": path.encode(),
                 "query_string": b"", "root_path": "", "scheme": "http", "http_version": "1.1",
                 "headers": [(b"content-type", content_type.encode()),
                             (b"content-length", str(len(body)).encode())],
                 "client": ("198.51.100.41", 4321), "server": ("testserver", 80)}
        sent, messages = [False], []

        async def receive():
            if not sent[0]:
                sent[0] = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)

        with mock.patch.dict(os.environ, {"MACE_API_TOKEN": ""}):
            asyncio.run(main.app(scope, receive, send))
        status = next(m["status"] for m in messages if m["type"] == "http.response.start")
        payload = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
        return status, json.loads(payload)

    def _assert_shape(self, status, payload, field):
        self.assertEqual(status, 422, payload)
        self.assertNotIn("detail", payload, "FastAPI's own validation shape leaked out")
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["error"]["code"], "invalid_request")
        self.assertEqual(payload["error"]["field"], field)
        self.assertIn(field, payload["error"]["message"])
        self.assertEqual(payload["message"], payload["error"]["message"])

    def test_a_wrongly_typed_smiles_is_refused_in_the_common_shape(self):
        status, payload = self._call("/smiles-to-xyz", json.dumps({"smiles": 5}).encode(), "application/json")
        self._assert_shape(status, payload, "smiles")

    def _raw(self, method, path, body=b"", content_type="application/json"):
        import asyncio
        import main
        scope = {"type": "http", "method": method, "path": path, "raw_path": path.encode(),
                 "query_string": b"", "root_path": "", "scheme": "http", "http_version": "1.1",
                 "headers": [(b"content-type", content_type.encode()),
                             (b"content-length", str(len(body)).encode())],
                 "client": ("198.51.100.44", 4321), "server": ("testserver", 80)}
        sent, messages = [False], []

        async def receive():
            if not sent[0]:
                sent[0] = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)

        with mock.patch.dict(os.environ, {"MACE_API_TOKEN": ""}):
            asyncio.run(main.app(scope, receive, send))
        status = next(m["status"] for m in messages if m["type"] == "http.response.start")
        return status, json.loads(b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body"))

    def test_unknown_routes_and_wrong_methods_use_the_common_shape(self):
        # D148: Starlette's own 404/405 bypassed the HTTPException handler.
        for method, path, code in (("GET", "/no-such-route", 404), ("DELETE", "/calculate", 405)):
            with self.subTest(path=path):
                status, payload = self._raw(method, path)
                self.assertEqual(status, code, payload)
                self.assertNotIn("detail", payload)
                self.assertEqual(payload["status"], "error")
                self.assertIn("code", payload["error"])

    def test_a_lone_surrogate_in_a_refused_value_still_gets_a_json_answer(self):
        # D149: echoing "\ud800" in the refusal message made the response unencodable.
        body = (b"--x\r\nContent-Disposition: form-data; name=\"files\"; filename=\"w.xyz\"\r\n\r\n"
                b"1\n\nH 0 0 0\n\r\n--x\r\nContent-Disposition: form-data; name=\"params\"\r\n\r\n"
                b'{"modelType": "\\ud800"}\r\n--x--\r\n')
        status, payload = self._raw("POST", "/calculate", body, "multipart/form-data; boundary=x")
        self.assertEqual(status, 400, payload)
        self.assertEqual(payload["status"], "error")

    def test_a_missing_params_field_is_refused_in_the_common_shape(self):
        body = (b"--x\r\nContent-Disposition: form-data; name=\"files\"; filename=\"w.xyz\"\r\n"
                b"Content-Type: text/plain\r\n\r\n1\n\nH 0 0 0\n\r\n--x--\r\n")
        status, payload = self._call("/calculate", body, "multipart/form-data; boundary=x")
        self._assert_shape(status, payload, "params")


class TestSmilesRefusalCodes(unittest.TestCase):
    """D151 follow-through: the route wrapped every ValueError, ContractError included, as invalid_smiles."""

    def test_a_coded_refusal_from_the_converter_keeps_its_code(self):
        import asyncio
        import main
        body = json.dumps({"smiles": "C1=CC=CC=C1"}).encode()
        scope = {"type": "http", "method": "POST", "path": "/smiles-to-xyz", "raw_path": b"/smiles-to-xyz",
                 "query_string": b"", "root_path": "", "scheme": "http", "http_version": "1.1",
                 "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
                 "client": ("198.51.100.45", 4321), "server": ("testserver", 80)}
        sent, messages = [False], []

        async def receive():
            if not sent[0]:
                sent[0] = True
                return {"type": "http.request", "body": body, "more_body": False}
            await asyncio.sleep(0.05)
            return {"type": "http.request", "body": b"", "more_body": True}

        async def send(message):
            messages.append(message)

        def slow(_smiles):
            raise ContractError("The 3D embedding took longer than 20 s.", code="smiles_embedding_timeout",
                                field="smiles", status=422)

        with mock.patch.object(main, "_smiles_to_xyz", slow), mock.patch.dict(os.environ, {"MACE_API_TOKEN": ""}):
            asyncio.run(main.app(scope, receive, send))
        status = next(m["status"] for m in messages if m["type"] == "http.response.start")
        payload = json.loads(b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body"))
        self.assertEqual((status, payload["error"]["code"]), (422, "smiles_embedding_timeout"), payload)


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
