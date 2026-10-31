"""
Load MACE checkpoints without unpickling anything we did not choose to trust.

A MACE `.model` file is a pickled `torch.nn.Module`. PyTorch 2.6+ refuses to
unpickle arbitrary objects (`torch.load(weights_only=True)` is the default), so
upstream MACE only works with that check switched off. SimpleAtom used to
switch it off for the whole process — every `torch.load`, from every library,
for every file. Combined with an unvalidated `modelSize` (which upstream treats
as a URL or a path) and a public custom-model upload, that let any caller make
the server unpickle a file of their choosing.

`trusted_checkpoints()` replaces that patch with a scoped one, active only
while a calculator is being built:

* a file whose SHA-256 is in the registry's allow-list (the pinned foundation
  checkpoints in contract.json) loads with `weights_only=False`;
* a file passed explicitly in `trusted_paths` — an uploaded checkpoint, which
  the caller only passes when the deployment allows custom models — likewise;
* anything that looks like a model checkpoint (a `.model` file, or any file in
  MACE's download cache) and is NOT trusted is refused before it is opened;
* everything else (e.g. e3nn's `constants.pt`, plain tensors) is loaded with
  `weights_only=True`, whatever the caller asked for.

A changed or corrupted upstream download therefore fails loudly with its
digest instead of being deserialised (docs/adr/0020).

Note on upstream: importing `mace` sets TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 for
the whole process (mace/__init__.py:5 and mace/calculators/mace.py:15 at
0.3.15), which makes every later `torch.load` call that does not pass
`weights_only` explicitly unpickle anything. That variable only applies when the
argument is omitted, so this guard always passes it explicitly — that is what
keeps it in force after the import.
"""

from __future__ import annotations

import os
from contextlib import contextmanager

import provenance


class UntrustedCheckpointError(ValueError):
    """A checkpoint was about to be unpickled without being trusted."""

    status = 400
    code = "untrusted_checkpoint"
    field = "model"


def _as_path(candidate) -> str | None:
    if candidate is None:
        return None
    try:
        text = os.fspath(candidate)
    except TypeError:
        return None  # a file object or BytesIO — never a trusted checkpoint
    return text if isinstance(text, str) and os.path.isfile(text) else None


def _looks_like_checkpoint(path: str, cache_root: str | None) -> bool:
    if path.endswith(".model"):
        return True
    if cache_root:
        return os.path.realpath(path).startswith(cache_root + os.sep)
    return False


@contextmanager
def trusted_checkpoints(allowed_sha256, trusted_paths=()):
    """Scope a permissive `torch.load` to allow-listed checkpoints only."""
    import torch

    allowed = frozenset(allowed_sha256)
    trusted_real = {os.path.realpath(p) for p in trusted_paths if p}
    cache_dir = provenance.mace_cache_dir()
    cache_root = os.path.realpath(cache_dir) if cache_dir else None
    previous = torch.load

    def guarded(*args, **kwargs):
        target = kwargs.get("f", args[0] if args else None)
        path = _as_path(target)
        if path is not None:
            real = os.path.realpath(path)
            digest, _error = provenance.file_sha256(real)
            if real in trusted_real or (digest is not None and digest in allowed):
                kwargs["weights_only"] = False
                return previous(*args, **kwargs)
            if _looks_like_checkpoint(path, cache_root):
                raise UntrustedCheckpointError(
                    f"Refusing to load '{os.path.basename(path)}': its SHA-256 "
                    f"({digest or 'unreadable'}) does not match any pinned "
                    "foundation checkpoint, and loading a MACE checkpoint "
                    "executes code from the file. If upstream re-published the "
                    "model, update its sha256 in mace-api/contract.json after "
                    "verifying the new file. Nothing was computed."
                )
        kwargs["weights_only"] = True
        return previous(*args, **kwargs)

    torch.load = guarded
    try:
        yield
    finally:
        torch.load = previous
