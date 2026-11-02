#!/usr/bin/env python3
"""
Provenance manifest & audit-trail regression tests.

Run:  KMP_DUPLICATE_LIB_OK=TRUE python3 test_scripts/test_provenance.py

WHAT THIS SUITE IS FOR
----------------------
Four defects on this branch were the same bug wearing different clothes: code
that reads as correct and does nothing at runtime. The validator's model-aware
energy bounds, the phonon fall-through, the D3 toggle, the structure
guardrails — each one reviewed fine and each one was inert.

A provenance manifest is unusually easy to break that way. A field that reads
`null` looks like a well-behaved optional. A SHA256 that never changes looks
like a SHA256. So these tests do not ask "is there a manifest?" — they ask:

  * does a KNOWN structure still produce a KNOWN energy (golden values), and
  * is every manifest field POPULATED rather than null, and
  * does the checkpoint digest match a hash the TEST computed itself, from the
    file, through a completely separate code path?

That last one is the point. A hardcoded, stale, or accidentally-constant hash
passes an "is not null" check and fails this one.

Two tiers:
  TestProvenanceUnits    — stdlib + ASE only, no model download, milliseconds.
  TestRealCalculation    — one real MACE-OFF run and one real MACE-MP-0 run.
                           Skips loudly (never silently) if mace-torch is absent.

pytest is not installed in this environment; this matches the unittest pattern
already used by test_scripts/test_geometry_opt.py.
"""

import hashlib
import json
import logging
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

# This conda environment links libomp twice, so importing torch aborts the
# process (OMP error #15) unless this is set. The project's own documented
# verification commands export it; setdefault means an explicit value from the
# caller always wins. Must happen before torch is imported, below.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

REPO_ROOT = Path(__file__).resolve().parent.parent
MACE_API = REPO_ROOT / "mace-api"
sys.path.insert(0, str(MACE_API))

import provenance  # noqa: E402  (needs the sys.path line above)


# ── Golden values ───────────────────────────────────────────────────────────
# Recorded on 2026-08-10 from a real run of the documented command, on
# mace-torch 0.3.15 / torch 2.10.0 / ase 3.27.0 / numpy 2.4.2, CPU, macOS.
# Reproduced bit-for-bit across repeated runs on that machine.
#
# These are NOT reference values from experiment or DFT — they are this
# stack's own output, pinned so that drift becomes visible. If a mace-torch or
# torch upgrade moves them, that is a real finding and the new number should be
# recorded here deliberately, in a commit that says so, not tolerated silently.
#
# Tolerances are far tighter than any real change (a different checkpoint or a
# broken code path moves these by whole eV) and far looser than cross-BLAS
# float noise.
GOLDEN = {
    "ethanol": {
        "file": "test/fixtures/ethanol-golden.xyz",  # the strained pre-D119 demo, kept for its goldens
        "params": {"calculationType": "single-point",
                   "modelType": "MACE-OFF", "modelSize": "small"},
        "energy": -4221.322391557846,   # eV, float64
        "energy_atol": 1e-3,            # eV
        "max_force": 2.004692023917517,  # eV/A
        "max_force_atol": 1e-3,
        "n_atoms": 9,
        "checkpoint": "MACE-OFF23_small.model",
        "precision": "float64",         # mace_off() defaults to float64
    },
    "silicon": {
        "file": "public/demo/silicon.cif",
        "params": {"calculationType": "single-point",
                   "modelType": "MACE-MP-0", "modelSize": "small"},
        "energy": -42.954566955566406,  # eV, float32, 8 atoms
        "energy_atol": 1e-3,
        "n_atoms": 8,
        "precision": "float32",
    },
}

_HEX64 = set("0123456789abcdef")


def _is_sha256(value) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= _HEX64


