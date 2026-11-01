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
#
# Files come from the commit, not the working tree (D88): GIT_COMMIT names HEAD,
# so the staged code must be HEAD's. Uncommitted edits to tracked files under the
# staged paths are refused (untracked files never ship, so they do not count).
# `--dirty` stages the working tree for a local image build and writes
# "<sha>-dirty" into GIT_COMMIT, so /health and every manifest say so.
set -euo pipefail

dest="${1:?usage: stage-hf-space.sh <dest-dir> [--dirty]}"
dirty="${2:-}"
[ -z "$dirty" ] || [ "$dirty" = "--dirty" ] || { echo "unknown option: $dirty" >&2; exit 2; }
root="$(git rev-parse --show-toplevel)"
paths=(mace-api test_scripts/validate_calculation.py)

head="$(git -C "$root" rev-parse HEAD)"
changes="$(git -C "$root" status --porcelain --untracked-files=no -- "${paths[@]}")"
if [ -n "$changes" ] && [ -z "$dirty" ]; then
  echo "refusing to stage: uncommitted changes under ${paths[*]} would ship as $head" >&2
  echo "$changes" >&2
  echo "commit them, or pass --dirty for a local build labelled $head-dirty" >&2
  exit 1
fi

files="$(git -C "$root" ls-files -- mace-api \
  | grep -v -E '^mace-api/(test_[^/]*\.py|\.claude/|\.pytest_cache/)' || true)"
files="$files"$'\n'"test_scripts/validate_calculation.py"

# The Space tree is flat: two files with one name would silently become one.
dupes="$(printf '%s\n' "$files" | sed 's#.*/##' | sort | uniq -d)"
if [ -n "$dupes" ]; then
  echo "refusing to stage: these names occur twice and the Space tree is flat: $dupes" >&2
  exit 1
fi

mkdir -p "$dest"
while read -r path; do
  if [ -n "$dirty" ]; then
    cp "$root/$path" "$dest/$(basename "$path")"
  else
    git -C "$root" show "HEAD:$path" > "$dest/$(basename "$path")"
  fi
done <<< "$files"

if [ -n "$changes" ]; then echo "$head-dirty"; else echo "$head"; fi > "$dest/GIT_COMMIT"

echo "staged $(ls "$dest" | wc -l | tr -d ' ') files into $dest:"
ls "$dest"
