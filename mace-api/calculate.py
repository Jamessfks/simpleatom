"""
Shared MACE calculation engine.

Contains all scientific logic for running MACE calculations (single-point,
geometry optimization, molecular dynamics). Both the CLI wrapper
(calculate_local.py) and the FastAPI server (main.py) call into this module.
"""

import logging
import math
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import contract
import provenance
import safe_load
from contract import ContractError

_CONTRACT = contract.load_contract()

# Calculation types that have a real implementation below. This is the
# security boundary: the API can be POSTed to directly, so the frontend check
# is not sufficient. Anything outside this set MUST fail loudly — silently
# falling back to a single-point run would return a plausible-looking energy
# for a calculation that never happened. Defined in contract.json.
SUPPORTED_CALCULATION_TYPES = tuple(_CONTRACT["calculationTypes"])

# Every modelType spelling the registry accepts (canonical ids, then aliases).
# Same security-boundary reasoning, applied to the model: an unrecognised
# modelType that fell through to mace_mp() would return MACE-MP numbers under
# another model's name, shareable via MACE Link and exportable to PDF.
SUPPORTED_MODEL_TYPES = contract.model_ids()

# modelType values that map to upstream's mace_off() loader.
MACE_OFF_MODEL_TYPES = tuple(
    name for m in contract.models() if m["loader"] == "mace_off"
    for name in (m["id"], *m["aliases"])
)

# Floating-point precisions MACE accepts as `default_dtype`.
SUPPORTED_PRECISIONS = tuple(_CONTRACT["precisions"])

# Types the UI/type system knows about but the backend cannot compute.
# Rejecting these honestly is the correct behaviour; a stub returning numbers
# would be worse than an error.
_UNIMPLEMENTED_HINTS = _CONTRACT["refusedCalculationTypes"]

# Default RNG seed for molecular dynamics. MD draws initial velocities from a
# Maxwell-Boltzmann distribution and the Langevin thermostat applies random
# forces at every step; without a seed no trajectory can ever be reproduced,
# including one a user shares via MACE Link. Fixed by default so results are
# verifiable; override with params["seed"] to generate independent replicas.
# (Matches the seeding convention in smiles_to_xyz.py.)
DEFAULT_MD_SEED = _CONTRACT["params"]["seed"]["default"]

# NPT barostat. ASE's pfactor is ptime² · B (ase/md/melchionna.py docstring):
# a barostat time of ~75 fs and a bulk-modulus estimate of ~100 GPa for
# solids. SimpleAtom used to pass 75·fs², which omits B and squares only the
# unit — a barostat ~47× softer than the one it was meant to configure (D17).
NPT_THERMOSTAT_TIME_FS = 25.0
NPT_BAROSTAT_TIME_FS = 75.0
NPT_BULK_MODULUS_GPA = 100.0


class RunCancelled(Exception):
    """The caller withdrew the request; the partial run is discarded."""


class _StopEarly(Exception):
    """Internal: the time budget ran out; finish with what was computed."""

    def __init__(self, step: int):
        super().__init__(step)
        self.step = step


@dataclass
class RunHooks:
    """
    Progress, cancellation and time budget for one calculation.

    `tick()` is called once per optimiser or MD step. It reports progress at
    most four times a second, raises `RunCancelled` when the caller has gone
    away, and raises `_StopEarly` once the deadline passes so the run ends with
    an honest partial result instead of being killed mid-step.
    """

    deadline: float | None = None
    on_progress: Callable[[dict], None] | None = None
    is_cancelled: Callable[[], bool] | None = None
    _last_emit: float = field(default=0.0, repr=False)

    def phase(self, name: str) -> None:
        """A stage boundary (reading, loading the model, computing): always reported."""
        if self.is_cancelled is not None and self.is_cancelled():
            raise RunCancelled()
        if self.on_progress is not None:
            self.on_progress({"phase": name, "step": None, "totalSteps": None})

    def tick(self, phase: str, step: int, total: int | None, **extra) -> None:
        if self.is_cancelled is not None and self.is_cancelled():
            raise RunCancelled()
        now = time.monotonic()
        if self.on_progress is not None and (now - self._last_emit >= 0.25 or step == total):
            self._last_emit = now
            self.on_progress({"phase": phase, "step": step, "totalSteps": total, **extra})
        if self.deadline is not None and now > self.deadline:
            raise _StopEarly(step)


def resolve_seed(raw) -> int:
    """Normalise and validate an RNG seed. Missing/empty -> DEFAULT_MD_SEED."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return DEFAULT_MD_SEED
    if isinstance(raw, bool):  # bool is an int subclass — reject explicitly
        raise ContractError("Invalid seed: expected a non-negative integer, got a boolean.",
                            code="invalid_number", field="seed")
    try:
        seed = int(raw)
    except (TypeError, ValueError):
        raise ContractError(f"Invalid seed: expected a non-negative integer, got {raw!r}.",
                            code="invalid_number", field="seed")
    if seed < 0:
        raise ContractError(f"Invalid seed: must be non-negative, got {seed}.",
                            code="invalid_number", field="seed")
    if seed > _CONTRACT["params"]["seed"]["max"]:
        raise ContractError(
            f"Invalid seed: must be at most {_CONTRACT['params']['seed']['max']}, got {seed}.",
            code="invalid_number", field="seed")
    return seed


def validate_calculation_type(raw) -> str:
    """
    Normalise and validate the requested calculation type.

    A missing/empty value defaults to "single-point" (the documented default).
    Any value that is present but not implemented raises rather than quietly
    running something else. Rules live in contract.json.
    """
    return contract.resolve_calculation_type(raw)


def validate_model_type(raw, has_model_path: bool) -> str:
    """
    Normalise and validate the requested model type; returns the canonical id.

    A value that is present but not in the registry raises rather than quietly
    loading a different model. A missing value defaults to "custom" when a
    checkpoint was uploaded and to the registry default (MACE-MPA-0, upstream's
    own default since v0.3.10) otherwise.

    "custom" with no uploaded checkpoint is rejected explicitly. That request
    used to fall through to mace_mp() and return MACE-MP-0 *medium* energies
    and forces with result["params"]["modelType"] == "custom" — numbers
    permanently attributed to a model that was never loaded.
    """
    return contract.resolve_model(raw, has_model_path)["id"]


def upstream_default_precision(model_type: str, calc_type: str) -> str:
    """
    The dtype upstream would have used, when the request does not pin one.

    Two facts from ACEsuit/mace (read at v0.3.16, confirmed against the
    installed 0.3.15):

    * `mace_off()` defaults to ``default_dtype="float64"``
      (foundations_models.py:209), unlike `mace_mp()`'s ``"float32"``. That
      difference is deliberate and has held since v0.3.6. Defaulting MACE-OFF
      to float32 inverts it. The registry records each model's upstream
      default as `upstreamDefaultDtype`.
    * Both wrappers print, at construction, on every run:
      "Using float32 for MACECalculator, which is faster but less accurate.
      Recommended for MD. Use float64 for geometry optimization."
      That recommendation is about geometry optimisation — which SimpleAtom
      implements — not about phonons, which it rejects.

    An explicit request is still honoured: upstream honours whatever
    `default_dtype` it is handed. When the effective value ends up below this
    recommendation, run_calculation() records a warning on the result rather
    than silently overriding the caller.
    """
    model = contract.find_model(model_type)
    if model is not None and model.get("upstreamDefaultDtype") == "float64":
        return "float64"
    if calc_type == "geometry-opt":
        return "float64"
    return "float32"


def resolve_precision(raw, model_type: str, calc_type: str) -> tuple[str, bool]:
    """
    Normalise and validate the requested precision.

    Returns (precision, was_explicitly_requested). A missing/empty value takes
    upstream's default for this model family and calculation type.
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return upstream_default_precision(model_type, calc_type), False

    if not isinstance(raw, str):
        raise ContractError(
            f"Invalid precision: expected a string, got {type(raw).__name__}. "
            f"Supported precisions: {', '.join(SUPPORTED_PRECISIONS)}.",
            code="unsupported_precision", field="precision",
        )

    precision = raw.strip()
    if precision not in SUPPORTED_PRECISIONS:
        raise ContractError(
            f"Unsupported precision '{precision}'. "
            f"Supported precisions: {', '.join(SUPPORTED_PRECISIONS)}.",
            code="unsupported_precision", field="precision",
        )
    return precision, True


