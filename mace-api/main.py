"""
MACE Calculation API — FastAPI server for remote deployment.

Thin wrapper around calculate.py. Handles uploads, admission control and HTTP
status mapping; every scientific rule lives in calculate.py and contract.py.
Runs under the "hosted" profile of contract.json unless SIMPLEATOM_PROFILE
says otherwise.

Deploy: uvicorn main:app --host 0.0.0.0 --port 7860 --workers 1
"""

import asyncio
import hmac
import json
import logging
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

logging.basicConfig(level=logging.INFO)
_logger = logging.getLogger("mace-api")

# There is deliberately no global torch.load patch. MACE checkpoints need full
# unpickling, which PyTorch 2.6+ refuses by default; calculate.py grants it
# only to pinned foundation checkpoints while a calculator is being built
# (safe_load.py, docs/adr/0020). This server is public: an uploaded or
# URL-named checkpoint must never be deserialised here.
import torch

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import contract
import provenance
from calculate import RunHooks, run_calculation, validate_request
from jobs import Job, JobStore

try:
    from smiles_to_xyz import smiles_to_xyz as _smiles_to_xyz
except Exception as _import_err:  # noqa: BLE001
    _logger.warning("Failed to import smiles_to_xyz: %s", _import_err)
    _smiles_to_xyz = None

PROFILE = contract.profile_name("hosted")
LIMITS = contract.profile(PROFILE)
APP_VERSION = contract.load_contract()["appVersion"]
if PROFILE == "hosted" and not os.environ.get("MACE_API_TOKEN"):
    _logger.warning(
        "MACE_API_TOKEN is not set: the hosted API accepts direct callers, and every "
        "request the Vercel proxy relays shares one per-visitor limit (D43)."
    )

app = FastAPI(
    title="SimpleAtom MACE API",
    description="Run MACE energy and force calculations on atomic structures",
    version=APP_VERSION,
)

# No CORS middleware: the browser never calls this server. The Next.js route
# on Vercel proxies to it server-to-server, which is where rate limits and the
# 4.5 MB body cap already apply. A wildcard origin with credentials, as before,
# invited every website to drive this Space from its visitors' browsers.

# ── admission control ──────────────────────────────────────────────────────
# This Space is a free shared CPU, open to anyone. Every calculation — a job
# or a synchronous /calculate — goes through ONE worker thread (jobs.py):
# torch already uses both cores for one MACE forward pass, so a second
# concurrent job halves both instead of doubling throughput, and torch's
# default dtype and the scoped torch.load guard are process-global.
JOBS = JobStore()

try:
    torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", "2")))
except Exception:  # noqa: BLE001 — never let a tuning call break startup
    pass


def _error(status: int, code: str, message: str, field=None, headers=None) -> HTTPException:
    return HTTPException(status_code=status,
                         detail={"code": code, "message": message, "field": field},
                         headers=headers)


@app.exception_handler(HTTPException)
async def _http_error(_request: Request, exc: HTTPException):
    """One error shape everywhere: {"error": {code, message, field}}."""
    detail = exc.detail if isinstance(exc.detail, dict) else {
        "code": "http_error", "message": str(exc.detail), "field": None}
    return JSONResponse({"status": "error", "message": detail["message"], "error": detail},
                        status_code=exc.status_code, headers=exc.headers)


def _require_proxy_key(provided: str | None) -> None:
    """
    When MACE_API_TOKEN is set, only callers presenting it may compute.

    The Space URL is public, so without this anyone can bypass the Vercel
    proxy (and anything it enforces) and call the backend directly.
    """
    expected = os.environ.get("MACE_API_TOKEN", "")
    if expected and not hmac.compare_digest((provided or "").encode(), expected.encode()):
        raise _error(401, "proxy_key_required",
                     "This backend only accepts requests from the SimpleAtom frontend.")


def _safe_suffix(filename: str | None) -> str:
    """The structure-format suffix to store an upload under, from an allow-list."""
    name = Path(filename or "").name
    ext = Path(name).suffix.lower()
    c = contract.load_contract()
    if ext in c["structureExtensions"]:
        return ext
    if name.upper() in c["bareStructureNames"]:
        return c["bareStructureNames"][name.upper()]
    raise _error(400, "unsupported_format",
                 f"Unsupported structure file '{name}'. Supported: "
                 f"{', '.join(c['structureExtensions'])} (or a bare POSCAR/CONTCAR).",
                 field="files")


