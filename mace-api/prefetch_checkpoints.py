#!/usr/bin/env python3
"""
Bake the MIT-licensed foundation checkpoints into the Docker image.

Downloads every checkpoint of every `mace_mp` model in contract.json through
upstream's own downloader (so it lands where mace_mp() will look for it) and
fails the build unless each file's SHA-256 matches its pin. A cold start then
loads from the image instead of downloading ~290 MB from GitHub on the first
request, and a re-published or corrupted upstream file breaks the build here
rather than a user's calculation later.

ASL-licensed checkpoints (MACE-OFF) are deliberately NOT baked in: they are
fetched from upstream at runtime and hash-checked by safe_load.py, so this
image never redistributes them.
"""

import sys

import contract
import provenance


def main() -> int:
    from mace.calculators.foundations_models import download_mace_mp_checkpoint

    failures = 0
    for model in contract.models():
        if model["loader"] != "mace_mp" or model["license"]["id"] != "MIT":
            continue
        for size, spec in model["sizes"].items():
            path = download_mace_mp_checkpoint(spec["upstreamModel"])
            digest, error = provenance.file_sha256(path)
            ok = digest == spec["sha256"]
            failures += not ok
            print(f"{'ok ' if ok else 'BAD'} {model['id']} {size}: {path} "
                  f"sha256={digest or error}", flush=True)
    if failures:
        print(f"{failures} checkpoint(s) failed their pin; refusing to build.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