class _WarningCollector(logging.Handler):
    """Collects log records instead of printing them."""

    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.messages: list[str] = []

    def emit(self, record):
        try:
            self.messages.append(record.getMessage())
        except Exception:  # pragma: no cover — never let logging break a run
            pass


@contextmanager
def capture_model_warnings():
    """
    Collect the warnings upstream emits while a calculator is being built.

    `MACECalculator` does not refuse a dtype mismatch — it converts the
    checkpoint with `model.float()` / `model.double()` and emits
    "Default dtype ... does not match model dtype ..., converting models to ..."
    through `logging.warning` (mace/calculators/mace.py:299-306). SimpleAtom
    used to run under `logging.disable(logging.CRITICAL)`, which made that
    conversion invisible. The records are now attached to the result.
    """
    collector = _WarningCollector()
    root = logging.getLogger()
    root.addHandler(collector)
    lowered = root.level > logging.WARNING
    if lowered:
        previous_level = root.level
        root.setLevel(logging.WARNING)
    try:
        yield collector
    finally:
        root.removeHandler(collector)
        if lowered:
            root.setLevel(previous_level)


def detect_calculator_dtype(calc) -> str | None:
    """
    Report the dtype the loaded model is actually running in.

    Required for the custom-checkpoint path, which deliberately does not pass
    `default_dtype` to `MACECalculator`; upstream then adopts the checkpoint's
    own dtype (mace/calculators/mace.py:293-298). Echoing the requested
    precision there would describe something that never happened.

    Returns None if the dtype cannot be determined (e.g. a calculator shape
    this function does not know how to walk).
    """
    candidates = [calc]
    mixer = getattr(calc, "mixer", None)
    if mixer is not None and hasattr(mixer, "calcs"):
        candidates.extend(mixer.calcs)
    elif hasattr(calc, "calcs"):
        candidates.extend(calc.calcs)

    for candidate in candidates:
        models = getattr(candidate, "models", None)
        if not models:
            continue
        try:
            for param in models[0].parameters():
                return str(param.dtype).rsplit(".", 1)[-1]
        except Exception:
            continue
    return None


def require_dispersion_backend() -> None:
    """
    Fail early, and by name, when D3 was asked for but its backend is missing.

    `mace_mp(dispersion=True)` builds a `TorchDFTD3Calculator`, which lives in
    the separate `torch-dftd` distribution — it is not a dependency of
    mace-torch. Upstream raises
    "Please install torch-dftd to use dispersion corrections"
    (foundations_models.py:176-180), but only *after* the MACE checkpoint has
    been downloaded and loaded, and the message names neither the requested
    option nor the fact that the rest of the run was thrown away.

    `torch-dftd` is now in requirements.txt, so a deployment built from it has
    the backend. This guard is for the environment that was built before that
    line existed: it turns a late RuntimeError from inside a third-party
    package into an immediate, actionable error.
    """
    try:
        import torch_dftd.torch_dftd3_calculator  # noqa: F401
    except Exception as exc:
        raise ValueError(
            "D3 dispersion was requested but the torch-dftd package is not "
            f"installed in this environment ({type(exc).__name__}: {exc}). "
            "D3 corrections come from torch-dftd, which is a separate "
            "distribution from mace-torch. Install it "
            "(`pip install torch-dftd`, or rebuild from mace-api/"
            "requirements.txt, where it is listed), or turn dispersion off. "
            "Nothing was computed."
        ) from exc


def dispersion_is_active(calc) -> bool:
    """
    True only when D3 was actually added to the calculator.

    `mace_mp()` returns a plain `MACECalculator` when ``dispersion=False`` and
    a ``SumCalculator([mace_calc, d3_calc])`` when it is on
    (foundations_models.py:303-324). `mace_off()` has no dispersion parameter
    at all, and the custom-checkpoint path never builds one. Checking the
    object that came back is the only honest way to report the flag.
    """
    return type(calc).__name__ == "SumCalculator"


def detect_format(filename: str) -> str:
    """Detect ASE file format from extension.

    `.xyz` maps to ASE's **extxyz** reader, not `xyz`. ASE's plain `xyz` reader
    (`simple_read_xyz`) discards the comment line entirely, which is where
    extended XYZ carries `Lattice="..."` and `pbc="T T T"`. Reading a periodic
    extended-XYZ file as `xyz` therefore produced an Atoms object with ZERO
    lattice vectors, and every crystal was computed as an isolated gas-phase
    cluster: FCC copper came out at -0.93 eV/atom against a correct
    -4.08 eV/atom, and the validator passed it as plausible because the number
    is not absurd on its own. It affected every periodic upload.

    `extxyz` is a strict superset for our purposes — verified on a free-text
    comment file, on the shipped demo structures, and on a periodic cell: it
    reads the first two identically to `xyz` and is the only one that recovers
    the cell from the third. `_read_structure` still falls back to `xyz` if the
    stricter parser rejects a file, so a malformed comment line degrades rather
    than failing the run.
    """
    name = Path(filename).name
    ext = Path(filename).suffix.lower()
    if ext in (".xyz", ".extxyz"):
        return "extxyz"
    if ext == ".cif":
        return "cif"
    if ext in (".poscar", ".vasp", ".contcar"):
        return "vasp"
    if ext == ".pdb":
        return "proteindatabank"
    # VASP's own convention is a bare file called POSCAR or CONTCAR. Those used
    # to fall through to the XYZ reader and fail on the first line.
    if name.upper() in _CONTRACT["bareStructureNames"]:
        return "vasp"
    return "xyz"