async def _save_capped(upload: UploadFile, directory: str, stored_name: str, limit: int) -> str:
    """Stream an upload to disk, refusing it as soon as it passes `limit` bytes."""
    path = os.path.join(directory, stored_name)
    written = 0
    with open(path, "wb") as handle:
        while chunk := await upload.read(1 << 20):
            written += len(chunk)
            if written > limit:
                raise _error(413, "upload_too_large",
                             f"'{Path(upload.filename or '').name}' exceeds this "
                             f"deployment's {limit / 1e6:.1f} MB limit.",
                             field="files")
            handle.write(chunk)
    return path


def _client_key(request: Request, forwarded_ip: str | None) -> str:
    """
    Who a request is from, for per-visitor limits.

    The Vercel proxy forwards the visitor's IP in X-SimpleAtom-Client-IP. That
    header is trusted only when MACE_API_TOKEN is set, because then
    `_require_proxy_key` has already authenticated the caller as the proxy.
    Without the token anyone can send it, so a direct caller could name a new
    "visitor" per request and walk past every limit (D43). In that case the
    key is the right-most X-Forwarded-For entry, the hop the platform's own
    ingress appended, and never a left-hand entry the client wrote.

    The consequence of running hosted without the token is that every request
    the Vercel proxy relays shares that proxy's key. Set MACE_API_TOKEN on both
    sides before deploying.
    """
    if forwarded_ip and os.environ.get("MACE_API_TOKEN"):
        return forwarded_ip.split(",")[0].strip()[:64]
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[-1].strip()[:64]
    return request.client.host if request.client else "unknown"


async def _intake(files: list[UploadFile], params: str, model: UploadFile | None):
    """
    Validate a calculation request and stage its files, or refuse it.

    Every request-level check runs here, before anything waits in line — so a
    bad request is a 4xx at once, never a failed job a minute later.
    """
    try:
        params_obj = json.loads(params)
    except json.JSONDecodeError as e:
        raise _error(400, "invalid_params", f"Invalid params JSON: {e}", field="params")
    if not isinstance(params_obj, dict):
        raise _error(400, "invalid_params", "params must be a JSON object.", field="params")
    if not files:
        raise _error(400, "no_files", "No structure file provided.", field="files")
    try:
        validate_request(params_obj, model is not None, PROFILE)
    except ValueError as e:
        raise _error(getattr(e, "status", 400), getattr(e, "code", "invalid_request"),
                     str(e), field=getattr(e, "field", None))

    workdir = tempfile.mkdtemp(prefix="mace-")
    try:
        structure = files[0]
        display_name = Path(structure.filename or "structure").name
        tmp_path = await _save_capped(structure, workdir,
                                      "structure" + _safe_suffix(structure.filename),
                                      LIMITS["maxUploadBytes"])
        model_path = None
        if model is not None:
            model_path = await _save_capped(model, workdir, "custom.model",
                                            LIMITS["maxModelUploadBytes"])
    except BaseException:
        shutil.rmtree(workdir, ignore_errors=True)
        raise

    def run(job: Job) -> dict:
        hooks = RunHooks(
            # Replaced, not mutated: a poll reading it from another thread
            # always sees one complete progress event.
            on_progress=lambda event: setattr(job, "progress", dict(event)),
            is_cancelled=job.cancel_requested.is_set,
        )
        return run_calculation(tmp_path, params_obj, model_path=model_path,
                               profile=PROFILE, display_name=display_name, hooks=hooks)

    return run, workdir


def _submit(request: Request, forwarded_ip: str | None, run, workdir) -> Job:
    try:
        return JOBS.submit(_client_key(request, forwarded_ip), run, workdir=workdir)
    except ValueError as e:
        shutil.rmtree(workdir, ignore_errors=True)
        headers = {"Retry-After": "30"} if getattr(e, "status", 400) == 429 else None
        raise _error(getattr(e, "status", 429), getattr(e, "code", "busy"), str(e), headers=headers)


@app.post("/v1/jobs", status_code=202)
async def submit_job(
    request: Request,
    files: list[UploadFile] = File(...),
    params: str = Form(...),
    model: UploadFile | None = None,
    x_simpleatom_proxy_key: str | None = Header(default=None),
    x_simpleatom_client_ip: str | None = Header(default=None),
):
    """Queue a calculation. Returns 202 with a job id to poll."""
    _require_proxy_key(x_simpleatom_proxy_key)
    run, workdir = await _intake(files, params, model)
    job = _submit(request, x_simpleatom_client_ip, run, workdir)
    return JOBS.describe(job)


def _job_or_404(job_id: str) -> Job:
    job = JOBS.get(job_id)
    if job is None:
        raise _error(404, "job_not_found",
                     "No such job. It may have expired (results are kept for 15 minutes) "
                     "or the backend restarted; submit the calculation again.")
    return job