def _sha256_of(path) -> str:
    """Independent hash, deliberately NOT using provenance.file_sha256()."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# ────────────────────────────────────────────────────────────────────────────
class TestStructureHashAcrossFormats(unittest.TestCase):
    """
    D76: the structure hash is format-independent for the same atoms, cell and
    pbc. It is not magic: PDB keeps 3 decimals, and a molecule written as CIF
    gains a cell and periodicity, so both are different inputs.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)

    def _round_trip(self, atoms, fmt, ext):
        from ase.io import read, write
        path = os.path.join(self.tmp, f"s.{ext}")
        write(path, atoms, format=fmt)
        return hashlib.sha256(provenance.structure_canonical_bytes(read(path, format=fmt))).hexdigest()

    def test_a_crystal_hashes_the_same_as_extxyz_cif_and_poscar(self):
        from ase.io import read
        si = read(str(REPO_ROOT / "public" / "demo" / "silicon.cif"))
        hashes = {self._round_trip(si, f, e) for f, e in (("extxyz", "xyz"), ("cif", "cif"), ("vasp", "vasp"))}
        self.assertEqual(len(hashes), 1)

    def test_hexagonal_crystals_hash_the_same_as_poscar_and_cif(self):
        # D76: a coordinate that rounds to zero printed as "-0.0000000000" from one
        # format and "0.0000000000" from the other, so hcp and wurtzite cells differed.
        from ase.build import bulk
        crystals = {"Mg": bulk("Mg", "hcp", a=3.21, c=5.21), "Ti": bulk("Ti", "hcp", a=2.95, c=4.68),
                    "C": bulk("C", "hcp", a=2.46, c=6.71),
                    "ZnO": bulk("ZnO", "wurtzite", a=3.25, c=5.21, u=0.382)}
        for name, atoms in crystals.items():
            with self.subTest(name):
                self.assertEqual(self._round_trip(atoms, "vasp", "vasp"), self._round_trip(atoms, "cif", "cif"))

    def test_pdb_matches_only_at_its_own_precision(self):
        import numpy as np
        from ase.io import read
        ethanol = read(str(REPO_ROOT / "test" / "fixtures" / "ethanol-golden.xyz"))
        self.assertNotEqual(self._round_trip(ethanol, "extxyz", "xyz"),
                            self._round_trip(ethanol, "proteindatabank", "pdb"))
        ethanol.positions = np.round(ethanol.positions, 3)
        self.assertEqual(self._round_trip(ethanol, "extxyz", "xyz"),
                         self._round_trip(ethanol, "proteindatabank", "pdb"))


