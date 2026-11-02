"""
Calculation manifest — the audit trail attached to every result.

The question this module answers is: *can a third party reproduce and verify
any number this app displays, months later, without asking us?*

"MACE-OFF small" is not a reproducible identifier. It names a download URL
whose contents can change, is resolved through a cache whose filenames are
sometimes opaque (`~/.cache/mace/5yyxdm76`), and says nothing about the
mace-torch / torch / ASE versions that turned those weights into a number.
Upstream publishes no checksums for the foundation-model weights, so the only
way to pin which weights produced a result is to hash the file that was
actually loaded.

That is what this module records, as `result["provenance"]`:

    schemaVersion   bump when the shape changes
    timestampUtc    when the run finished being set up
    model           family, size, and the SHA256 of the checkpoint file that
                    torch.load() actually opened — not the requested name
    packages        mace-torch, torch, ase, numpy versions
    input           filename, format, SHA256 of the file bytes, and a
                    format-independent SHA256 of the parsed structure
    runtime         device, precision, MD seed, python, platform
    code            git commit of the checkout, and whether it was dirty
    paramsRef       pointer to result["params"], which already carries the
                    effective parameters — they are not duplicated here
    notes           one line for every field that came back null, saying why

Three rules this module holds to:

1. **Never fabricate.** Every field is either a measured value or `null` with
   a matching entry in `notes`. A plausible-looking hash is worse than no hash.
2. **Never cost anything.** Hashing a 134 MB checkpoint takes ~0.06 s and a
   7 MB one ~0.003 s, against a multi-second MACE run. Results are cached per
   process, keyed on (path, size, mtime), so a repeat run in the FastAPI
   server pays nothing at all.
3. **Never leak a server path.** Only basenames are recorded. A manifest
   travels into shared MACE Links and PDF exports; `/Users/<name>/.cache/...`
   does not belong in either. This follows the rule `calculate.py` already
   applies to `customModelName`.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

# Bump when the manifest shape changes in a way a reader must notice.
PROVENANCE_SCHEMA_VERSION = 1

# Distribution names (not import names) whose versions decide a MACE number.
# mace-torch and torch set the model's arithmetic; ase drives the optimizer and
# the integrator; numpy seeds the MD RNG.
TRACKED_DISTRIBUTIONS = ("mace-torch", "torch", "ase", "numpy")

# Canonical-form tag for the structure fingerprint. Changing how the structure
# is serialised changes every hash, so the spec is versioned and echoed into
# the manifest — a reader can tell which recipe produced the digest.
# v2 (D132): constraints (POSCAR selective dynamics) are part of the input —
# they change the reported forces and the MD temperature — so they are hashed.
# v3 (D76): coordinates and cell count to 8 decimals, the precision ASE's extended
# XYZ writer keeps, so the same structure hashes alike as extxyz, CIF and POSCAR.
STRUCTURE_HASH_SPEC = "simpleatom-structure-v3"

# Coordinates are rounded before hashing so that a round-trip through a text
# format (which is how structures reach this backend) does not change the
# digest. 8 decimals is what ASE writes to extended XYZ, the most common upload
# (D76); 1e-8 A is still far below any physically meaningful displacement.
_STRUCTURE_COORD_DECIMALS = 8

_HASH_CHUNK_BYTES = 1 << 20  # 1 MiB


# ── file hashing ────────────────────────────────────────────────────────────

# (realpath, size, mtime_ns) -> sha256. Keyed on the stat tuple rather than the
# path alone: a checkpoint that is replaced in place must not keep serving the
# old digest for the life of the process.
_FILE_HASH_CACHE: dict[tuple[str, int, int], str] = {}


def file_sha256(path: str | os.PathLike) -> tuple[str | None, str | None]:
    """
    SHA256 of a file's bytes. Returns (digest, error) — exactly one is None.

    Cached per process on (realpath, size, mtime_ns), so the second run of the
    same model in a long-lived server does no I/O.
    """
    try:
        resolved = os.path.realpath(str(path))
        stat = os.stat(resolved)
        key = (resolved, stat.st_size, stat.st_mtime_ns)
        cached = _FILE_HASH_CACHE.get(key)
        if cached is not None:
            return cached, None

        digest = hashlib.sha256()
        with open(resolved, "rb") as handle:
            for chunk in iter(lambda: handle.read(_HASH_CHUNK_BYTES), b""):
                digest.update(chunk)
        hexdigest = digest.hexdigest()
        _FILE_HASH_CACHE[key] = hexdigest
        return hexdigest, None
    except Exception as exc:  # noqa: BLE001 — provenance must never break a run
        return None, f"{type(exc).__name__}: {exc}"


def file_size(path: str | os.PathLike) -> int | None:
    try:
        return int(os.path.getsize(str(path)))
    except Exception:  # noqa: BLE001
        return None


# ── which checkpoint file was actually loaded ───────────────────────────────

class CheckpointRecorder:
    """
    Records the paths `torch.load()` opened while a calculator was built.

    `MACECalculator` does not keep the path it loaded from — its attributes are
    `models`, `model_type`, `num_models`. Upstream *prints* the path to stdout,
    which is not a contract worth parsing. But every loader route
    (`mace_mp()`, `mace_off()`, and the custom-checkpoint path) converges on
    the same line inside `MACECalculator.__init__`:

        self.models = [torch.load(f=model_path, map_location=device) for ...]

    so watching `torch.load` catches the file that was really opened,
    regardless of how the request named it. Re-deriving the cache path from the
    requested size would instead reproduce upstream's URL-to-filename logic and
    silently go stale when upstream changes it.
    """

    def __init__(self) -> None:
        self.paths: list[str] = []

    def record(self, candidate) -> None:
        if candidate is None:
            return
        try:
            text = os.fspath(candidate)
        except TypeError:
            return  # a file object or BytesIO — not a path, nothing to hash
        if not isinstance(text, str) or not os.path.isfile(text):
            return
        if text not in self.paths:
            self.paths.append(text)

    def select(self, explicit_path: str | None, cache_dir: str | None) -> tuple[str | None, str]:
        """
        Pick the MACE checkpoint out of everything torch.load() touched.

        Returns (path, resolved_by). `path` is None when no candidate can be
        identified with confidence, and `resolved_by` then explains why.

        Other libraries call torch.load during the same window — e3nn loads its
        Wigner `constants.pt` on first import, inside the calculator
        construction. Guessing "the last one" would sometimes hash the wrong
        file and stamp a confident-looking digest onto a result. Each rule
        below is an identification, not a guess, and the rule that fired is
        recorded in the manifest.
        """
        if not self.paths:
            return None, "no-torch-load-observed"

        if explicit_path:
            wanted = os.path.realpath(explicit_path)
            for path in self.paths:
                if os.path.realpath(path) == wanted:
                    return path, "explicit-model-path"

        if cache_dir:
            cache_root = os.path.realpath(cache_dir)
            in_cache = [
                p for p in self.paths
                if os.path.realpath(p).startswith(cache_root + os.sep)
            ]
            if len(in_cache) == 1:
                return in_cache[0], "mace-cache-dir"
            if len(in_cache) > 1:
                return None, f"ambiguous-{len(in_cache)}-files-in-mace-cache"

        by_suffix = [p for p in self.paths if p.endswith(".model")]
        if len(by_suffix) == 1:
            return by_suffix[0], "model-suffix"
        if len(by_suffix) > 1:
            return None, f"ambiguous-{len(by_suffix)}-model-files"

        return None, f"unidentified-among-{len(self.paths)}-loaded-files"


@contextmanager
def capture_checkpoint_loads():
    """
    Watch `torch.load` for the duration of calculator construction.

    Wraps whatever `torch.load` currently is — `calculate_local.py` and
    `main.py` have already replaced it with a `weights_only=False` shim — and
    restores that exact object on the way out, including when the calculator
    fails to load. Yields a no-op recorder if torch cannot be imported, so a
    caller never has to branch on it.

    Save/restore is correct for nesting (strict LIFO). It assumes calculations
    do not overlap in one process, which holds today: the CLI runs one
    calculation per process, and main.py's `async def` endpoint calls
    run_calculation synchronously, so requests serialise on the event loop.
    Moving that call to a threadpool would need a lock here.
    """
    recorder = CheckpointRecorder()
    try:
        import torch
    except Exception:  # noqa: BLE001
        yield recorder
        return

    previous = torch.load

    def watched(*args, **kwargs):
        recorder.record(kwargs.get("f", args[0] if args else None))
        return previous(*args, **kwargs)

    torch.load = watched
    try:
        yield recorder
    finally:
        torch.load = previous


def mace_cache_dir() -> str | None:
    """MACE's checkpoint cache directory, or None if it cannot be resolved."""
    try:
        from mace.calculators.foundations_models import get_cache_dir

        return str(get_cache_dir())
    except Exception:  # noqa: BLE001
        fallback = Path.home() / ".cache" / "mace"
        return str(fallback) if fallback.is_dir() else None


