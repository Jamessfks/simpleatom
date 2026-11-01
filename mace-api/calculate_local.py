#!/usr/bin/env python3
"""
CLI wrapper for MACE calculations — runs locally, no FastAPI needed.

Usage:
  python calculate_local.py <structure_file> [params_json]
                            [--model-path <path>] [--display-name <name>] [--progress]
  python calculate_local.py --capabilities   (prints the usable devices, then exits)

Reads an atomic structure file, runs MACE, prints ONE JSON document to stdout:
the result, or {"status": "error", "message": ..., "error": {code, field,
status}}. With --progress, step progress is written to stderr as lines of the
form `@@progress {json}`. Called by the Next.js API route when no MACE_API_URL
is set. Runs under the "local" profile of contract.json unless
SIMPLEATOM_PROFILE says otherwise.
"""

import json
from pathlib import Path
import sys
import os
import warnings

# Suppress Python warnings (deprecations etc.) — they are noise here.
warnings.filterwarnings("ignore")
os.environ["PYTHONWARNINGS"] = "ignore"

# Keep stdout pure JSON without silencing anything. MACE prints its dtype
# guidance ("Using float32 ... Use float64 for geometry optimization"), its
# model path and the ASL licence notice straight to stdout; the caller parses
# stdout from the first "{". Redirecting the process stdout to stderr and
# writing the result to the real stdout at the end makes that robust, and
# keeps upstream's messages readable in the server log instead of discarding
# them.
_REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr

# There is deliberately no global torch.load patch here any more. MACE
# checkpoints need full unpickling, which PyTorch 2.6+ refuses by default;
# calculate.py now grants it only to pinned foundation checkpoints (and to an
# uploaded checkpoint, when this deployment allows custom models), for the
# duration of calculator construction — see safe_load.py and docs/adr/0020.

# Route library logging to stderr at WARNING and above. This used to be
# `logging.disable(logging.CRITICAL)`, which also hid MACECalculator's
# "Default dtype ... does not match model dtype, converting models to ..."
# warning — the one signal that a checkpoint was silently downcast.
# calculate.py now captures that warning into result["warnings"], which it
# cannot do if logging is disabled process-wide.
import logging
logging.basicConfig(
    level=logging.WARNING,
    stream=sys.stderr,
    format="%(levelname)s: %(message)s",
)

import contract
from calculate import RunHooks, device_report, run_calculation


def emit(payload: dict) -> None:
    """
    Write the one JSON document this process produces to the real stdout.

    Strict JSON only (D129): Python writes NaN and Infinity by default, and
    Node's JSON.parse rejects them, so a non-finite number used to surface as
    an unparseable reply. The engine refuses non-finite results itself; this is
    the last line, and it answers with the same coded refusal.
    """
    try:
        text = json.dumps(payload, allow_nan=False)
    except ValueError:
        message = "The result contains a non-finite number (NaN or Infinity). Nothing usable was computed."
        text = json.dumps({"status": "error", "message": message,
                           "error": {"code": "non_finite_result", "message": message,
                                     "field": None, "status": 422}})
    print(text, file=_REAL_STDOUT, flush=True)


def emit_error(message: str, code: str = "calculation_failed", field=None,
               status: int = 500) -> None:
    emit({"status": "error", "message": message,
          "error": {"code": code, "message": message, "field": field, "status": status}})


def pinned_versions() -> dict[str, str]:
    """The exact pins in requirements.in for the packages the manifest tracks."""
    import re
    import provenance
    text = (Path(__file__).resolve().parent / "requirements.in").read_text()
    pins = dict(re.findall(r"^([A-Za-z0-9_.-]+)==([^\s#]+)", text, flags=re.M))
    return {name: pins[name] for name in provenance.TRACKED_DISTRIBUTIONS if name in pins}


def stack_drift(installed: dict, pins: dict[str, str]) -> list[str]:
    """
    Where the running Python differs from the pins. Local mode spawns whatever
    interpreter it is given (SIMPLEATOM_PYTHON, else `python3` on PATH), which
    need not be the pinned stack; a local version label (`+cpu`) is not drift.
    """
    out = []
    for name, pinned in pins.items():
        have = installed.get(name)
        if have is None:
            out.append(f"{name} not installed (pinned {pinned})")
        elif have.split("+", 1)[0] != pinned:
            out.append(f"{name} {have} (pinned {pinned})")
    return out


def _take_option(args: list[str], flag: str, takes_value: bool = True):
    """Remove `flag` (and its value) from args. Returns (args, value|True|None)."""
    if flag not in args:
        return args, None
    idx = args.index(flag)
    if not takes_value:
        return args[:idx] + args[idx + 1:], True
    if idx + 1 >= len(args):
        emit_error(f"{flag} requires an argument", code="usage", status=400)
        sys.exit(1)
    return args[:idx] + args[idx + 2:], args[idx + 1]


def _progress_line(event: dict) -> None:
    print("@@progress " + json.dumps(event), file=sys.stderr, flush=True)


if __name__ == "__main__":
    # Options are consumed before the positional arguments are read, so a
    # params JSON that happens to contain "--model-path" is never mistaken
    # for the flag.
    args = sys.argv[1:]
    args, model_path = _take_option(args, "--model-path")
    args, display_name = _take_option(args, "--display-name")
    args, want_progress = _take_option(args, "--progress", takes_value=False)
    args, want_capabilities = _take_option(args, "--capabilities", takes_value=False)

    if want_capabilities:
        # What this machine can run on, for the local GET /api/calculate
        # (ADR-0031): the UI offers exactly these devices.
        emit({"profile": contract.profile_name("local"),
              "devices": device_report(contract.profile_name("local"))})
        sys.exit(0)

    if not args:
        emit_error("Usage: python calculate_local.py <file> [params_json] "
                   "[--model-path <path>] [--display-name <name>] [--progress]",
                   code="usage", status=400)
        sys.exit(1)

    filepath = args[0]
    params_json = args[1] if len(args) > 1 else "{}"

    try:
        params = json.loads(params_json)
        if not isinstance(params, dict):
            raise json.JSONDecodeError("not an object", params_json, 0)
    except json.JSONDecodeError:
        emit_error("Invalid params JSON: expected an object.", code="invalid_params", status=400)
        sys.exit(1)

    hooks = RunHooks(on_progress=_progress_line if want_progress else None)
    try:
        result = run_calculation(
            filepath, params, model_path=model_path,
            profile=contract.profile_name("local"),
            display_name=display_name, hooks=hooks,
        )
        drift = stack_drift((result.get("provenance") or {}).get("packages") or {}, pinned_versions())
        if drift:
            result.setdefault("warnings", []).append(
                "This local Python is not the stack this checkout pins: " + "; ".join(drift) +
                ". Results can differ from the hosted backend's. Point SIMPLEATOM_PYTHON at an "
                "environment built from mace-api/requirements.lock.txt (docs/how-to/install.md).")
        emit(result)
    except ValueError as e:
        # ContractError and UntrustedCheckpointError are ValueErrors with a code:
        # the request was refused and nothing was computed.
        emit_error(str(e), code=getattr(e, "code", "invalid_request"),
                   field=getattr(e, "field", None), status=getattr(e, "status", 400))
        sys.exit(1)
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        if "CUDA" in err_msg or "cuda" in err_msg:
            err_msg += " (Hint: CUDA/GPU not available on this machine. Switch Device to CPU.)"
        elif "No module named" in err_msg:
            err_msg += " (Hint: required Python package not installed.)"
        emit_error(err_msg)
        sys.exit(1)