def resolve_device(requested) -> str:
    """Resolve compute device, falling back to CPU if CUDA is unavailable."""
    requested = contract.resolve_choice(requested, "device", _CONTRACT["devices"], "cpu")
    if requested == "cuda":
        try:
            import torch
            if not torch.cuda.is_available():
                return "cpu"
        except ImportError:
            return "cpu"
    return requested


def get_mace_calculator(model_type: str, model_size: str | None, device: str, dispersion: bool, precision: str = "float32"):
    """
    Return an ASE calculator for a MACE foundation model.

    There is no fall-through branch. An unrecognised model_type or size raises,
    so a caller that bypasses validate_model_type() cannot get MACE-MP results
    under a different label. The size is mapped through the registry to
    upstream's model key and is never handed to upstream as-is: mace_mp() and
    mace_off() treat any unknown string as a URL to download or a path to load.
    """
    model = contract.find_model(model_type)
    if model is None or model["loader"] not in ("mace_mp", "mace_off"):
        raise ContractError(
            f"No foundation-model loader for modelType '{model_type}'. "
            f"Supported models: {', '.join(SUPPORTED_MODEL_TYPES)}.",
            code="unsupported_model", field="modelType",
        )
    size = contract.resolve_model_size(model, model_size)
    upstream_key = contract.upstream_model_key(model, size)

    if model["loader"] == "mace_off":
        from mace.calculators import mace_off
        # Upstream's mace_off() has no `dispersion` parameter: MACE-OFF23 is
        # trained on wB97M-D3BJ data, so D3 is already in the model. Dropping
        # the flag here is the right physics; run_calculation() records that it
        # was dropped instead of echoing it back as if it had been applied.
        return mace_off(model=upstream_key, device=device, default_dtype=precision)

    from mace.calculators import mace_mp
    return mace_mp(model=upstream_key, device=device, dispersion=dispersion,
                   default_dtype=precision)


def get_custom_calculator(model_path: str, device: str):
    """Load a user-uploaded MACE model checkpoint."""
    from mace.calculators import MACECalculator

    if not Path(model_path).exists():
        raise ValueError(f"Model file not found: {model_path}")

    device = resolve_device(device)

    try:
        return MACECalculator(model_paths=model_path, device=device)
    except Exception as e:
        raise ValueError(
            f"Failed to load custom model '{Path(model_path).name}': {e}. "
            "Ensure the file is a valid MACE .model checkpoint."
        )


def extract_reference_data(atoms) -> dict:
    """Extract reference energy/forces from extended XYZ info/arrays."""
    ref = {}

    for key in ("REF_energy", "ref_energy", "energy", "dft_energy"):
        if key in atoms.info:
            try:
                ref["referenceEnergy"] = float(atoms.info[key])
                break
            except (TypeError, ValueError):
                pass

    for key in ("REF_forces", "ref_forces", "forces", "dft_forces"):
        if key in atoms.arrays:
            try:
                ref["referenceForces"] = atoms.arrays[key].tolist()
                break
            except Exception:
                pass

    return ref


def _build_result(atoms, energy, forces, msg, calc_start, ref_data,
                  effective_params, trajectory=None, warnings=None, manifest=None):
    """
    Assemble the standard JSON result dict.

    `effective_params` records what was ACTUALLY run (defaults filled in,
    device fallback applied, RNG seed used, dispersion reported only when a
    D3 calculator was really built, precision read back off the loaded model).
    It is echoed as result["params"] — declared on CalculationResult in
    types/mace.ts — so that a result is self-describing: the validator selects
    model-aware energy bounds from it, and a shared result carries enough
    information to be re-run.

    `warnings` are appended to the message as well as exposed as
    result["warnings"], because the message is the one field that survives
    everywhere a result travels (UI, PDF export, MACE Link).

    `manifest` is the reproducibility record from provenance.py — library
    versions and the SHA256 of the checkpoint file that was actually loaded.
    It is attached as result["provenance"], a NEW key: nothing existing is
    renamed or restructured, so every reader of this dict keeps working.
    """
    symbols = [a.symbol for a in atoms]
    lattice = atoms.get_cell().tolist() if atoms.pbc.any() else None
    warnings = list(warnings or [])

    properties = {"volume": float(atoms.get_volume()) if atoms.pbc.any() else None,
                  "stress": None, "pressure": None}
    # Stress and pressure only for a fully periodic cell (D6). For a molecule
    # or a slab the "volume" a stress would be divided by is a padding box
    # invented by the neighbour list, so the number is an artefact of that box
    # (upstream masks it for exactly this reason, ACEsuit/mace #1684). Voigt
    # order xx, yy, zz, yz, xz, xy; ASE's sign convention, so pressure is
    # minus the mean of the diagonal.
    if atoms.pbc.all():
        try:
            from ase import units
            stress_gpa = atoms.get_stress(voigt=True) / units.GPa
            properties["stress"] = [float(x) for x in stress_gpa]
            properties["pressure"] = float(-stress_gpa[:3].mean())
        except Exception as exc:  # noqa: BLE001 — a missing stress must not lose the result
            warnings.append(
                f"Stress could not be computed ({type(exc).__name__}: {exc}); "
                "pressure is not reported."
            )

    if warnings:
        msg = f"{msg} | Warnings: {' '.join(warnings)}"

    result = {
        "status": "success",
        "energy": float(energy),
        "forces": forces.tolist(),
        "positions": atoms.get_positions().tolist(),
        "symbols": symbols,
        "lattice": lattice,
        "properties": properties,
        "params": dict(effective_params),
        "message": msg,
        "timeTaken": round(time.time() - calc_start, 3),
    }
    if trajectory is not None:
        result["trajectory"] = trajectory
    if warnings:
        result["warnings"] = list(warnings)
    if manifest is not None:
        result["provenance"] = manifest
    result.update(ref_data)
    return result


_VALIDATION_POLICY = (
    "advisory — findings are reported alongside the result and are never used "
    "to reject a calculation that completed"
)

# Where validate_calculation.py may live, relative to this file. The validator
# is intentionally NOT duplicated into mace-api/ — one copy, found at runtime.
_VALIDATOR_CANDIDATES = (
    Path(__file__).resolve().parent.parent / "test_scripts" / "validate_calculation.py",
    Path(__file__).resolve().parent / "validate_calculation.py",
)

# Repo-relative names for the same paths. The "not found" reason is attached to
# a result and travels into MACE Links and PDF exports, so it must not publish
# the server's directory layout — same rule the manifest follows.
_VALIDATOR_SEARCH_DISPLAY = tuple(
    str(candidate).replace(str(Path(__file__).resolve().parent.parent) + "/", "")
    for candidate in _VALIDATOR_CANDIDATES
)

# (module | None, reason | None), resolved once per process.
_VALIDATOR_CACHE: tuple[object | None, str | None] | None = None


