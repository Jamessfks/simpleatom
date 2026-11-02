"""
Write test/fixtures/parser-reference.json: what ASE makes of every structure
SimpleAtom ships and of every adversarial fixture.

The browser previews an upload with lib/parse-structure.ts, but the backend
computes whatever ASE reads (mace-api/calculate.py `_read_structure`:
`read(path, format=detect_format(name), index=0)`). When the two disagree the
user sees one structure and runs another (D89-D93, D117). This file is the
agreement oracle: test/parser-agreement.test.ts feeds the same text to
`parseStructureText` and compares it with the numbers below, and
test_scripts/test_parser_reference.py fails if this file is out of date.

    KMP_DUPLICATE_LIB_OK=TRUE python test_scripts/gen_parser_reference.py
    KMP_DUPLICATE_LIB_OK=TRUE python test_scripts/gen_parser_reference.py --check

Inputs
  public/demo/*                         the demo files
  lib/mlpeg-catalog.ts                  every catalog `xyzData`, read as <id>.xyz
  lib/mp-reference-data.ts              every MP `xyzData` (<id>.xyz) and `cifData` (<id>.cif)
  test/fixtures/structures/adversarial  every fixture in its index.json, under
                                        the filename the index gives it

Per structure
  symbols, positions (Å), cell (3x3 or null), pbc, nFrames,
  referenceEnergy / referenceForces (info or arrays first, then the
  SinglePointCalculator ASE >= 3.23 moves `energy=` and `forces` into) —
  or `error` when ASE refuses the file.

`_detect_format` below is a copy of calculate.detect_format; the unit test
asserts the two agree for every filename here, so the oracle cannot drift
from the server's choice of reader.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
import tempfile
import warnings

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = REPO_ROOT / "test" / "fixtures" / "parser-reference.json"
ADVERSARIAL = REPO_ROOT / "test" / "fixtures" / "structures" / "adversarial"
DECIMALS = 10

_BARE_NAMES = {"POSCAR", "CONTCAR"}


def _detect_format(filename: str) -> str:
    """Copy of mace-api/calculate.py detect_format (checked by the unit test)."""
    name = pathlib.Path(filename).name
    ext = pathlib.Path(filename).suffix.lower()
    if ext in (".xyz", ".extxyz"):
        return "extxyz"
    if ext == ".cif":
        return "cif"
    if ext in (".poscar", ".vasp", ".contcar"):
        return "vasp"
    if ext == ".pdb":
        return "proteindatabank"
    if name.upper() in _BARE_NAMES:
        return "vasp"
    return "xyz"


def _round(x) -> float:
    return round(float(x), DECIMALS) + 0.0  # + 0.0 turns -0.0 into 0.0


def _matrix(m) -> list:
    return [[_round(v) for v in row] for row in m]


def _reference_data(atoms) -> dict:
    """Reference energy/forces, as the backend should read them (D91)."""
    out: dict = {}
    for key in ("REF_energy", "ref_energy", "energy", "dft_energy"):
        if key in atoms.info:
            try:
                out["referenceEnergy"] = _round(atoms.info[key])
                break
            except (TypeError, ValueError):
                pass
    for key in ("REF_forces", "ref_forces", "forces", "dft_forces"):
        if key in atoms.arrays:
            out["referenceForces"] = _matrix(atoms.arrays[key])
            break
    calc = getattr(atoms, "calc", None)
    results = getattr(calc, "results", None) or {}
    if "referenceEnergy" not in out and "energy" in results:
        out["referenceEnergy"] = _round(results["energy"])
    if "referenceForces" not in out and "forces" in results:
        out["referenceForces"] = _matrix(results["forces"])
    return out


def read_like_the_server(text: str, filename: str) -> dict:
    """What `_read_structure` hands the calculation for this file."""
    from ase.io import read

    fmt = _detect_format(filename)
    # ASE warns about sites a CIF lists twice; the server ignores the warning too.
    warnings.simplefilter("ignore")
    with tempfile.TemporaryDirectory() as tmp:
        path = pathlib.Path(tmp) / pathlib.Path(filename).name
        path.write_text(text, encoding="utf-8", newline="")
        try:
            atoms = read(str(path), format=fmt, index=0)
        except Exception as exc:  # noqa: BLE001 — recorded, not hidden
            if fmt != "extxyz":
                return {"format": fmt, "error": f"{type(exc).__name__}: {exc}"}
            try:
                atoms = read(str(path), format="xyz", index=0)
                fmt = "xyz"
            except Exception as exc2:  # noqa: BLE001
                return {"format": fmt, "error": f"{type(exc2).__name__}: {exc2}"}
        try:
            n_frames = len(read(str(path), format=fmt, index=":"))
        except Exception:  # noqa: BLE001
            n_frames = 1
    entry = {
        "format": fmt,
        "symbols": atoms.get_chemical_symbols(),
        "positions": _matrix(atoms.get_positions()),
        "cell": _matrix(atoms.cell.array) if atoms.cell.rank == 3 else None,
        "pbc": [bool(v) for v in atoms.pbc],
        "nFrames": n_frames,
    }
    entry.update(_reference_data(atoms))
    return entry


def _template_literals(source: str, key: str) -> list[str]:
    """Every `key: \\`...\\`` template literal in a TypeScript source, in order."""
    found = re.findall(r"\b" + key + r":\s*`([^`]*)`", source)
    for body in found:
        if "${" in body or "\\" in body:
            raise SystemExit(f"{key} template literal uses an escape or substitution; extend this reader")
    return found


def _ids(source: str) -> list[str]:
    return re.findall(r'^\s{6,8}id:\s*"([^"]+)"', source, flags=re.M)


def shipped_structures() -> list[dict]:
    out: list[dict] = []

    for path in sorted((REPO_ROOT / "public" / "demo").iterdir()):
        if path.suffix.lower() in (".xyz", ".cif", ".pdb", ".vasp", ".poscar"):
            out.append({"name": f"demo/{path.name}", "group": "demo", "filename": path.name,
                        "text": path.read_text(encoding="utf-8")})

    catalog = (REPO_ROOT / "lib" / "mlpeg-catalog.ts").read_text(encoding="utf-8")
    bodies = _template_literals(catalog, "xyzData")
    ids = [i for i in _ids(catalog)]
    # Category rows also carry an `id:`; entries are the ones with an xyzData.
    entry_ids = re.findall(r'id:\s*"([^"]+)",\s*\n\s*name:[^\n]*\n\s*description:[^\n]*\n\s*formula:', catalog)
    if len(entry_ids) != len(bodies):
        raise SystemExit(f"catalog: {len(entry_ids)} ids but {len(bodies)} xyzData; extend this reader ({len(ids)} ids seen)")
    for entry_id, body in zip(entry_ids, bodies):
        out.append({"name": f"catalog/{entry_id}", "group": "catalog", "filename": f"{entry_id}.xyz", "text": body})

    mp = (REPO_ROOT / "lib" / "mp-reference-data.ts").read_text(encoding="utf-8")
    mp_ids = re.findall(r'^\s{4}id:\s*"([^"]+)"', mp, flags=re.M)
    xyz = _template_literals(mp, "xyzData")
    cif = _template_literals(mp, "cifData")
    if not (len(mp_ids) == len(xyz) == len(cif)):
        raise SystemExit(f"mp: {len(mp_ids)} ids, {len(xyz)} xyz, {len(cif)} cif; extend this reader")
    for entry_id, x, c in zip(mp_ids, xyz, cif):
        out.append({"name": f"mp/{entry_id}.xyz", "group": "mp-xyz", "filename": f"{entry_id}.xyz", "text": x})
        out.append({"name": f"mp/{entry_id}.cif", "group": "mp-cif", "filename": f"{entry_id}.cif", "text": c})

    index = json.loads((ADVERSARIAL / "index.json").read_text(encoding="utf-8"))
    for item in index:
        path = REPO_ROOT / item["path"]
        out.append({"name": f"adversarial/{item['name']}", "group": "adversarial",
                    "filename": item["filename"], "note": item["note"],
                    "text": path.read_text(encoding="utf-8")})
    return out


def build() -> dict:
    import ase

    structures = []
    for item in shipped_structures():
        text = item.pop("text")
        entry = {**item, "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                 "ase": read_like_the_server(text, item["filename"])}
        structures.append(entry)
    return {
        "_comment": ("Generated by test_scripts/gen_parser_reference.py; do not edit. "
                     "What ase.io.read(format=detect_format(name), index=0) makes of each structure, "
                     "the way mace-api/calculate.py _read_structure reads it."),
        "aseVersion": ase.__version__,
        "decimals": DECIMALS,
        "structures": structures,
    }


def render(data: dict) -> str:
    return json.dumps(data, indent=1, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument("--check", action="store_true", help="fail if the file on disk is out of date")
    args = parser.parse_args()
    text = render(build())
    if args.check:
        if not OUTPUT.exists() or json.loads(OUTPUT.read_text()) != json.loads(text):
            print(f"{OUTPUT} is out of date; regenerate with test_scripts/gen_parser_reference.py", file=sys.stderr)
            return 1
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(REPO_ROOT)} ({len(json.loads(text)['structures'])} structures)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
