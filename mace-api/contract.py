"""
SimpleAtom request contract — what the backend will and will not compute.

`contract.json` (next to this file) is the single source of truth for the
calculation types, parameter bounds, per-deployment resource caps and the
model registry. This module enforces it; the Next.js route and the UI read the
same file through the generated `lib/generated/contract.ts`. Where the two
disagree, this module wins: the hosted API can be called directly, so this is
the security boundary (docs/adr/0003, 0022).

Every refusal raises `ContractError`, a ValueError subclass carrying an HTTP
status, a machine-readable code and the offending field, so the CLI, FastAPI
and the Next.js proxy can report it without parsing prose.
"""

from __future__ import annotations

import json
import math
import re
import os
from functools import lru_cache
from pathlib import Path

CONTRACT_PATH = Path(__file__).resolve().with_name("contract.json")


class ContractError(ValueError):
    """A request the contract refuses. Nothing was computed."""

    def __init__(self, message: str, *, code: str = "invalid_request",
                 field: str | None = None, status: int = 400):
        super().__init__(message)
        self.code = code
        self.field = field
        self.status = status

    def to_dict(self) -> dict:
        return {"code": self.code, "message": str(self), "field": self.field}


@lru_cache(maxsize=1)
def load_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


# ── deployment profile ──────────────────────────────────────────────────────

def profile_name(default: str) -> str:
    """
    The resource profile in force. `SIMPLEATOM_PROFILE` overrides the
    entrypoint's default: main.py (the public Space) defaults to "hosted",
    calculate_local.py (your own machine) to "local".
    """
    name = (os.environ.get("SIMPLEATOM_PROFILE") or default).strip().lower()
    if name not in load_contract()["profiles"]:
        raise ContractError(
            f"Unknown SIMPLEATOM_PROFILE '{name}'. "
            f"Known profiles: {', '.join(load_contract()['profiles'])}.",
            code="bad_profile", status=500,
        )
    return name


def profile(name: str) -> dict:
    return load_contract()["profiles"][name]


def allowed_devices(name: str) -> list[str]:
    """The devices this profile offers (ADR-0031): the hosted image is CPU-only."""
    return list(profile(name).get("devices", load_contract()["devices"]))


def custom_models_allowed(name: str) -> bool:
    """
    Whether this deployment may load an uploaded checkpoint.

    A MACE `.model` file is a pickled torch module: loading it runs whatever
    code it carries. That is acceptable on your own machine with your own file
    and not on a public server, so the hosted profile refuses it unless the
    operator opts in explicitly with ALLOW_CUSTOM_MODELS=1 (docs/adr/0020).
    """
    raw = os.environ.get("ALLOW_CUSTOM_MODELS", "").strip().lower()
    if raw in ("1", "true", "yes"):
        return True
    if raw in ("0", "false", "no"):
        return False
    return bool(profile(name)["customModels"])


# ── model registry ──────────────────────────────────────────────────────────

def models() -> list[dict]:
    return load_contract()["models"]


def model_ids() -> tuple[str, ...]:
    """Every accepted modelType spelling: canonical ids, then aliases."""
    ids = [m["id"] for m in models()]
    aliases = [a for m in models() for a in m["aliases"]]
    return tuple(ids + aliases)


def find_model(model_id: str) -> dict | None:
    for m in models():
        if model_id == m["id"] or model_id in m["aliases"]:
            return m
    return None


def default_model_type() -> str:
    return load_contract()["defaultModelType"]