def _load_validator():
    """
    Load test_scripts/validate_calculation.py as a module, or explain why not.

    Loaded by path rather than by import name because it lives outside this
    directory and outside any package. It is also genuinely absent in the
    Docker image, whose build context is mace-api/ alone — that case has to
    read as "validation unavailable, here is why", never as a crash in a
    calculation that already succeeded.
    """
    global _VALIDATOR_CACHE
    if _VALIDATOR_CACHE is not None:
        return _VALIDATOR_CACHE

    import importlib.util

    for candidate in _VALIDATOR_CANDIDATES:
        if not candidate.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location(
                "simpleatom_validate_calculation", candidate
            )
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            if not hasattr(module, "validate_result"):
                _VALIDATOR_CACHE = (
                    None,
                    f"{candidate.name} has no validate_result() function",
                )
                return _VALIDATOR_CACHE
            _VALIDATOR_CACHE = (module, None)
            return _VALIDATOR_CACHE
        except Exception as exc:  # noqa: BLE001
            _VALIDATOR_CACHE = (None, f"{type(exc).__name__}: {exc}")
            return _VALIDATOR_CACHE

    _VALIDATOR_CACHE = (
        None,
        "validate_calculation.py not found (looked in: "
        + ", ".join(_VALIDATOR_SEARCH_DISPLAY)
        + "). The calculation is unaffected; it simply has no second opinion "
        "attached.",
    )
    return _VALIDATOR_CACHE


def attach_validation(result: dict) -> dict:
    """
    Run the scientific validator over a finished result and record its findings.

    ADVISORY, NEVER BLOCKING — deliberately. Two reasons.

    First, the validator's checks are plausibility heuristics with soft
    thresholds (max force > 50 eV/Å, net force > 0.1 eV/Å, minimum interatomic
    distance < 0.4 Å). Every one of them has a legitimate counterexample: a
    single-point on a deliberately strained or clashing geometry is a normal
    thing to ask MACE for, and it is exactly the case where the user most needs
    the number. Throwing away a completed calculation because a heuristic
    disliked it would be a worse failure than reporting it with a warning.

    Second, the checks that MUST block already do, earlier and elsewhere:
    validate_calculation_type(), validate_model_type(), resolve_precision() and
    resolve_seed() reject bad requests before any model is loaded. Those are
    the security boundary. This runs after the physics and is a second opinion
    on it, which is a different job.

    So: findings are attached to result["validation"], surfaced with the
    result, and never used to reject it. The one thing this must not do is
    fail — an exception inside the validator becomes status "unavailable" with
    the reason, leaving the calculation intact.
    """
    module, reason = _load_validator()
    if module is None:
        result["validation"] = {
            "status": "unavailable",
            "source": None,
            "policy": _VALIDATION_POLICY,
            "unavailableReason": reason,
        }
        return result

    try:
        findings = module.validate_result(result)
        param_findings = None
        if hasattr(module, "validate_params"):
            param_findings = module.validate_params(result.get("params", {}))
        result["validation"] = {
            "status": "ran",
            "source": Path(module.__file__).name,
            "policy": _VALIDATION_POLICY,
            "valid": bool(findings.get("valid", False)),
            "issues": list(findings.get("issues", [])),
            "warnings": list(findings.get("warnings", [])),
            "info": list(findings.get("info", [])),
            "params": param_findings,
            "unavailableReason": None,
        }
    except Exception as exc:  # noqa: BLE001 — see docstring: must never fail
        result["validation"] = {
            "status": "unavailable",
            "source": getattr(module, "__file__", None) and Path(module.__file__).name,
            "policy": _VALIDATION_POLICY,
            "unavailableReason": f"{type(exc).__name__}: {exc}",
        }
    return result


def _display_name(display_name: str | None, filepath: str) -> str:
    """
    The name a result should carry for its input file.

    Uploads are written to disk under a random name (a client-chosen filename
    must never become a path), so the original name travels separately. It is
    reduced to a bare basename and trimmed: it appears in messages, the
    provenance manifest, PDF exports and MACE Links.
    """
    name = Path(display_name or "").name.strip() if display_name else ""
    if not name:
        name = Path(filepath).name
    printable = "".join(ch for ch in name if ch.isprintable())
    return printable[:120] or "structure"


def _resolve_run_params(calc_type: str, params: dict, profile_name: str) -> dict:
    """
    Validate every calculation-specific parameter up front.

    Each value must be finite and inside contract.json's physical bounds, and
    step counts must fit this deployment's caps — all before a structure is
    read or a model is downloaded, so an out-of-range request costs nothing.
    """
    if calc_type == "geometry-opt":
        resolved = {
            "forceThreshold": float(contract.resolve_number(params, "forceThreshold")),
            "maxOptSteps": int(contract.resolve_number(params, "maxOptSteps")),
        }
        contract.check_step_cap("maxOptSteps", resolved["maxOptSteps"], profile_name)
        return resolved
    if calc_type == "molecular-dynamics":
        resolved = {
            "temperature": float(contract.resolve_number(params, "temperature")),
            "timeStep": float(contract.resolve_number(params, "timeStep")),
            "friction": float(contract.resolve_number(params, "friction")),
            "mdSteps": int(contract.resolve_number(params, "mdSteps")),
            # An unrecognised ensemble used to fall through to NVE and run
            # under the requested label.
            "mdEnsemble": contract.resolve_choice(
                params.get("mdEnsemble"), "mdEnsemble", _CONTRACT["mdEnsembles"], "NVT"),
        }
        if resolved["mdEnsemble"] == "NPT":
            resolved["pressure"] = float(contract.resolve_number(params, "pressure"))
        contract.check_step_cap("mdSteps", resolved["mdSteps"], profile_name)
        return resolved
    return {}


def _read_structure(filepath: str, display: str, warnings: list[str]):
    """
    Read the FIRST frame of a structure file.

    ase.io.read() with no index returns the LAST frame of a multi-frame file
    (ase/io/formats.py maps None to -1), while the UI previews the first — so
    a trajectory upload was computed on a different geometry from the one the
    user saw (D16). index=0 makes them agree.
    """
    from ase.io import read

    fmt = detect_format(filepath)
    try:
        atoms = read(filepath, format=fmt, index=0)
    except Exception as exc:
        # extxyz is stricter than the plain xyz reader: a malformed comment line
        # that simple_read_xyz would ignore can make it raise. Degrade to the
        # permissive reader rather than failing the run — the cost is losing any
        # cell the comment line declared, which is exactly what we had before.
        if fmt != "extxyz":
            raise ContractError(
                f"Could not read '{display}' as {fmt} ({type(exc).__name__}: {exc}).",
                code="unreadable_structure", field="structure",
            ) from exc
        try:
            atoms = read(filepath, format="xyz", index=0)
        except Exception as exc2:
            raise ContractError(
                f"Could not read '{display}' as XYZ ({type(exc2).__name__}: {exc2}).",
                code="unreadable_structure", field="structure",
            ) from exc2
        warnings.append(
            f"Could not parse '{display}' as extended XYZ "
            f"({type(exc).__name__}); fell back to the plain XYZ reader. Any "
            "Lattice/pbc declared on the comment line was ignored, so this was "
            "treated as a non-periodic structure."
        )
    if len(atoms) == 0:
        raise ContractError(f"'{display}' contains no atoms.",
                            code="unreadable_structure", field="structure")
    return atoms, fmt


