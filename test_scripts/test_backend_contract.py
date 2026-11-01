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


class TestSeed(unittest.TestCase):
    """D48: a seed is a finite whole number in range, never coerced; infinity was a 500."""

    def test_non_finite_and_fractional_seeds_are_refused(self):
        import calculate
        for raw in (float("inf"), float("nan"), 3.7, "3.7", True):
            with self.subTest(raw=raw), self.assertRaises(ContractError) as ctx:
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