# ── library versions ────────────────────────────────────────────────────────

_PACKAGE_VERSIONS: dict[str, str | None] | None = None


def package_versions() -> dict[str, str | None]:
    """
    Installed versions of the distributions that decide the numbers.

    Read from installed distribution metadata rather than from module
    `__version__` attributes, so nothing has to be imported to be reported and
    a package missing from the environment reads as null instead of raising.
    Resolved once per process.
    """
    global _PACKAGE_VERSIONS
    if _PACKAGE_VERSIONS is not None:
        return dict(_PACKAGE_VERSIONS)

    from importlib import metadata

    versions: dict[str, str | None] = {}
    for dist in TRACKED_DISTRIBUTIONS:
        try:
            versions[dist] = metadata.version(dist)
        except Exception:  # noqa: BLE001
            versions[dist] = None
    _PACKAGE_VERSIONS = versions
    return dict(versions)


# ── structure identity ──────────────────────────────────────────────────────

def structure_canonical_bytes(atoms) -> bytes:
    """
    Format-independent canonical serialisation of a structure.

    The same atoms, cell, pbc and constraints produce the same bytes whatever
    file carried them (extended XYZ, CIF and POSCAR, Cartesian or direct) and
    whatever the temp file was called, so the digest identifies the structure,
    not the file. It is not more forgiving than that (D76): positions count to
    8 decimals, so a PDB (3 decimals) matches only coordinates that agree at
    that precision, and a molecule written as CIF gains a cell and periodicity,
    which makes it a different input. test_provenance.TestStructureHashAcrossFormats.

    Atom order is deliberately significant: forces are returned per atom in
    input order, so two orderings are genuinely different inputs.
    """
    import numpy as np

    fmt = f"%.{_STRUCTURE_COORD_DECIMALS}f"

    def num(value: float) -> str:
        # Round to the printed precision first, then `+ 0.0`: a coordinate of
        # -1e-12 rounds to -0.0, and IEEE-754 gives -0.0 + 0.0 == +0.0. Without
        # the rounding it printed as "-0.0000000000" from one format and
        # "0.0000000000" from another, so hcp and wurtzite cells hashed
        # differently as POSCAR and as CIF (D76).
        return fmt % (round(float(value), _STRUCTURE_COORD_DECIMALS) + 0.0)

    lines = [STRUCTURE_HASH_SPEC, str(len(atoms))]
    lines.append(" ".join("1" if flag else "0" for flag in atoms.pbc))
    for row in np.asarray(atoms.get_cell()):
        lines.append(" ".join(num(v) for v in row))
    for symbol, position in zip(atoms.get_chemical_symbols(), atoms.get_positions()):
        lines.append(f"{symbol} " + " ".join(num(v) for v in position))
    # One line per constraint, from ASE's own serialisation, sorted so the
    # order they were attached in does not matter. None: no extra lines.
    lines.extend(sorted("constraint " + json.dumps(_plain(c.todict()), sort_keys=True)
                        for c in atoms.constraints))
    return ("\n".join(lines) + "\n").encode("utf-8")