def validate_request(params: dict, has_model_path: bool, profile_name: str) -> dict:
    """
    Every check that needs only the request, never the structure or a model.

    Raises ContractError for anything contract.json refuses. Used by
    run_calculation() and by the job queue (jobs.py), which refuses a bad
    request with a 4xx before it ever waits in line.
    """
    if has_model_path and not contract.custom_models_allowed(profile_name):
        raise ContractError(
            "Custom model checkpoints are disabled on this deployment. Loading a "
            "MACE .model file executes code from the file, so the public "
            "instance only runs pinned foundation models. Run SimpleAtom "
            "locally (or self-host with ALLOW_CUSTOM_MODELS=1) to use your own "
            "checkpoint. Nothing was computed.",
            code="custom_models_disabled", field="model", status=403,
        )
    calc_type = validate_calculation_type(params.get("calculationType"))
    requested_model = validate_model_type(params.get("modelType"), has_model_path)
    model_type = "custom" if has_model_path else requested_model
    model = contract.find_model(model_type)
    resolved = {
        "calc_type": calc_type,
        "requested_model": requested_model,
        "model_type": model_type,
        "model": model,
        "model_size": contract.resolve_model_size(model, params.get("modelSize")),
        "seed": resolve_seed(params.get("seed")),
        "run_params": _resolve_run_params(calc_type, params, profile_name),
        "device": resolve_device(params.get("device")),
        "dispersion_requested": contract.resolve_bool(params.get("dispersion"), "dispersion"),
    }
    resolved["precision"], resolved["precision_requested"] = resolve_precision(
        params.get("precision"), model_type, calc_type
    )
    return resolved


