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
from calculate import run_calculation

try:
    from smiles_to_xyz import smiles_to_xyz as _smiles_to_xyz
except Exception as _import_err:  # noqa: BLE001
    _logger.warning("Failed to import smiles_to_xyz: %s", _import_err)
    _smiles_to_xyz = None

PROFILE = contract.profile_name("hosted")
LIMITS = contract.profile(PROFILE)
APP_VERSION = contract.load_contract()["appVersion"]

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
# This Space is a free shared CPU, open to anyone. One calculation at a time:
# torch already uses both cores for one MACE forward pass, so a second
# concurrent job halves both instead of doubling throughput. It is also a
# correctness requirement: torch's default dtype and the scoped torch.load
# wrapper are process-global (calculate.py).
MAX_QUEUE_WAIT_SECONDS = 20.0
_CALC_SLOTS = asyncio.Semaphore(1)

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


@app.post("/calculate")
async def calculate(
    files: list[UploadFile] = File(...),
    params: str = Form(...),
    model: UploadFile | None = None,
    x_simpleatom_proxy_key: str | None = Header(default=None),
):
    """
    Run a MACE calculation on one uploaded structure (XYZ, extXYZ, CIF,
    POSCAR/VASP, PDB). Custom .model uploads are refused on the hosted profile.
    """
    _require_proxy_key(x_simpleatom_proxy_key)
    try:
        params_obj = json.loads(params)
    except json.JSONDecodeError as e:
        raise _error(400, "invalid_params", f"Invalid params JSON: {e}", field="params")
    if not isinstance(params_obj, dict):
        raise _error(400, "invalid_params", "params must be a JSON object.", field="params")
    if not files:
        raise _error(400, "no_files", "No structure file provided.", field="files")
    if model is not None and not contract.custom_models_allowed(PROFILE):
        raise _error(403, "custom_models_disabled",
                     "Custom model checkpoints are disabled on this deployment: loading "
                     "a MACE .model file executes code from the file. Run SimpleAtom "
                     "locally to use your own checkpoint. Nothing was computed.",
                     field="model")

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

        # Admission control. Waiting briefly is better than a 429 for a visitor
        # who arrived a second after someone else; waiting a minute is not.
        try:
            await asyncio.wait_for(_CALC_SLOTS.acquire(), timeout=MAX_QUEUE_WAIT_SECONDS)
        except asyncio.TimeoutError:
            raise _error(429, "busy",
                         "This free CPU backend runs one calculation at a time and is "
                         "busy. Nothing was computed. Try again in a moment, or run "
                         "SimpleAtom locally for unqueued access.",
                         headers={"Retry-After": "30"})
        try:
            # CPU-bound and synchronous: run it off the event loop, so /health
            # and the 429 above stay responsive while it computes.
            result = await asyncio.to_thread(
                run_calculation, tmp_path, params_obj, model_path=model_path,
                profile=PROFILE, display_name=display_name,
            )
        finally:
            _CALC_SLOTS.release()
        return result
    except HTTPException:
        raise
    except ValueError as e:
        # ContractError / UntrustedCheckpointError: a refusal, not a server
        # fault (D4). Nothing was computed.
        raise _error(getattr(e, "status", 400), getattr(e, "code", "invalid_request"),
                     str(e), field=getattr(e, "field", None))
    except Exception as e:  # noqa: BLE001
        _logger.exception("calculation failed")
        raise _error(500, "calculation_failed", f"{type(e).__name__}: {e}")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


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
            "POST /calculate": "Run a MACE calculation on an uploaded structure",
            "POST /smiles-to-xyz": "Convert SMILES to a 3D XYZ structure",
            "GET /capabilities": "Models and limits this deployment accepts",
            "GET /health": "Health check (includes the deployed git SHA)",
        },
    }