def resolve_model(raw, has_model_path: bool) -> dict:
    """
    The registry entry for the requested modelType.

    Missing → "custom" when a checkpoint was uploaded, otherwise the registry
    default. Present but unknown → refused, never a fall-through to another
    model (docs/adr/0004). "custom" with no checkpoint → refused: running a
    foundation model and labelling it "custom" would attribute the numbers to
    a model that was never loaded.
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return find_model("custom" if has_model_path else default_model_type())

    supported = ", ".join(model_ids())
    if not isinstance(raw, str):
        raise ContractError(
            f"Invalid modelType: expected a string, got {type(raw).__name__}. "
            f"Supported models: {supported}.",
            code="unsupported_model", field="modelType",
        )

    model = find_model(raw.strip())
    if model is None:
        raise ContractError(
            f"Unsupported modelType '{raw.strip()}'. Supported models: {supported}.",
            code="unsupported_model", field="modelType",
        )
    if model["loader"] == "checkpoint" and not has_model_path:
        raise ContractError(
            "modelType 'custom' requires an uploaded MACE .model checkpoint, but "
            "no model file was supplied. Upload the checkpoint, or select a "
            "foundation model. Running a foundation model and labelling the "
            "result 'custom' would attribute the numbers to a model that was "
            "never loaded.",
            code="custom_model_missing", field="modelType",
        )
    return model


def resolve_model_size(model: dict, raw) -> str | None:
    """
    A size the registry lists for this model, or a refusal.

    Never passed through as-is: upstream's loaders treat any string that is not
    a known size as a URL to download or a local path to load, and they load
    it with full unpickling. The size is therefore an allow-list, not a hint.
    """
    if model["loader"] == "checkpoint":
        return None
    sizes = model["sizes"]
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return model["defaultSize"]
    if isinstance(raw, str) and raw.strip() in sizes:
        return raw.strip()
    raise ContractError(
        f"Unsupported modelSize {raw!r} for {model['id']}. "
        f"Available sizes: {', '.join(sizes)}.",
        code="unsupported_model_size", field="modelSize",
    )


def upstream_model_key(model: dict, size: str) -> str:
    return model["sizes"][size]["upstreamModel"]


def allowed_checkpoint_sha256() -> frozenset[str]:
    """SHA-256 of every foundation checkpoint SimpleAtom will unpickle."""
    return frozenset(
        spec["sha256"]
        for m in models()
        for spec in m["sizes"].values()
        if spec.get("sha256")
    )


def energy_convention(model_id: str | None) -> dict:
    model = find_model(model_id) if model_id else None
    key = model["energyConvention"] if model else "unknown"
    return load_contract()["energyConventions"][key]


# ── parameters ──────────────────────────────────────────────────────────────

def resolve_calculation_type(raw) -> str:
    """Missing → "single-point". Present but unimplemented → refused."""
    contract = load_contract()
    supported = contract["calculationTypes"]
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return "single-point"
    if not isinstance(raw, str):
        raise ContractError(
            f"Invalid calculationType: expected a string, got {type(raw).__name__}. "
            f"Supported types: {', '.join(supported)}.",
            code="unsupported_calculation", field="calculationType",
        )
    calc_type = raw.strip()
    if calc_type in supported:
        return calc_type
    msg = f"Unsupported calculationType '{calc_type}'. Supported types: {', '.join(supported)}."
    hint = contract["refusedCalculationTypes"].get(calc_type.lower())
    if hint:
        msg = f"{msg} {hint}"
    raise ContractError(msg, code="unsupported_calculation", field="calculationType")


def resolve_choice(raw, field: str, choices: list[str], default: str) -> str:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return default
    if isinstance(raw, str) and raw.strip() in choices:
        return raw.strip()
    raise ContractError(
        f"Unsupported {field} {raw!r}. Supported values: {', '.join(choices)}.",
        code=f"unsupported_{field}", field=field,
    )


def resolve_bool(raw, field: str, default: bool = False) -> bool:
    """
    A real boolean. `bool("false")` is True in Python, so a string "false"
    used to switch D3 dispersion ON; strings are parsed, everything else that
    is not a bool is refused.
    """
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str) and raw.strip().lower() in ("true", "false"):
        return raw.strip().lower() == "true"
    raise ContractError(
        f"Invalid {field}: expected true or false, got {raw!r}.",
        code="invalid_boolean", field=field,
    )


DECIMAL = re.compile(r"[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?")


def resolve_number(params: dict, field: str):
    """
    A finite number inside the contract's physical bounds, or its default.

    Booleans are refused (they are ints in Python), as are NaN and infinity,
    which would otherwise pass straight into ASE and come back as a result.
    """
    spec = load_contract()["params"][field]
    raw = params.get(field)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return spec["default"]
    if isinstance(raw, bool):
        raise ContractError(f"Invalid {field}: expected a number, got a boolean.",
                            code="invalid_number", field=field)
    # Strings must be plain decimals, as in lib/contract.ts: float() alone
    # also takes "1_000", which JavaScript's Number() does not, and the two
    # mirrors must refuse the same requests.
    if isinstance(raw, str) and not DECIMAL.fullmatch(raw.strip()):
        raise ContractError(f"Invalid {field}: expected a number, got {raw!r}.",
                            code="invalid_number", field=field)
    try:
        value = float(raw)
    except (TypeError, ValueError, OverflowError):
        raise ContractError(f"Invalid {field}: expected a number, got {raw!r}.",
                            code="invalid_number", field=field)
    if not math.isfinite(value):
        raise ContractError(f"Invalid {field}: must be a finite number.",
                            code="invalid_number", field=field)
    if spec["type"] == "integer":
        if value != int(value):
            raise ContractError(f"Invalid {field}: expected a whole number, got {raw!r}.",
                                code="invalid_number", field=field)
        value = int(value)
    unit = f" {spec['unit']}" if spec.get("unit") else ""
    if value < spec["min"] or value > spec["max"]:
        raise ContractError(
            f"{field} = {value}{unit} is outside the supported range "
            f"{spec['min']}–{spec['max']}{unit}.",
            code="out_of_range", field=field,
        )
    return value


def check_step_cap(field: str, value: int, profile_name_: str) -> None:
    cap_key = {"maxOptSteps": "maxOptSteps", "mdSteps": "maxMdSteps"}[field]
    cap = profile(profile_name_)[cap_key]
    if value > cap:
        raise ContractError(
            f"{field} = {value} exceeds this deployment's limit of {cap} "
            f"({profile_name_} profile). Run SimpleAtom locally for longer runs.",
            code="limit_exceeded", field=field, status=422,
        )


def check_atom_caps(n_atoms: int, calc_type: str, steps: int | None,
                    profile_name_: str) -> None:
    prof = profile(profile_name_)
    cap = prof["maxAtoms"][calc_type]
    if n_atoms > cap:
        raise ContractError(
            f"The structure has {n_atoms} atoms; this deployment computes at most "
            f"{cap} atoms for {calc_type} ({profile_name_} profile). Nothing was computed.",
            code="limit_exceeded", field="structure", status=422,
        )
    atom_steps_cap = prof["maxAtomSteps"].get(calc_type)
    if steps is not None and atom_steps_cap is not None and n_atoms * steps > atom_steps_cap:
        raise ContractError(
            f"{n_atoms} atoms × {steps} steps = {n_atoms * steps:,} atom-steps exceeds "
            f"this deployment's limit of {atom_steps_cap:,} for {calc_type} "
            f"({profile_name_} profile). Reduce the steps or the structure size.",
            code="limit_exceeded", field="structure", status=422,
        )


def trajectory_stride(n_atoms: int, total_steps: int, profile_name_: str) -> int:
    """
    Record every k-th frame so a trajectory stays inside the profile's budget.

    The budget is in floats (frames × atoms × 3) because that is what the JSON
    result carries; a 9-atom molecule keeps every frame of a 500-step run, a
    1,000-atom cell keeps 50 frames. Returns 1 when everything fits.
    """
    prof = profile(profile_name_)
    by_floats = prof["trajectoryFloatBudget"] // max(1, 3 * n_atoms)
    max_frames = max(2, min(prof["maxTrajectoryFrames"], by_floats))
    # Steps after the initial frame; the initial and final frames are always
    # kept on top of the strided ones, so the budget is exceeded by at most two.
    return max(1, math.ceil(total_steps / max_frames))