def run_calculation(filepath: str, params: dict, model_path: str | None = None, *,
                    profile: str | None = None, display_name: str | None = None,
                    hooks: RunHooks | None = None) -> dict:
    """
    Run a MACE calculation on a structure file.

    Args:
        filepath: Path to atomic structure file (XYZ, CIF, POSCAR, PDB).
        params: Calculation parameters dict (matches CalculationParams TS type).
        model_path: Optional path to a custom .model checkpoint.
        profile: Resource profile from contract.json ("hosted" or "local").
            Defaults to SIMPLEATOM_PROFILE, else "local".
        display_name: The uploaded file's original name, for messages and the
            manifest. The file on disk is deliberately named something else.
        hooks: Progress, cancellation and time-budget callbacks.

    Returns:
        Result dict with energy, forces, positions, trajectory, etc.

    Raises:
        ContractError (a ValueError) for any request contract.json refuses —
            an unsupported calculation, model, size, precision, ensemble or
            device; a non-boolean flag; a number out of range; a structure or
            run over this deployment's caps; a custom model where custom
            models are disabled. Nothing is computed in any of these cases.
        safe_load.UntrustedCheckpointError if a checkpoint fails its pin.
        RunCancelled if hooks report that the caller went away.
    """
    profile_name = profile or contract.profile_name("local")
    hooks = hooks or RunHooks()
    if hooks.deadline is None:
        budget = contract.profile(profile_name)["timeBudgetSeconds"]
        hooks.deadline = time.monotonic() + budget if budget else None

    # Validate first, before any expensive work (file I/O, model download and
    # load), so an unsupported request fails immediately and unambiguously.
    req = validate_request(params, bool(model_path), profile_name)
    calc_type, model_type, model = req["calc_type"], req["model_type"], req["model"]
    model_size, seed, run_params = req["model_size"], req["seed"], req["run_params"]
    device, dispersion_requested = req["device"], req["dispersion_requested"]
    precision, precision_requested = req["precision"], req["precision_requested"]

    # Declared before the structure is read: the extended-XYZ fallback below is
    # the first thing that can need to warn.
    warnings: list[str] = []

    if model_path and req["requested_model"] != "custom":
        warnings.append(
            f"A custom .model checkpoint was uploaded, so it was used instead of "
            f"the requested modelType '{req['requested_model']}'."
        )

    hooks.phase("reading-structure")
    filename = _display_name(display_name, filepath)
    atoms, fmt = _read_structure(filepath, filename, warnings)
    steps = run_params.get("maxOptSteps", run_params.get("mdSteps"))
    contract.check_atom_caps(len(atoms), calc_type, steps, profile_name)
    if run_params.get("mdEnsemble") == "NPT" and not atoms.pbc.all():
        raise ContractError(
            "NPT needs a fully periodic cell (pbc on all three axes): pressure is "
            "not defined for an isolated molecule or a slab. Use NVT or NVE, or "
            "upload a periodic structure. Nothing was computed.",
            code="npt_requires_periodic", field="mdEnsemble",
        )

    ref_data = extract_reference_data(atoms)

    hooks.phase("loading-model")
    # The only files this process will unpickle: pinned foundation
    # checkpoints, plus the uploaded one when this deployment allows it.
    trusted = safe_load.trusted_checkpoints(
        contract.allowed_checkpoint_sha256(),
        trusted_paths=(model_path,) if model_path else (),
    )

    # Watch torch.load across BOTH loader branches. "MACE-OFF small" names a
    # download URL, not a fixed set of weights; the file that torch.load
    # actually opens is the only reproducible identifier, and the manifest
    # hashes it below. Costs nothing when no checkpoint can be identified —
    # the manifest then records null and says so.
    with trusted, provenance.capture_checkpoint_loads() as checkpoints:
        if model_type == "custom":
            # `precision` is deliberately NOT passed to MACECalculator: upstream
            # then adopts the checkpoint's own dtype, which is the safest choice
            # for a fine-tuned model. The dtype actually in use is read back below.
            with capture_model_warnings() as collected:
                calc = get_custom_calculator(model_path, device)
            if precision_requested:
                warnings.append(
                    f"Requested precision '{precision}' was not applied: a custom "
                    f"checkpoint keeps the dtype it was saved in."
                )
        else:
            # Checked before the checkpoint is fetched and loaded: a missing D3
            # backend is a property of the environment, not of this structure, and
            # there is no reason to spend a model download to discover it. Only
            # the MACE-MP family reaches torch-dftd — the MACE-OFF and custom
            # paths drop the flag with a warning a few lines below, which is the
            # right physics.
            if dispersion_requested and model["dispersion"]["allowed"]:
                require_dispersion_backend()

            recommended = upstream_default_precision(model_type, calc_type)
            if precision_requested and precision == "float32" and recommended == "float64":
                # Honoured, not overridden — upstream honours whatever default_dtype
                # it is handed — but never left unsaid.
                warnings.append(
                    f"Running in float32. Upstream MACE recommends float64 here "
                    f"({'mace_off() defaults to float64' if model_type in MACE_OFF_MODEL_TYPES else 'float32 is recommended for MD, float64 for geometry optimization'}); "
                    f"float32 was explicitly requested, so it was used."
                )
            with capture_model_warnings() as collected:
                calc = get_mace_calculator(model_type, model_size, device,
                                           dispersion_requested, precision)

    atoms.calc = calc

    # Report the flag only if upstream actually built SumCalculator([mace, d3]).
    dispersion_active = dispersion_is_active(calc)
    if dispersion_requested and not dispersion_active:
        reason = model["dispersion"]["reason"] or "no D3 calculator was constructed"
        warnings.append(f"D3 dispersion was requested but NOT applied: {reason}")

    # Read the dtype off the loaded model rather than echoing the request.
    effective_precision = detect_calculator_dtype(calc)

    # Force torch's PROCESS-GLOBAL default dtype to agree with the model just
    # loaded, instead of trusting MACECalculator.__init__ to have done it. In
    # the long-lived server a previous request can leave the process on the
    # other dtype, and tensors built without an explicit dtype then come out
    # at the wrong precision with no error (also fixed upstream in #1659, which
    # is not in any release yet). One calculation at a time (main.py) is what
    # makes setting a global safe.
    if effective_precision in ("float32", "float64"):
        import torch
        wanted = torch.float64 if effective_precision == "float64" else torch.float32
        if torch.get_default_dtype() != wanted:
            torch.set_default_dtype(wanted)

    # Upstream's own warnings during model construction — notably the silent
    # checkpoint downcast — which used to be swallowed by logging.disable().
    for message in dict.fromkeys(collected.messages):
        warnings.append(f"MACE: {message}")

    # Record what actually ran, not what was requested: defaults are filled in
    # and `device` reflects the CUDA->CPU fallback. Only these known scientific
    # keys are echoed — the raw request dict is never reflected back, so an
    # arbitrary client payload cannot ride along in the result.
    effective_params = {
        "calculationType": calc_type,
        "modelType": model_type,
        "modelSize": model_size,
        "device": device,
        "dispersion": dispersion_active,
    }
    if model_type != "custom":
        effective_params["upstreamModel"] = contract.upstream_model_key(model, model_size)
        effective_params["license"] = model["license"]["id"]
    if effective_precision is not None:
        effective_params["precision"] = effective_precision
    elif model_type != "custom":
        effective_params["precision"] = precision
    if model_path:
        # Basename only — never echo the server-side temp path.
        effective_params["customModelName"] = _display_name(params.get("customModelName"), model_path)

    # ── Reproducibility manifest ────────────────────────────────────────────
    # MUST be built here, before dispatch: geometry-opt and MD move the atoms,
    # and input.structureSha256 has to identify the structure that was SUBMITTED,
    # not the one that came out. Building it after the run would produce a hash
    # that silently disagrees with the input file for two of the three
    # calculation types.
    checkpoint_path, checkpoint_resolved_by = checkpoints.select(
        model_path if model_type == "custom" else None,
        provenance.mace_cache_dir(),
    )
    try:
        manifest = provenance.build_manifest(
            model_type=model_type,
            model_size=None if model_type == "custom" else model_size,
            checkpoint_path=checkpoint_path,
            checkpoint_resolved_by=checkpoint_resolved_by,
            input_filename=filename,
            input_path=filepath,
            input_format=fmt,
            atoms=atoms,
            device=device,
            precision=effective_params.get("precision"),
            # Only MD consumes the seed. Reporting it for a single-point would
            # imply a stochastic step that never happened.
            seed=seed if calc_type == "molecular-dynamics" else None,
        )
    except Exception as exc:  # noqa: BLE001 — provenance must never break a run
        manifest = provenance.unavailable_manifest(f"{type(exc).__name__}: {exc}")

    hooks.phase("computing")
    calc_start = time.time()
    context = _RunContext(atoms=atoms, filename=filename, calc_start=calc_start,
                          ref_data=ref_data, effective_params=effective_params,
                          warnings=warnings, manifest=manifest, hooks=hooks,
                          profile_name=profile_name)

    if calc_type == "geometry-opt":
        result = _run_geometry_opt(context, run_params)
    elif calc_type == "molecular-dynamics":
        result = _run_md(context, run_params, seed)
    elif calc_type == "single-point":
        result = _run_single_point(context)
    else:
        # Unreachable — validate_calculation_type() gates this above. Kept as a
        # guard so that adding a type to SUPPORTED_CALCULATION_TYPES without a
        # handler fails loudly instead of silently returning a single-point result.
        raise ValueError(f"No handler implemented for calculationType '{calc_type}'")

    # A licence notice is not a warning about the result, so it travels in its
    # own field (shown with the result, in the PDF and on MACE Link) rather
    # than in `warnings`. MACE-OFF23 is ASL: non-commercial use only.
    if model["license"]["notice"]:
        result["licenseNotice"] = model["license"]["notice"]

    # Second opinion on the physics, attached to the result. Advisory only —
    # see attach_validation(). Runs last so it sees the final geometry, the
    # trajectory and the effective params.
    return attach_validation(result)


@dataclass
class _RunContext:
    atoms: object
    filename: str
    calc_start: float
    ref_data: dict
    effective_params: dict
    warnings: list
    manifest: dict | None
    hooks: RunHooks
    profile_name: str

    def build(self, energy, forces, msg, trajectory=None) -> dict:
        return _build_result(self.atoms, energy, forces, msg, self.calc_start,
                             self.ref_data, self.effective_params,
                             trajectory=trajectory, warnings=self.warnings,
                             manifest=self.manifest)

    def stopped_early(self, kind: str, at_step: int, total: int) -> None:
        budget = contract.profile(self.profile_name)["timeBudgetSeconds"]
        self.effective_params["stoppedEarly"] = {
            "reason": "time-budget", "atStep": at_step, "budgetSeconds": budget,
        }
        self.warnings.append(
            f"Stopped early: this deployment's {budget}-second time budget ran out "
            f"at {kind} step {at_step} of {total}. Everything reported is from the "
            f"steps that ran; run SimpleAtom locally for longer jobs."
        )


class _FrameRecorder:
    """
    Trajectory frames at a fixed stride, so the JSON stays inside budget.

    Scalar series and positions share one stride, so every array stays aligned
    with `step`. The final state is always recorded, whatever the stride.
    """

    def __init__(self, stride: int, series: tuple[str, ...]):
        self.stride = stride
        self.step: list[int] = []
        self.positions: list = []
        self.series = {name: [] for name in series}

    def _append(self, step: int, positions, values: dict) -> None:
        self.step.append(int(step))
        self.positions.append(positions.tolist())
        for name in self.series:
            self.series[name].append(float(values[name]))

    def offer(self, step: int, positions, **values) -> None:
        if step % self.stride == 0:
            self._append(step, positions, values)

    def finish(self, step: int, positions, **values) -> None:
        if not self.step or self.step[-1] != step:
            self._append(step, positions, values)