def _plain(value):
    """numpy arrays and scalars inside a constraint's todict(), as JSON-able Python."""
    import numpy as np
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, np.ndarray):
        return _plain(value.tolist())
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, float):
        return float(f"{value + 0.0:.10f}")
    return value


def structure_sha256(atoms) -> tuple[str | None, str | None]:
    """SHA256 of the canonical structure form. Returns (digest, error)."""
    try:
        return hashlib.sha256(structure_canonical_bytes(atoms)).hexdigest(), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


# ── source revision ─────────────────────────────────────────────────────────

_GIT_INFO: dict | None = None


def _pinned_commit() -> str | None:
    """
    Fallback for containers that have no git checkout at all.

    The deploy step (.github/workflows/deploy-hf-space.yml) resolves the SHA
    it is pushing and writes it into this plain file next to the module,
    since the deployed image has neither a `.git` directory nor a `git`
    binary. A file written at deploy time still names the exact commit that
    was pushed, so this is not a fabrication — it just moves *when* the SHA
    is captured from "container runtime" to "deploy time".
    """
    try:
        sha = (Path(__file__).resolve().parent / "GIT_COMMIT").read_text().strip()
    except OSError:
        return None
    return sha or None


def git_info() -> dict:
    """
    Commit of the checkout this backend is running from.

    `dirty` is reported alongside, because a commit SHA taken from a modified
    working tree names code that was never run. When the dirty state cannot be
    determined it is null, not False — an unchecked tree is not a clean tree.
    Deployed containers have no `.git` and no `git` binary; when the live git
    lookup is unavailable, `_pinned_commit()` supplies a SHA baked in at
    deploy time instead, and `dirty` stays null because that can't be
    checked after the fact. Resolved once per process.
    """
    global _GIT_INFO
    if _GIT_INFO is not None:
        return dict(_GIT_INFO)

    repo_root = str(Path(__file__).resolve().parent.parent)

    def run(args: list[str]):
        return subprocess.run(
            ["git", "-C", repo_root, *args],
            capture_output=True, text=True, timeout=10, check=False,
        )

    info: dict = {"commit": None, "dirty": None, "unavailableReason": None}
    try:
        head = run(["rev-parse", "HEAD"])
        if head.returncode != 0:
            info["unavailableReason"] = (
                (head.stderr or "git rev-parse HEAD failed").strip().splitlines()[0]
            )
        else:
            info["commit"] = head.stdout.strip() or None

            # Tracked files only: untracked files (node_modules, caches, editor
            # scratch) are not part of what ran and would make every checkout dirty.
            status = run(["status", "--porcelain", "--untracked-files=no"])
            if status.returncode == 0:
                info["dirty"] = bool(status.stdout.strip())
            else:
                info["unavailableReason"] = "dirty state could not be determined"
    except Exception as exc:  # noqa: BLE001 — includes git-not-installed, timeout
        info["unavailableReason"] = f"{type(exc).__name__}: {exc}"

    if info["commit"] is None:
        pinned = _pinned_commit()
        if pinned is not None:
            info = {"commit": pinned, "dirty": None, "unavailableReason": None,
                    "dirtyUnknownReason": (
                        "the commit was read from the GIT_COMMIT file written at deploy "
                        "time, and the deployed container has no git working tree to check")}

    _GIT_INFO = info
    return dict(info)


