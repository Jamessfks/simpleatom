"""
test/fixtures/parser-reference.json is up to date (D93 and friends).

The file records what ASE makes of every structure SimpleAtom ships and of
every adversarial fixture; test/parser-agreement.test.ts holds the browser
parser to it. If a structure, a fixture, or the ASE pin changes, the file must
be regenerated:

    python test_scripts/gen_parser_reference.py

    python -m unittest discover -s test_scripts -p "test_parser_reference.py"
"""

import json
import math
import os
import pathlib
import sys
import unittest

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

HERE = pathlib.Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO_ROOT / "mace-api"))

import gen_parser_reference as gen  # noqa: E402

TOLERANCE = 1e-8


def _close(a, b, path: str) -> list[str]:
    """Differences between two JSON values, floats compared to TOLERANCE."""
    if isinstance(a, float) or isinstance(b, float):
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isclose(a, b, abs_tol=TOLERANCE):
            return []
        return [f"{path}: {a!r} != {b!r}"]
    if isinstance(a, dict) and isinstance(b, dict):
        out: list[str] = []
        for key in sorted(set(a) | set(b)):
            if key not in a or key not in b:
                out.append(f"{path}.{key}: present in only one side")
            else:
                out += _close(a[key], b[key], f"{path}.{key}")
        return out
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return [f"{path}: length {len(a)} != {len(b)}"]
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in _close(x, y, f"{path}[{i}]")]
    return [] if a == b else [f"{path}: {a!r} != {b!r}"]


class TestParserReference(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import ase  # noqa: F401
        except ImportError as exc:  # pragma: no cover
            raise unittest.SkipTest(f"ASE is not importable: {exc}")
        cls.stored = json.loads(gen.OUTPUT.read_text(encoding="utf-8"))
        cls.fresh = json.loads(gen.render(gen.build()))

    def test_reference_file_is_up_to_date(self):
        # Compare everything except the ASE version string: a patch release of
        # ASE that moves a coordinate by 1e-9 must not fail the build, but a
        # structure that changed must.
        stored = {k: v for k, v in self.stored.items() if k != "aseVersion"}
        fresh = {k: v for k, v in self.fresh.items() if k != "aseVersion"}
        diffs = _close(stored, fresh, "reference")
        self.assertEqual(
            diffs[:5], [],
            "test/fixtures/parser-reference.json is out of date; regenerate it with "
            "`python test_scripts/gen_parser_reference.py`",
        )

    def test_covers_every_shipped_structure_and_fixture(self):
        names = {s["name"] for s in self.stored["structures"]}
        index = json.loads((gen.ADVERSARIAL / "index.json").read_text(encoding="utf-8"))
        for item in index:
            self.assertIn(f"adversarial/{item['name']}", names)
        for demo in (REPO_ROOT / "public" / "demo").iterdir():
            if demo.suffix.lower() in (".xyz", ".cif", ".pdb", ".vasp", ".poscar"):
                self.assertIn(f"demo/{demo.name}", names)
        groups = {s["group"] for s in self.stored["structures"]}
        self.assertEqual(groups, {"demo", "catalog", "mp-xyz", "mp-cif", "adversarial"})

    def test_format_choice_matches_the_server(self):
        import calculate

        for entry in self.stored["structures"]:
            name = entry["filename"]
            expected = calculate.detect_format(name)
            self.assertEqual(gen._detect_format(name), expected, name)


if __name__ == "__main__":
    unittest.main()