def _run_single_point(ctx: _RunContext):
    energy = ctx.atoms.get_potential_energy()
    forces = ctx.atoms.get_forces()
    msg = f"Calculation completed for {ctx.filename} using MACE"
    return ctx.build(energy, forces, msg)


def _max_force(forces) -> float:
    import numpy as np
    return float(np.linalg.norm(np.asarray(forces), axis=1).max()) if len(forces) else 0.0


def _run_geometry_opt(ctx: _RunContext, run_params: dict):
    from ase.optimize import BFGS

    atoms = ctx.atoms
    fmax = run_params["forceThreshold"]
    max_steps = run_params["maxOptSteps"]
    ctx.effective_params.update({"forceThreshold": fmax, "maxOptSteps": max_steps})

    stride = contract.trajectory_stride(len(atoms), max_steps, ctx.profile_name)
    frames = _FrameRecorder(stride, ("energies",))
    opt = BFGS(atoms, logfile=None)

    def on_step():
        # ASE calls observers once at nsteps == 0 (the initial geometry) and
        # once after every step, with nsteps already incremented
        # (ase/optimize/optimize.py Dynamics.irun). This used to ALSO record
        # step 0 by hand before run(), so every trajectory began with a
        # duplicated frame and labels one higher than the step they showed (D5).
        step = int(opt.nsteps)
        energy = float(atoms.get_potential_energy())
        frames.offer(step, atoms.get_positions(), energies=energy)
        ctx.hooks.tick("geometry-opt", step, max_steps, energy=energy,
                       fmax=_max_force(atoms.get_forces()))

    opt.attach(on_step)

    # ASE's Optimizer.run() returns True only if fmax was reached, and False
    # when `steps` was exhausted first (ase 3.27.0, Optimizer.run ->
    # Dynamics.run -> irun). Discarding that return value made a run that hit
    # the maxOptSteps ceiling indistinguishable from a converged one.
    stopped_at = None
    try:
        converged = bool(opt.run(fmax=fmax, steps=max_steps))
    except _StopEarly as stop:
        converged = False
        stopped_at = stop.step

    energy = atoms.get_potential_energy()
    forces = atoms.get_forces()
    final_fmax = _max_force(forces)
    frames.finish(int(opt.nsteps), atoms.get_positions(), energies=float(energy))

    ctx.effective_params.update({
        "converged": converged,
        "optSteps": int(opt.nsteps),
        "finalFmax": final_fmax,
    })
    if stride > 1:
        ctx.effective_params["trajectoryStride"] = stride

    if converged:
        msg = (
            f"Geometry optimization CONVERGED for {ctx.filename}: max force "
            f"{final_fmax:.4f} eV/Å is at or below the fmax target of {fmax} eV/Å, "
            f"reached in {opt.nsteps} of at most {max_steps} BFGS steps."
        )
    else:
        # Stated in the message, not only in params, because the message is
        # what survives PDF export and MACE Link sharing.
        limit = (f"the time budget after {opt.nsteps} BFGS steps" if stopped_at is not None
                 else f"the maxOptSteps limit of {max_steps}")
        msg = (
            f"Geometry optimization DID NOT CONVERGE for {ctx.filename}: stopped at "
            f"{limit} with max force {final_fmax:.4f} eV/Å, still above the fmax "
            f"target of {fmax} eV/Å. The reported geometry is NOT a relaxed minimum "
            f"— raise maxOptSteps or loosen forceThreshold and re-run."
        )
        if stopped_at is not None:
            ctx.stopped_early("BFGS", int(opt.nsteps), max_steps)
        ctx.warnings.append(
            f"Optimization not converged: {final_fmax:.4f} eV/Å > fmax {fmax} eV/Å "
            f"after {opt.nsteps}/{max_steps} steps."
        )

    trajectory = {
        "energies": frames.series["energies"],
        "positions": frames.positions,
        "step": frames.step,
    }
    result = ctx.build(energy, forces, msg, trajectory=trajectory)
    # Top-level too: convergence is an outcome, not a parameter.
    result["converged"] = converged
    if stopped_at is not None:
        result["stoppedEarly"] = ctx.effective_params["stoppedEarly"]
    return result


def kinetic_temperature(kinetic_energy_ev: float, dof: int) -> float:
    """Instantaneous kinetic temperature, K: T = 2·KE / (dof · k_B)."""
    from ase import units
    return 2.0 * kinetic_energy_ev / (dof * units.kB) if dof > 0 else 0.0