class TestProvenanceUnits(unittest.TestCase):
    """Manifest primitives. No model, no network, no GPU."""

    # -- library versions ----------------------------------------------------

    def test_package_versions_are_populated_and_correct(self):
        """Every tracked distribution resolves, and to the RIGHT version."""
        from importlib import metadata

        versions = provenance.package_versions()
        self.assertEqual(set(versions), set(provenance.TRACKED_DISTRIBUTIONS))
        for dist, reported in versions.items():
            self.assertIsNotNone(reported, f"{dist} version is null")
            # Independent lookup: catches a cached/stale/constant dict.
            self.assertEqual(reported, metadata.version(dist), dist)

    # -- file hashing --------------------------------------------------------

    def test_file_sha256_matches_an_independently_computed_hash(self):
        digest, error = provenance.file_sha256(__file__)
        self.assertIsNone(error)
        self.assertEqual(digest, _sha256_of(__file__))

    def test_file_sha256_cache_invalidates_when_the_file_changes(self):
        """A per-process cache must not keep serving a superseded digest."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "weights.model"
            path.write_bytes(b"first")
            first, _ = provenance.file_sha256(path)
            self.assertEqual(first, hashlib.sha256(b"first").hexdigest())

            path.write_bytes(b"second-and-longer")
            second, _ = provenance.file_sha256(path)
            self.assertEqual(second, hashlib.sha256(b"second-and-longer").hexdigest())
            self.assertNotEqual(first, second)

    def test_file_sha256_returns_none_and_a_reason_for_a_missing_file(self):
        """Never fabricate. A hash that cannot be computed is null, with why."""
        digest, error = provenance.file_sha256("/nonexistent/checkpoint.model")
        self.assertIsNone(digest)
        self.assertIsInstance(error, str)
        self.assertIn("Error", error)

    # -- structure identity --------------------------------------------------

    def _ethanol_atoms(self):
        from ase.io import read
        return read(str(REPO_ROOT / GOLDEN["ethanol"]["file"]), format="xyz")

    def test_structure_hash_is_populated_and_well_formed(self):
        digest, error = provenance.structure_sha256(self._ethanol_atoms())
        self.assertIsNone(error)
        self.assertTrue(_is_sha256(digest), digest)

    def test_structure_hash_ignores_the_file_it_arrived_in(self):
        """
        Uploads reach the backend as randomly-named temp files. The structure
        digest must identify the structure regardless, or a shared result
        cannot prove what produced it.
        """
        source = REPO_ROOT / GOLDEN["ethanol"]["file"]
        from ase.io import read

        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "tmp8f3a9c.xyz"
            shutil.copyfile(source, copy)
            a = read(str(source), format="xyz")
            b = read(str(copy), format="xyz")
            self.assertEqual(provenance.structure_sha256(a)[0],
                             provenance.structure_sha256(b)[0])

    def test_structure_hash_changes_when_one_atom_moves(self):
        """The digest must be a function of the coordinates, not a constant."""
        atoms = self._ethanol_atoms()
        before, _ = provenance.structure_sha256(atoms)
        positions = atoms.get_positions()
        positions[0][0] += 1e-6          # far above the 1e-10 rounding floor
        atoms.set_positions(positions)
        after, _ = provenance.structure_sha256(atoms)
        self.assertNotEqual(before, after)

    def test_structure_hash_changes_when_an_element_changes(self):
        atoms = self._ethanol_atoms()
        before, _ = provenance.structure_sha256(atoms)
        symbols = atoms.get_chemical_symbols()
        symbols[0] = "N"
        atoms.set_chemical_symbols(symbols)
        self.assertNotEqual(before, provenance.structure_sha256(atoms)[0])

    def test_structure_hash_changes_when_atoms_are_fixed(self):
        """
        D132: selective dynamics changes what a calculation reports (forces on
        fixed atoms, MD temperature), so the constraints are part of the input.
        """
        from ase.constraints import FixAtoms, FixScaled
        atoms = self._ethanol_atoms()
        free, _ = provenance.structure_sha256(atoms)
        atoms.set_constraint(FixAtoms(indices=[0, 1]))
        fixed01, _ = provenance.structure_sha256(atoms)
        atoms.set_constraint(FixAtoms(indices=[0, 2]))
        fixed02, _ = provenance.structure_sha256(atoms)
        atoms.set_constraint(FixScaled(0, [False, False, True], atoms.cell))
        scaled, _ = provenance.structure_sha256(atoms)
        self.assertEqual(len({free, fixed01, fixed02, scaled}), 4)
        self.assertEqual(provenance.STRUCTURE_HASH_SPEC, "simpleatom-structure-v2")

    def test_structure_hash_is_insensitive_to_the_sign_of_zero(self):
        from ase import Atoms
        plus = Atoms("H2", positions=[[0.0, 0.0, 0.0], [0.0, 0.0, 0.74]])
        minus = Atoms("H2", positions=[[-0.0, -0.0, -0.0], [0.0, 0.0, 0.74]])
        self.assertEqual(provenance.structure_sha256(plus)[0],
                         provenance.structure_sha256(minus)[0])

    # -- checkpoint identification ------------------------------------------

    def test_recorder_ignores_unrelated_torch_loads(self):
        """
        e3nn loads its Wigner `constants.pt` inside the same window as the
        MACE checkpoint. Hashing that file would stamp a confident, wrong
        digest onto the result.
        """
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cache" / "mace"
            cache.mkdir(parents=True)
            checkpoint = cache / "MACE-OFF23_small.model"
            checkpoint.write_bytes(b"weights")
            unrelated = Path(tmp) / "constants.pt"
            unrelated.write_bytes(b"wigner")

            recorder = provenance.CheckpointRecorder()
            recorder.record(str(unrelated))
            recorder.record(str(checkpoint))

            path, how = recorder.select(None, str(cache))
            self.assertEqual(Path(path).name, "MACE-OFF23_small.model")
            self.assertEqual(how, "mace-cache-dir")

    def test_recorder_prefers_an_explicit_custom_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            custom = Path(tmp) / "finetuned.model"
            custom.write_bytes(b"custom")
            other = Path(tmp) / "constants.pt"
            other.write_bytes(b"other")

            recorder = provenance.CheckpointRecorder()
            recorder.record(str(other))
            recorder.record(str(custom))
            path, how = recorder.select(str(custom), None)
            self.assertEqual(path, str(custom))
            self.assertEqual(how, "explicit-model-path")

    def test_recorder_refuses_to_guess_between_two_checkpoints(self):
        """Ambiguity must produce null + a reason, never a coin flip."""
        with tempfile.TemporaryDirectory() as tmp:
            for name in ("a.model", "b.model"):
                (Path(tmp) / name).write_bytes(b"x")
            recorder = provenance.CheckpointRecorder()
            recorder.record(str(Path(tmp) / "a.model"))
            recorder.record(str(Path(tmp) / "b.model"))
            path, how = recorder.select(None, None)
            self.assertIsNone(path)
            self.assertIn("ambiguous", how)

    def test_recorder_reports_when_nothing_was_loaded(self):
        path, how = provenance.CheckpointRecorder().select(None, None)
        self.assertIsNone(path)
        self.assertEqual(how, "no-torch-load-observed")

    def test_capture_restores_torch_load_even_when_loading_fails(self):
        import torch

        before = torch.load
        try:
            with provenance.capture_checkpoint_loads():
                raise RuntimeError("checkpoint is corrupt")
        except RuntimeError:
            pass
        self.assertIs(torch.load, before)

    # -- manifest shape ------------------------------------------------------

    def test_unresolvable_checkpoint_is_null_with_a_note_not_a_hash(self):
        manifest = provenance.build_manifest(
            model_type="MACE-MP-0", model_size="medium",
            checkpoint_path=None, checkpoint_resolved_by="no-torch-load-observed",
            input_filename="ethanol.xyz", input_path=None, input_format="xyz",
            atoms=self._ethanol_atoms(), device="cpu", precision="float32", seed=None,
        )
        self.assertIsNone(manifest["model"]["checkpoint"]["sha256"])
        self.assertTrue(any("checkpoint" in n for n in manifest["notes"]))
        self.assertTrue(any("fileSha256" in n for n in manifest["notes"]))

    def test_manifest_is_json_serialisable(self):
        manifest = provenance.build_manifest(
            model_type="MACE-OFF", model_size="small",
            checkpoint_path=__file__, checkpoint_resolved_by="model-suffix",
            input_filename="ethanol.xyz",
            input_path=str(REPO_ROOT / GOLDEN["ethanol"]["file"]),
            input_format="xyz", atoms=self._ethanol_atoms(),
            device="cpu", precision="float64", seed=42,
        )
        round_tripped = json.loads(json.dumps(manifest))
        self.assertEqual(round_tripped["runtime"]["seed"], 42)
        self.assertEqual(round_tripped["model"]["checkpoint"]["sha256"],
                         _sha256_of(__file__))

    def test_unavailable_manifest_keeps_the_shape_and_explains_itself(self):
        """
        A missing provenance block is indistinguishable from an old result.
        A present one that says why it is empty is not.
        """
        full = provenance.build_manifest(
            model_type="MACE-OFF", model_size="small", checkpoint_path=None,
            checkpoint_resolved_by="x", input_filename="f.xyz", input_path=None,
            input_format="xyz", atoms=self._ethanol_atoms(), device="cpu",
            precision="float64", seed=None,
        )
        stub = provenance.unavailable_manifest("boom")
        self.assertEqual(set(full), set(stub))
        for key in ("model", "input", "runtime", "code", "packages"):
            self.assertEqual(set(full[key]), set(stub[key]), key)
        self.assertIn("boom", " ".join(stub["notes"]))

    # -- the validator wiring -----------------------------------------------

    def test_importing_the_validator_does_not_disable_logging(self):
        """
        Regression: validate_calculation.py used to call
        logging.disable(logging.CRITICAL) at module scope. calculate.py now
        imports it on every run, so that line would have silently re-broken
        capture_model_warnings() — the code that surfaces MACE's
        "converting models to ..." checkpoint-downcast warning. Same class of
        bug as the rest of this file: correct-looking, and inert at runtime.
        """
        import calculate

        module, reason = calculate._load_validator()
        self.assertIsNotNone(module, reason)
        self.assertTrue(logging.getLogger().isEnabledFor(logging.WARNING),
                        "importing the validator disabled WARNING logging")

        with calculate.capture_model_warnings() as collected:
            logging.getLogger("mace.test").warning("converting models to float64")
        self.assertIn("converting models to float64", collected.messages)

    def test_validator_search_paths_are_repo_relative(self):
        """
        The "validator not found" reason is attached to a result and ships in
        MACE Links and PDF exports (it is the expected state in the Docker
        image, whose build context is mace-api/ alone). It must not publish the
        server's directory layout.
        """
        import calculate

        for shown in calculate._VALIDATOR_SEARCH_DISPLAY:
            self.assertFalse(shown.startswith("/"), shown)
            self.assertNotIn(str(Path.home()), shown)
            self.assertNotIn(str(REPO_ROOT), shown)
        self.assertIn("test_scripts/validate_calculation.py",
                      calculate._VALIDATOR_SEARCH_DISPLAY)

    def test_validation_never_rejects_a_completed_result(self):
        """
        Policy check. A validator that blocks a legitimate result is worse than
        one that only warns, so a result the validator dislikes must still come
        back intact, with the complaint attached.
        """
        import calculate

        clashing = {
            "status": "success",
            "energy": -100.0,
            "forces": [[500.0, 0.0, 0.0], [-500.0, 0.0, 0.0]],
            "positions": [[0.0, 0.0, 0.0], [0.1, 0.0, 0.0]],  # 0.1 A apart
            "symbols": ["H", "H"],
            "params": {"modelType": "MACE-MP-0"},
        }
        out = calculate.attach_validation(dict(clashing))
        self.assertEqual(out["energy"], -100.0)          # result survives
        self.assertEqual(out["validation"]["status"], "ran")
        self.assertFalse(out["validation"]["valid"])     # and is flagged
        self.assertTrue(out["validation"]["issues"])

    def test_validation_survives_a_broken_validator(self):
        """An exception inside the validator must not lose the calculation."""
        import calculate

        class Exploding:
            __file__ = "validate_calculation.py"

            @staticmethod
            def validate_result(_):
                raise RuntimeError("validator bug")

        original = calculate._VALIDATOR_CACHE
        try:
            calculate._VALIDATOR_CACHE = (Exploding, None)
            out = calculate.attach_validation({"status": "success", "energy": 1.0})
            self.assertEqual(out["energy"], 1.0)
            self.assertEqual(out["validation"]["status"], "unavailable")
            self.assertIn("validator bug", out["validation"]["unavailableReason"])
        finally:
            calculate._VALIDATOR_CACHE = original


# ────────────────────────────────────────────────────────────────────────────
def _mace_available() -> tuple[bool, str]:
    try:
        import mace.calculators  # noqa: F401
        return True, ""
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}: {exc}"


class TestDeployedProvenanceNotes(unittest.TestCase):
    """
    D49: in a deployed container (no .git, no git binary) the commit comes from
    the GIT_COMMIT file and the dirty state cannot be checked. The manifest
    used to carry gitDirty: null with no note, unlike every other null.
    """

    def test_pinned_commit_explains_its_unknown_dirty_state(self):
        from unittest import mock
        import ase
        saved = provenance._GIT_INFO
        provenance._GIT_INFO = None
        try:
            with mock.patch.object(provenance.subprocess, "run", side_effect=FileNotFoundError("git")), \
                 mock.patch.object(provenance, "_pinned_commit", return_value="a" * 40):
                info = provenance.git_info()
                manifest = provenance.build_manifest(
                    model_type="MACE-OFF", model_size="small", checkpoint_path=None,
                    checkpoint_resolved_by="none", input_filename="x.xyz", input_path=None,
                    input_format="xyz", atoms=ase.Atoms("H2", positions=[[0, 0, 0], [0, 0, 0.74]]),
                    device="cpu", precision="float64", seed=None)
        finally:
            provenance._GIT_INFO = saved
        self.assertEqual(info["commit"], "a" * 40)
        self.assertIsNone(info["dirty"])
        self.assertEqual(manifest["code"]["gitCommit"], "a" * 40)
        self.assertIsNone(manifest["code"]["gitDirty"])
        self.assertTrue(any("gitDirty is null" in n and "GIT_COMMIT" in n for n in manifest["notes"]),
                        manifest["notes"])


class TestRealCalculation(unittest.TestCase):
    """
    One real MACE-OFF run and one real MACE-MP-0 run, through the production
    entry point (`calculate.run_calculation`) — not a re-implementation of it.

    Both checkpoints are expected in MACE's cache. If they are not, upstream
    downloads them once; there is no offline substitute that would still test
    what this class is for.
    """

    results: dict = {}

    @classmethod
    def setUpClass(cls):
        available, why = _mace_available()
        if not available:
            # Loud, specific skip. A skip that says "skipped" and nothing else
            # is how a suite quietly stops testing anything.
            raise unittest.SkipTest(
                "mace-torch is not importable, so the golden-energy and "
                f"manifest-population tests cannot run: {why}"
            )

        # No torch.load patch here. calculate.py grants full unpickling only to
        # pinned foundation checkpoints (safe_load.py); a harness that patched
        # torch.load globally would hide a regression in exactly that.
        import calculate

        cls.results = {}
        for name, spec in GOLDEN.items():
            cls.results[name] = calculate.run_calculation(
                str(REPO_ROOT / spec["file"]), dict(spec["params"])
            )

    # -- the numbers ---------------------------------------------------------

    def test_ethanol_energy_matches_the_golden_value(self):
        spec, result = GOLDEN["ethanol"], self.results["ethanol"]
        self.assertEqual(result["status"], "success", result.get("message"))
        self.assertEqual(len(result["symbols"]), spec["n_atoms"])
        self.assertAlmostEqual(result["energy"], spec["energy"],
                               delta=spec["energy_atol"])

    def test_ethanol_max_force_matches_the_golden_value(self):
        spec, result = GOLDEN["ethanol"], self.results["ethanol"]
        max_force = max(sum(c * c for c in f) ** 0.5 for f in result["forces"])
        self.assertAlmostEqual(max_force, spec["max_force"],
                               delta=spec["max_force_atol"])

    def test_silicon_energy_matches_the_golden_value(self):
        """
        Also guards the CIF path: silicon's fractional coordinates were once
        never multiplied through the cell, giving a 0.433 A nearest neighbour
        instead of 2.35 A. That bug would move this energy by hundreds of eV.
        """
        spec, result = GOLDEN["silicon"], self.results["silicon"]
        self.assertEqual(result["status"], "success", result.get("message"))
        self.assertEqual(len(result["symbols"]), spec["n_atoms"])
        self.assertIsNotNone(result["lattice"])
        self.assertAlmostEqual(result["energy"], spec["energy"],
                               delta=spec["energy_atol"])

    # -- the manifest is POPULATED, not null ---------------------------------

    def test_every_result_carries_a_provenance_block(self):
        for name, result in self.results.items():
            self.assertIn("provenance", result, name)
            self.assertEqual(result["provenance"]["schemaVersion"],
                             provenance.PROVENANCE_SCHEMA_VERSION, name)

    def test_checkpoint_digest_is_populated_for_both_model_families(self):
        for name, result in self.results.items():
            checkpoint = result["provenance"]["model"]["checkpoint"]
            self.assertTrue(_is_sha256(checkpoint["sha256"]),
                            f"{name}: sha256 is {checkpoint['sha256']!r}")
            self.assertIsNotNone(checkpoint["filename"], name)
            self.assertGreater(checkpoint["sizeBytes"], 1_000_000, name)
            self.assertEqual(checkpoint["resolvedBy"], "mace-cache-dir", name)

    def test_checkpoint_digest_is_the_hash_of_the_real_file_on_disk(self):
        """
        The strongest anti-no-op check in this suite.

        A hardcoded, stale, or accidentally-constant digest passes every
        "is not null" assertion. This one re-finds the checkpoint from the
        reported filename and hashes the bytes itself, with hashlib, through
        no provenance code at all.
        """
        cache_dir = provenance.mace_cache_dir()
        self.assertIsNotNone(cache_dir, "MACE cache directory did not resolve")

        for name, result in self.results.items():
            checkpoint = result["provenance"]["model"]["checkpoint"]
            on_disk = Path(cache_dir) / checkpoint["filename"]
            self.assertTrue(on_disk.is_file(), f"{name}: {on_disk} missing")
            self.assertEqual(checkpoint["sha256"], _sha256_of(on_disk), name)
            self.assertEqual(checkpoint["sizeBytes"], on_disk.stat().st_size, name)

    def test_the_two_models_do_not_share_a_digest(self):
        """Different weights, different hash — the whole premise of doing this."""
        off = self.results["ethanol"]["provenance"]["model"]["checkpoint"]["sha256"]
        mp = self.results["silicon"]["provenance"]["model"]["checkpoint"]["sha256"]
        self.assertNotEqual(off, mp)

    def test_ethanol_loaded_the_checkpoint_it_claims_to_have_loaded(self):
        checkpoint = self.results["ethanol"]["provenance"]["model"]["checkpoint"]
        self.assertEqual(checkpoint["filename"], GOLDEN["ethanol"]["checkpoint"])

    def test_library_versions_are_populated(self):
        from importlib import metadata

        for name, result in self.results.items():
            packages = result["provenance"]["packages"]
            for dist in provenance.TRACKED_DISTRIBUTIONS:
                self.assertEqual(packages.get(dist), metadata.version(dist),
                                 f"{name}/{dist}")

    def test_input_identity_is_populated(self):
        for name, result in self.results.items():
            block = result["provenance"]["input"]
            self.assertTrue(_is_sha256(block["structureSha256"]), name)
            self.assertTrue(_is_sha256(block["fileSha256"]), name)
            self.assertEqual(block["fileSha256"],
                             _sha256_of(REPO_ROOT / GOLDEN[name]["file"]), name)
            self.assertEqual(block["nAtoms"], GOLDEN[name]["n_atoms"], name)
            self.assertIsNotNone(block["formula"], name)

    def test_runtime_block_reports_the_effective_precision(self):
        for name, result in self.results.items():
            runtime = result["provenance"]["runtime"]
            self.assertEqual(runtime["precision"], GOLDEN[name]["precision"], name)
            self.assertEqual(runtime["device"], "cpu", name)
            self.assertIsNotNone(runtime["python"], name)
            # A single-point has no stochastic step, so no seed is claimed.
            self.assertIsNone(runtime["seed"], name)

    def test_timestamp_is_present_and_utc(self):
        for name, result in self.results.items():
            stamp = result["provenance"]["timestampUtc"]
            self.assertIsInstance(stamp, str, name)
            self.assertTrue(stamp.endswith("Z"), stamp)

    def test_manifest_leaks_no_absolute_paths(self):
        """
        Manifests travel into MACE Links and PDF exports. A cache path there
        publishes the server's directory layout and the OS user's name.
        """
        for name, result in self.results.items():
            blob = json.dumps(result["provenance"])
            self.assertNotIn(str(Path.home()), blob, name)
            self.assertNotIn(str(REPO_ROOT), blob, name)

    def test_manifest_survives_json_round_trip(self):
        """MACE Link stores the whole result as jsonb; PDF export re-reads it."""
        for name, result in self.results.items():
            self.assertEqual(
                json.loads(json.dumps(result["provenance"])),
                result["provenance"], name,
            )

    # -- ordering: the manifest describes the INPUT ---------------------------

    def test_structure_digest_identifies_the_input_not_the_relaxed_geometry(self):
        """
        Geometry-opt and MD move the atoms. If the manifest were assembled
        after the run, `input.structureSha256` would silently describe the
        OUTPUT — a digest that never matches the file the user submitted, on
        two of the three calculation types, with nothing to show for it.
        """
        import calculate

        spec = GOLDEN["ethanol"]
        relaxed = calculate.run_calculation(
            str(REPO_ROOT / spec["file"]),
            {**spec["params"], "calculationType": "geometry-opt", "maxOptSteps": 3},
        )
        # Guard against a vacuous pass: the optimizer must really have moved something.
        self.assertNotEqual(relaxed["positions"], self.results["ethanol"]["positions"],
                            "geometry-opt did not move any atom; test proves nothing")
        self.assertEqual(
            relaxed["provenance"]["input"]["structureSha256"],
            self.results["ethanol"]["provenance"]["input"]["structureSha256"],
        )
        self.assertEqual(
            relaxed["provenance"]["input"]["fileSha256"],
            self.results["ethanol"]["provenance"]["input"]["fileSha256"],
        )

    def test_md_records_its_seed_in_the_manifest(self):
        """An unseeded trajectory cannot be verified by anyone, including us."""
        import calculate

        spec = GOLDEN["ethanol"]
        md = calculate.run_calculation(
            str(REPO_ROOT / spec["file"]),
            {**spec["params"], "calculationType": "molecular-dynamics",
             "mdSteps": 2, "mdEnsemble": "NVT"},
        )
        self.assertEqual(md["provenance"]["runtime"]["seed"],
                         calculate.DEFAULT_MD_SEED)
        self.assertEqual(md["params"]["seed"], calculate.DEFAULT_MD_SEED)
        self.assertTrue(_is_sha256(
            md["provenance"]["model"]["checkpoint"]["sha256"]))

    # -- the validator actually ran ------------------------------------------

    def test_validation_block_is_present_and_ran(self):
        for name, result in self.results.items():
            validation = result["validation"]
            self.assertEqual(validation["status"], "ran",
                             f"{name}: {validation.get('unavailableReason')}")
            self.assertTrue(validation["valid"], validation.get("issues"))
            self.assertTrue(validation["info"], name)

    def test_validation_used_model_aware_energy_bounds(self):
        """
        Regression for the dead-bounds defect: the validator reads
        result["params"]["modelType"] to choose between MACE-MP-0's -20 eV/atom
        floor and MACE-OFF's -800. When params was missing, every model read as
        "unknown" and every MACE-OFF result drew a spurious "check structure"
        warning. Asserting the model NAME appears in the validator's own output
        is what proves the branch was taken, not merely present.
        """
        for name, result in self.results.items():
            expected = GOLDEN[name]["params"]["modelType"]
            energy_lines = [line for line in result["validation"]["info"]
                            if "Energy/atom" in line]
            self.assertTrue(energy_lines, f"{name}: no energy line")
            self.assertIn(expected, energy_lines[0], f"{name}: {energy_lines[0]}")
            self.assertNotIn("unknown", energy_lines[0], name)

    # -- nothing existing was broken -----------------------------------------

    def test_the_pre_existing_result_contract_is_unchanged(self):
        """
        Provenance is additive. Everything the frontend already reads must
        still be there, with the same names.
        """
        required = ("status", "energy", "forces", "positions", "symbols",
                    "lattice", "properties", "params", "message", "timeTaken")
        for name, result in self.results.items():
            for key in required:
                self.assertIn(key, result, f"{name} lost {key}")
            self.assertEqual(result["params"]["modelType"],
                             GOLDEN[name]["params"]["modelType"], name)


if __name__ == "__main__":
    print("=" * 68)
    print("SimpleAtom — provenance manifest & audit-trail regression tests")
    print("=" * 68)
    available, why = _mace_available()
    print(f"mace-torch importable: {available}{'' if available else '  (' + why + ')'}")
    print("Golden values are this stack's own pinned output, not reference data.")
    print("=" * 68)
    unittest.main(verbosity=2)
