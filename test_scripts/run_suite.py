#!/usr/bin/env python3
"""Run one unittest suite and fail unless it ran at least --min tests (default 1).

    python test_scripts/run_suite.py test_backend_contract.py --min 60
    python test_scripts/run_suite.py "test_*.py" --start-dir mace-api --min 31

D86: on Python 3.11 `unittest discover` that finds nothing prints "Ran 0 tests
... OK" and exits 0, so a renamed or broken test file passed CI unnoticed.
"""
import argparse
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("pattern")
    ap.add_argument("--start-dir", default="test_scripts")
    ap.add_argument("--min", type=int, default=1)
    args = ap.parse_args()
    start = ROOT / args.start_dir
    sys.path.insert(0, str(start))
    suite = unittest.defaultTestLoader.discover(str(start), pattern=args.pattern, top_level_dir=str(start))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if result.testsRun < max(1, args.min):
        print(f"run_suite: {result.testsRun} tests ran from {args.pattern}, expected at least "
              f"{max(1, args.min)} — tests were deleted, skipped or not discovered.", file=sys.stderr)
        return 1
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
