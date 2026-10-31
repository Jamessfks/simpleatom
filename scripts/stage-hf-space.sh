#!/usr/bin/env bash
# Stage exactly what the Hugging Face Space should contain, into $1.
#
# The Space's build context is flat (the Space root = the Docker context), so
# this copies every TRACKED file under mace-api/ except tests, plus the two
# files that live elsewhere in the repo but must ship with the backend:
#   - test_scripts/validate_calculation.py  (D2: calculate.py loads it by path)
#   - GIT_COMMIT                             (D3: the image has no .git)
# Staging from `git ls-files` instead of a hand-written cp list is what keeps a
# new module (smiles_to_xyz.py was never copied; provenance.py once wasn't)
# from silently missing in production. The deploy job then mirrors this tree
# into the Space with `rsync --delete`, so files removed here are removed there.
set -euo pipefail

dest="${1:?usage: stage-hf-space.sh <dest-dir>}"
root="$(git rev-parse --show-toplevel)"
mkdir -p "$dest"

git -C "$root" ls-files mace-api \
  | grep -v -E '^mace-api/(test_[^/]*\.py|\.claude/|\.pytest_cache/)' \
  | while read -r path; do
      cp "$root/$path" "$dest/$(basename "$path")"
    done
cp "$root/test_scripts/validate_calculation.py" "$dest/"
git -C "$root" rev-parse HEAD > "$dest/GIT_COMMIT"

echo "staged $(ls "$dest" | wc -l | tr -d ' ') files into $dest:"
ls "$dest"