def _run_md(ctx: _RunContext, run_params: dict, seed: int):
    import numpy as np
    from ase import units
    from ase.md.velocitydistribution import MaxwellBoltzmannDistribution, Stationary

    atoms = ctx.atoms
    temp_K = run_params["temperature"]
    dt_fs = run_params["timeStep"]
    friction = run_params["friction"]
    md_steps = run_params["mdSteps"]
    ensemble = run_params["mdEnsemble"]

    # Degrees of freedom for the reported temperature (D8, D18).
    #
    # NVE and NPT: Stationary() below zeroes the centre-of-mass momentum and
    # both integrators conserve it, so 3 of the 3N degrees of freedom never
    # carry kinetic energy. ASE's get_temperature() divides by 3N regardless,
    # which read ~11% low for a 9-atom molecule.
    #
    # NVT: Langevin runs with fixcm=False (see below), so the thermostat
    # thermalises all 3N degrees of freedom, the centre-of-mass mode included,
    # and 3N is the right divisor. A single atom keeps 3 either way.
    n_atoms = len(atoms)
    dof = 3 * n_atoms if (ensemble == "NVT" or n_atoms == 1) else 3 * n_atoms - 3

    ctx.effective_params.update({
        "temperature": temp_K,
        "timeStep": dt_fs,
        "friction": friction,
        "mdSteps": md_steps,
        "mdEnsemble": ensemble,
        "seed": seed,
        "temperatureDegreesOfFreedom": dof,
    })
    if ensemble == "NPT":
        ctx.effective_params.update({
            "pressure": run_params["pressure"],
            "nptThermostatTimeFs": NPT_THERMOSTAT_TIME_FS,
            "nptBarostatTimeFs": NPT_BAROSTAT_TIME_FS,
            "nptBulkModulusGPa": NPT_BULK_MODULUS_GPA,
        })

    # Dedicated RNG stream so the run does not depend on (or disturb) numpy's
    # global random state. Feeds both stochastic sources in an MD run: the
    # initial Maxwell-Boltzmann velocities and the Langevin random forces.
    rng = np.random.default_rng(seed)

    stride = contract.trajectory_stride(n_atoms, md_steps, ctx.profile_name)
    frames = _FrameRecorder(
        stride, ("potentialEnergies", "kineticEnergies", "totalEnergies", "temperatures"))

    def frame_values():
        # Potential energy alone is not conserved in NVE — only PE + KE is. The
        # trajectory used to record PE and everything downstream called it
        # "total energy", which made the NVE conservation check impossible.
        potential = float(atoms.get_potential_energy())
        kinetic = float(atoms.get_kinetic_energy())
        return {
            "potentialEnergies": potential,
            "kineticEnergies": kinetic,
            "totalEnergies": potential + kinetic,
            "temperatures": kinetic_temperature(kinetic, dof),
        }

    def write_frame():
        step = int(dyn.get_number_of_steps())
        values = frame_values()
        frames.offer(step, atoms.get_positions(), **values)
        ctx.hooks.tick("molecular-dynamics", step, md_steps,
                       temperature=values["temperatures"], energy=values["totalEnergies"])

    # Initialize velocities at target temperature to avoid equilibration transient
    MaxwellBoltzmannDistribution(atoms, temperature_K=temp_K, rng=rng)

    # Drawing per-atom velocities independently leaves the system with a random
    # net linear momentum — for ethanol at seed 42 it was |p| = 1.45, carrying
    # 10.4% of the total kinetic energy as a rigid translation of the whole
    # system. That translation is not a thermal degree of freedom: it inflates
    # every reported temperature and, in NVE, it is a conserved lump of kinetic
    # energy that has nothing to do with the physics being measured.
    #
    # preserve_temperature is ASE's default (True) and is deliberately turned
    # OFF here. With it on, ASE zeroes the momentum and then rescales every
    # remaining velocity to restore the pre-removal temperature — the spurious
    # translational energy is not removed, it is redistributed into the 3N-3
    # internal modes, leaving them ~3N/(3N-3) hotter than the Maxwell-Boltzmann
    # draw asked for (12.5% for a 9-atom molecule). That would defeat the point
    # of the call. Off, the internal modes keep exactly the energy they were
    # drawn with, which is also the kinetic energy a zero-total-momentum system
    # should have at this temperature (3N-3 halves of kB*T).
    #
    # Applied for every ensemble. Zero total momentum is right for a periodic
    # cell too; ASE's NPT already does this for itself and logs it.
    Stationary(atoms, preserve_temperature=False)
    # NOT ZeroRotation(): net angular momentum is real physics for an isolated
    # molecule (a molecule at 300 K genuinely rotates), it does not translate
    # the system out of the viewing box, and it does not accumulate. Zeroing it
    # would silently remove 3 thermal degrees of freedom the user asked for.
    # It is also meaningless for a periodic cell — the cell fixes the frame, so
    # subtracting a rigid rotation from the contents is not a symmetry
    # operation — and this backend cannot tell the two cases apart from the
    # ensemble alone.
    ctx.effective_params["comMomentumRemoved"] = True

    if ensemble == "NVT":
        from ase.md.langevin import Langevin
        # fixcm=False, deliberately (D18). ASE's default fixcm=True removes the
        # centre-of-mass part of the random kick as P/(m_i·N) per atom and then
        # rescales by sqrt(N/(N-1)) — exact only when every atom has the same
        # mass. For a mixed-mass molecule it overheats the light atoms: ethanol
        # with MACE-OFF at a 300 K target equilibrated at 417 K (3N-3 kinetic
        # temperature, 2 ps, ase 3.27.0), against 298.5 K over 3N with
        # fixcm=False. The cost is that the molecule's centre of mass now
        # diffuses as Brownian motion in the implicit bath, which is physical.
        dyn = Langevin(atoms, dt_fs * units.fs, temperature_K=temp_K,
                       friction=friction / units.fs, rng=rng, fixcm=False)
    elif ensemble == "NPT":
        # ase.md.npt.NPT is a deprecated alias of MelchionnaNPT (ASE 3.27).
        from ase.md.melchionna import MelchionnaNPT
        pressure_eVA3 = run_params["pressure"] * units.GPa
        dyn = MelchionnaNPT(
            atoms, dt_fs * units.fs, temperature_K=temp_K,
            externalstress=pressure_eVA3,
            ttime=NPT_THERMOSTAT_TIME_FS * units.fs,
            pfactor=(NPT_BAROSTAT_TIME_FS * units.fs) ** 2 * NPT_BULK_MODULUS_GPA * units.GPa,
        )
    elif ensemble == "NVE":
        from ase.md.verlet import VelocityVerlet
        dyn = VelocityVerlet(atoms, dt_fs * units.fs)
    else:  # unreachable — _resolve_run_params() allow-lists the ensemble
        raise ValueError(f"No integrator for mdEnsemble '{ensemble}'")

    dyn.attach(write_frame, interval=1)
    stopped_at = None
    try:
        dyn.run(md_steps)
    except _StopEarly as stop:
        stopped_at = stop.step

    done = int(dyn.get_number_of_steps())
    frames.finish(done, atoms.get_positions(), **frame_values())
    if stride > 1:
        ctx.effective_params["trajectoryStride"] = stride
    if stopped_at is not None:
        ctx.stopped_early("MD", done, md_steps)

    energy = atoms.get_potential_energy()
    forces = atoms.get_forces()
    # The seed is stated in the message as well as in result["params"] because
    # the message survives everywhere a result travels (UI, PDF export, MACE
    # Link), so a shared trajectory always carries what is needed to re-run it.
    # The energy budget is stated there for the same reason: NVE conservation
    # is a claim a reader should be able to check without the raw arrays.
    ran = f"{done} of {md_steps} steps" if stopped_at is not None else f"{md_steps} steps"
    msg = f"MD ({ensemble}) completed for {ctx.filename} ({ran}, seed={seed})"
    totals = frames.series["totalEnergies"]
    temps = frames.series["temperatures"]
    if totals:
        drift = totals[-1] - totals[0]
        mean_temp = sum(temps) / len(temps)
        msg += (
            f". Total energy (potential + kinetic) {totals[0]:.4f} → "
            f"{totals[-1]:.4f} eV, drift {drift:+.4f} eV; mean temperature "
            f"{mean_temp:.1f} K ({dof} degrees of freedom)"
        )

    trajectory = {
        # `energies` keeps its existing meaning — the POTENTIAL energy per
        # frame — so nothing that already reads it changes under its feet.
        # Read the explicit keys instead: an NVE conservation check needs
        # `totalEnergies`, which was never recorded before.
        "energies": frames.series["potentialEnergies"],
        "potentialEnergies": frames.series["potentialEnergies"],
        "kineticEnergies": frames.series["kineticEnergies"],
        "totalEnergies": totals,
        "temperatures": temps,
        "positions": frames.positions,
        "step": frames.step,
    }
    result = ctx.build(energy, forces, msg, trajectory=trajectory)
    if stopped_at is not None:
        result["stoppedEarly"] = ctx.effective_params["stoppedEarly"]
    return result