@app.get("/v1/jobs/{job_id}")
async def get_job(job_id: str, x_simpleatom_proxy_key: str | None = Header(default=None)):
    """Status, real progress (phase and step) and, once finished, the result."""
    _require_proxy_key(x_simpleatom_proxy_key)
    return JOBS.describe(_job_or_404(job_id))


@app.delete("/v1/jobs/{job_id}")
async def cancel_job(job_id: str, x_simpleatom_proxy_key: str | None = Header(default=None)):
    """Cancel a job. A queued job is dropped; a running one stops at its next step."""
    _require_proxy_key(x_simpleatom_proxy_key)
    _job_or_404(job_id)
    return JOBS.describe(JOBS.cancel(job_id))


@app.post("/calculate")
async def calculate(
    request: Request,
    files: list[UploadFile] = File(...),
    params: str = Form(...),
    model: UploadFile | None = None,
    x_simpleatom_proxy_key: str | None = Header(default=None),
    x_simpleatom_client_ip: str | None = Header(default=None),
):
    """
    Run one calculation and wait for it — the original synchronous API, kept
    for existing callers. It goes through the same single worker as /v1/jobs.
    """
    _require_proxy_key(x_simpleatom_proxy_key)
    run, workdir = await _intake(files, params, model)
    job = _submit(request, x_simpleatom_client_ip, run, workdir)
    wait = LIMITS["timeBudgetSeconds"] + 120
    finished = await asyncio.to_thread(job.done.wait, wait)
    if not finished:
        JOBS.cancel(job.id)
        raise _error(504, "timeout", "The calculation did not finish in time and was cancelled.")
    if job.status == "succeeded":
        return job.result
    err = job.error or {"code": "cancelled", "message": "The calculation was cancelled.", "status": 499}
    raise _error(err.get("status", 500), err.get("code", "calculation_failed"),
                 err.get("message", "Calculation failed"), field=err.get("field"))


class SmilesRequest(BaseModel):
    smiles: str


@app.post("/smiles-to-xyz")
async def convert_smiles(req: SmilesRequest,
                         x_simpleatom_proxy_key: str | None = Header(default=None)):
    """Convert a SMILES string to a 3D XYZ structure using RDKit."""
    _require_proxy_key(x_simpleatom_proxy_key)
    if _smiles_to_xyz is None:
        raise _error(503, "smiles_unavailable",
                     "SMILES conversion unavailable (smiles_to_xyz module not found)")
    smiles = (req.smiles or "").strip()
    if not smiles:
        raise _error(400, "invalid_smiles", "Missing or empty SMILES string", field="smiles")
    if len(smiles) > LIMITS["maxSmilesLength"]:
        raise _error(422, "limit_exceeded",
                     f"SMILES is {len(smiles)} characters; this deployment accepts at most "
                     f"{LIMITS['maxSmilesLength']}.", field="smiles")
    try:
        return await asyncio.to_thread(_smiles_to_xyz, smiles)
    except ValueError as e:
        raise _error(400, "invalid_smiles", str(e), field="smiles")
    except Exception as e:  # noqa: BLE001
        raise _error(500, "smiles_failed", f"{type(e).__name__}: {e}")


@app.get("/capabilities")
async def capabilities():
    """What this deployment will compute — read by the frontend."""
    return {
        "appVersion": APP_VERSION,
        "profile": PROFILE,
        "customModels": contract.custom_models_allowed(PROFILE),
        "limits": {k: v for k, v in LIMITS.items() if k != "description"},
        "models": [m["id"] for m in contract.models()
                   if m["hostedEnabled"] or contract.custom_models_allowed(PROFILE)],
    }


@app.get("/health")
async def health():
    """Liveness, plus the code SHA so a deploy can be verified end to end."""
    code = provenance.git_info()
    return {"status": "ok", "service": "mace-api", "version": APP_VERSION,
            "profile": PROFILE, "gitCommit": code.get("commit")}


@app.get("/")
async def root():
    """API info."""
    return {
        "name": "SimpleAtom MACE API",
        "version": APP_VERSION,
        "endpoints": {
            "POST /v1/jobs": "Queue a calculation; returns a job id (202)",
            "GET /v1/jobs/{id}": "Job status, real progress, and the result",
            "DELETE /v1/jobs/{id}": "Cancel a job",
            "POST /calculate": "Run a calculation and wait for the result",
            "POST /smiles-to-xyz": "Convert SMILES to a 3D XYZ structure",
            "GET /capabilities": "Models and limits this deployment accepts",
            "GET /health": "Health check (includes the deployed git SHA)",
        },
    }