# ── manifest assembly ───────────────────────────────────────────────────────

def build_manifest(
    *,
    model_type: str,
    model_size: str | None,
    checkpoint_path: str | None,
    checkpoint_resolved_by: str,
    input_filename: str,
    input_path: str | None,
    input_format: str | None,
    atoms,
    device: str,
    precision: str | None,
    seed: int | None,
) -> dict:
    """
    Assemble the manifest. Never raises; unresolvable fields become null and
    gain a line in `notes` saying why.

    The effective parameters are NOT copied in here — they already live in
    `result["params"]`, resolved and echoed by `_build_result()`. `paramsRef`
    points at them so the two can never disagree.
    """
    notes: list[str] = []

    # -- model ---------------------------------------------------------------
    checkpoint: dict = {
        "filename": None,
        "sizeBytes": None,
        "sha256": None,
        "resolvedBy": checkpoint_resolved_by,
    }
    if checkpoint_path:
        # Basename only. The manifest travels into MACE Links and PDF exports;
        # an absolute path there leaks the server's directory layout and the
        # OS user's name, and identifies nothing a hash does not identify better.
        checkpoint["filename"] = os.path.basename(checkpoint_path)
        checkpoint["sizeBytes"] = file_size(checkpoint_path)
        digest, error = file_sha256(checkpoint_path)
        checkpoint["sha256"] = digest
        if digest is None:
            notes.append(
                f"model.checkpoint.sha256 is null: could not read "
                f"{checkpoint['filename']} ({error})."
            )
    else:
        notes.append(
            "model.checkpoint.sha256 is null: the checkpoint file that was "
            f"loaded could not be identified ({checkpoint_resolved_by}). The "
            "model name alone does not pin the weights, so this result cannot "
            "be reproduced exactly."
        )

    # -- packages ------------------------------------------------------------
    packages = package_versions()
    missing = [name for name, version in packages.items() if version is None]
    if missing:
        notes.append(
            "packages "
            + ", ".join(missing)
            + " are null: no installed distribution metadata was found for them."
        )

    # -- input ---------------------------------------------------------------
    structure_digest, structure_error = structure_sha256(atoms)
    if structure_digest is None:
        notes.append(f"input.structureSha256 is null: {structure_error}.")

    file_digest = None
    if input_path:
        file_digest, file_error = file_sha256(input_path)
        if file_digest is None:
            notes.append(f"input.fileSha256 is null: {file_error}.")
    else:
        notes.append("input.fileSha256 is null: no input file path was supplied.")

    try:
        formula = atoms.get_chemical_formula()
        n_atoms = len(atoms)
    except Exception:  # noqa: BLE001
        formula, n_atoms = None, None

    # -- code ----------------------------------------------------------------
    git = git_info()
    if git["commit"] is None:
        notes.append(
            "code.gitCommit is null: "
            + (git["unavailableReason"] or "no git checkout was found")
            + "."
        )
    elif git["dirty"]:
        notes.append(
            "code.gitDirty is true: the checkout had uncommitted changes to "
            "tracked files, so the commit alone does not describe the code "
            "that ran."
        )
    elif git["dirty"] is None:
        # D49: every other null in the manifest says why; this one did not.
        notes.append(
            "code.gitDirty is null: "
            + (git.get("dirtyUnknownReason") or git.get("unavailableReason")
               or "the dirty state could not be determined")
            + "."
        )

    manifest = {
        "schemaVersion": PROVENANCE_SCHEMA_VERSION,
        "timestampUtc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "model": {
            "type": model_type,
            "size": model_size,
            "checkpoint": checkpoint,
        },
        "packages": packages,
        "input": {
            "filename": input_filename,
            "format": input_format,
            "nAtoms": n_atoms,
            "formula": formula,
            "fileSha256": file_digest,
            "structureSha256": structure_digest,
            "structureHashSpec": STRUCTURE_HASH_SPEC,
        },
        "runtime": {
            "device": device,
            "precision": precision,
            "seed": seed,
            "python": platform.python_version(),
            "platform": platform.platform(terse=True),
            "executable": os.path.basename(sys.executable),
        },
        "code": {
            "gitCommit": git["commit"],
            "gitDirty": git["dirty"],
        },
        # The effective parameters are not duplicated here — see docstring.
        "paramsRef": "result.params",
        "notes": notes,
    }
    return manifest


def unavailable_manifest(reason: str) -> dict:
    """
    A manifest for the case where building one failed outright.

    Same shape, everything null, one note. A result whose provenance block says
    "I could not be built, here is why" is honest; a result with no provenance
    block at all is indistinguishable from one produced before this existed.
    """
    return {
        "schemaVersion": PROVENANCE_SCHEMA_VERSION,
        "timestampUtc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "model": {"type": None, "size": None,
                  "checkpoint": {"filename": None, "sizeBytes": None,
                                 "sha256": None, "resolvedBy": "manifest-failed"}},
        "packages": {name: None for name in TRACKED_DISTRIBUTIONS},
        "input": {"filename": None, "format": None, "nAtoms": None, "formula": None,
                  "fileSha256": None, "structureSha256": None,
                  "structureHashSpec": STRUCTURE_HASH_SPEC},
        "runtime": {"device": None, "precision": None, "seed": None,
                    "python": platform.python_version(), "platform": None,
                    "executable": None},
        "code": {"gitCommit": None, "gitDirty": None},
        "paramsRef": "result.params",
        "notes": [f"The manifest could not be built: {reason}."],
    }
