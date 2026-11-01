#!/usr/bin/env python3
"""
Unit tests for SMILES → XYZ conversion.

Run: python -m pytest test_smiles_to_xyz.py -v
  or: python test_smiles_to_xyz.py
"""

import math
import unittest

from smiles_to_xyz import smiles_to_xyz


class TestValidSmiles(unittest.TestCase):
    """Verify correct conversion of well-known molecules."""

    def test_ethanol(self):
        result = smiles_to_xyz("CCO")
        self.assertEqual(result["num_atoms"], 9)  # C2H6O = 2+6+1
        self.assertIn("C", result["formula"])
        self.assertIn("O", result["formula"])
        self._assert_xyz_valid(result["xyz"], 9)

    def test_benzene(self):
        result = smiles_to_xyz("c1ccccc1")
        self.assertEqual(result["num_atoms"], 12)  # C6H6 = 6+6
        self._assert_xyz_valid(result["xyz"], 12)

    def test_acetic_acid(self):
        result = smiles_to_xyz("CC(=O)O")
        self.assertEqual(result["num_atoms"], 8)  # C2H4O2 = 2+4+2
        self._assert_xyz_valid(result["xyz"], 8)

    def test_water(self):
        result = smiles_to_xyz("O")
        self.assertEqual(result["num_atoms"], 3)  # H2O = 2+1
        self._assert_xyz_valid(result["xyz"], 3)

    def test_methane(self):
        result = smiles_to_xyz("C")
        self.assertEqual(result["num_atoms"], 5)  # CH4 = 1+4
        self._assert_xyz_valid(result["xyz"], 5)

    def test_single_atom_copper(self):
        result = smiles_to_xyz("[Cu]")
        self.assertEqual(result["num_atoms"], 1)
        self._assert_xyz_valid(result["xyz"], 1)

    def test_canonical_smiles_returned(self):
        result = smiles_to_xyz("C(O)C")  # non-canonical ethanol
        self.assertEqual(result["smiles_canonical"], "CCO")

    def _assert_xyz_valid(self, xyz: str, expected_atoms: int):
        """Verify XYZ block structure: atom count, correct number of coordinate lines."""
        lines = xyz.strip().split("\n")
        self.assertGreaterEqual(len(lines), expected_atoms + 2)
        atom_count = int(lines[0].strip())
        self.assertEqual(atom_count, expected_atoms)


class TestGeometryQuality(unittest.TestCase):
    """Verify 3D coordinates are chemically reasonable."""

    def test_no_overlapping_atoms(self):
        """All pairwise distances should be > 0.5 Angstrom."""
        for smiles in ["CCO", "c1ccccc1", "CC(=O)O"]:
            result = smiles_to_xyz(smiles)
            positions = self._parse_positions(result["xyz"])
            for i in range(len(positions)):
                for j in range(i + 1, len(positions)):
                    dist = self._distance(positions[i], positions[j])
                    self.assertGreater(
                        dist, 0.5,
                        f"Overlapping atoms in {smiles}: atoms {i},{j} dist={dist:.3f}"
                    )

    def test_ethanol_bond_lengths(self):
        """Spot-check C-C and C-O bond lengths in ethanol are reasonable."""
        result = smiles_to_xyz("CCO")
        positions = self._parse_positions(result["xyz"])
        symbols = self._parse_symbols(result["xyz"])

        c_indices = [i for i, s in enumerate(symbols) if s == "C"]
        o_indices = [i for i, s in enumerate(symbols) if s == "O"]
        h_indices = [i for i, s in enumerate(symbols) if s == "H"]

        self.assertEqual(len(c_indices), 2)
        self.assertEqual(len(o_indices), 1)
        self.assertEqual(len(h_indices), 6)

        cc_dist = self._distance(positions[c_indices[0]], positions[c_indices[1]])
        self.assertGreater(cc_dist, 1.2, f"C-C too short: {cc_dist:.3f}")
        self.assertLess(cc_dist, 1.7, f"C-C too long: {cc_dist:.3f}")

        co_dists = [self._distance(positions[c], positions[o_indices[0]]) for c in c_indices]
        min_co = min(co_dists)
        self.assertGreater(min_co, 1.1, f"C-O too short: {min_co:.3f}")
        self.assertLess(min_co, 1.6, f"C-O too long: {min_co:.3f}")

    def _parse_positions(self, xyz: str) -> list[list[float]]:
        lines = xyz.strip().split("\n")
        n = int(lines[0].strip())
        positions = []
        for line in lines[2 : 2 + n]:
            parts = line.split()
            positions.append([float(parts[1]), float(parts[2]), float(parts[3])])
        return positions

    def _parse_symbols(self, xyz: str) -> list[str]:
        lines = xyz.strip().split("\n")
        n = int(lines[0].strip())
        return [line.split()[0] for line in lines[2 : 2 + n]]

    @staticmethod
    def _distance(a: list[float], b: list[float]) -> float:
        return math.sqrt(sum((ai - bi) ** 2 for ai, bi in zip(a, b)))


class TestInvalidSmiles(unittest.TestCase):
    """Verify that bad inputs raise ValueError with helpful messages."""

    def test_empty_string(self):
        with self.assertRaises(ValueError):
            smiles_to_xyz("")

    def test_whitespace_only(self):
        with self.assertRaises(ValueError):
            smiles_to_xyz("   ")

    def test_nonsense_string(self):
        with self.assertRaises(ValueError):
            smiles_to_xyz("not_a_smiles")

    def test_unbalanced_parens(self):
        with self.assertRaises(ValueError):
            smiles_to_xyz("C(C")

    def test_invalid_element(self):
        with self.assertRaises(ValueError):
            smiles_to_xyz("[InvalidElement]")


class TestEdgeCases(unittest.TestCase):
    """Edge cases: stereochemistry, charged species, atom limit."""

    def test_stereochemistry(self):
        result = smiles_to_xyz("C/C=C/C")
        self.assertGreater(result["num_atoms"], 0)

    def test_charged_species_are_refused(self):
        # D116: MACE has no total-charge input and MACE-OFF23 is trained on
        # neutral closed-shell molecules; NH4+ used to come back as a neutral
        # 11-electron NH4 and was computed without a word.
        with self.assertRaises(ValueError) as ctx:
            smiles_to_xyz("[NH4+]")
        self.assertIn("charge", str(ctx.exception).lower())

    def test_radicals_are_refused(self):
        for radical in ("[CH3]", "[O][O]"):
            with self.subTest(radical=radical):
                with self.assertRaises(ValueError) as ctx:
                    smiles_to_xyz(radical)
                self.assertIn("radical", str(ctx.exception).lower())

    def test_a_net_neutral_zwitterion_is_accepted(self):
        result = smiles_to_xyz("[NH3+]CC(=O)[O-]")  # glycine zwitterion
        self.assertEqual(result["num_atoms"], 10)

    def test_a_lone_atom_is_accepted(self):
        # An isolated atom is the model's own reference state; RDKit's radical
        # count for bare metal atoms is arbitrary ([Cu] 1, [Fe] 0).
        self.assertEqual(smiles_to_xyz("[Cu]")["num_atoms"], 1)


class TestForceFieldAndComment(unittest.TestCase):
    """
    D118: MMFFOptimizeMolecule returns -1 (it does not raise) when MMFF94 has
    no parameters, so the UFF fallback never ran and boron compounds kept raw
    ETKDG coordinates labelled "MMFF94". D122: the SMILES on the comment line
    was unquoted, so extended-XYZ readers stripped its brackets.
    """

    def test_boron_falls_back_to_uff_and_says_so(self):
        result = smiles_to_xyz("OB(O)O")
        self.assertEqual(result["force_field"], "UFF")
        self.assertIn("UFF", result["xyz"].splitlines()[1])
        self.assertNotIn("MMFF94", result["xyz"].splitlines()[1])

    def test_ordinary_organics_use_mmff94(self):
        result = smiles_to_xyz("CCO")
        self.assertEqual(result["force_field"], "MMFF94")
        self.assertIn("MMFF94", result["xyz"].splitlines()[1])

    def test_the_smiles_survives_an_extended_xyz_reader(self):
        import io
        from ase.io import read
        for smiles in ("C[C@@H](C(=O)O)N", "C/C=C\\C", "[NH3+]CC(=O)[O-]"):
            with self.subTest(smiles=smiles):
                result = smiles_to_xyz(smiles)
                atoms = read(io.StringIO(result["xyz"]), format="extxyz")
                self.assertEqual(atoms.info["SMILES"], result["smiles_canonical"])

    def test_atom_limit_exceeded(self):
        with self.assertRaises(ValueError) as ctx:
            smiles_to_xyz("CCO", max_atoms=2)
        self.assertIn("exceeding", str(ctx.exception).lower())

    def test_aromatic_nitrogen(self):
        result = smiles_to_xyz("c1ccncc1")  # pyridine
        self.assertEqual(result["num_atoms"], 11)  # C5H5N


# Buckminsterfullerene: ETKDG fails every attempt (600 of them, 10 per atom),
# 13 s on an M-series Mac before the random-coordinates retry gives up too.
C60 = ("C12=C3C4=C5C6=C1C7=C8C9=C1C%10=C%11C(=C29)C3=C2C3=C4C4=C5C5=C9C6=C7C6=C7C8=C1C1=C8C%10"
       "=C%10C%11=C2C2=C3C3=C4C4=C5C5=C%11C%12=C(C6=C95)C7=C1C1=C%12C5=C%11C4=C3C3=C5C(=C81)C%10=C23")


class TestEmbeddingTimeLimit(unittest.TestCase):
    """
    D151: the RDKit embedding had no time limit, so a SMILES that embeds
    slowly held the hosted Space's single worker past the 60 s job budget.
    Every attempt now runs under RDKit's own timeout (EmbedParameters.timeout,
    RDKit 2026.03), inside one budget, and running out is a coded refusal.
    """

    def test_a_slow_embedding_is_stopped_with_a_coded_refusal(self):
        import time
        from unittest import mock
        from rdkit.Chem import AllChem
        import smiles_to_xyz as module
        from contract import ContractError
        real = AllChem.EmbedMolecule
        timeouts = []

        def spy(mol, params):
            timeouts.append(params.timeout)
            return real(mol, params)

        started = time.monotonic()
        with mock.patch.object(module, "EMBED_BUDGET_SECONDS", 1, create=True), \
                mock.patch.object(AllChem, "EmbedMolecule", spy):
            with self.assertRaises(ContractError) as ctx:
                smiles_to_xyz(C60)
        self.assertLess(time.monotonic() - started, 6.0)
        # RDKit ran the ETKDG attempt under the limit and stopped it; no retry followed.
        self.assertEqual(timeouts, [1])
        err = ctx.exception
        self.assertEqual((err.code, err.status, err.field), ("smiles_embedding_timeout", 422, "smiles"))
        self.assertIn("1 s", str(err))

    def test_every_embedding_attempt_carries_a_time_limit(self):
        from unittest import mock
        from rdkit.Chem import AllChem
        import smiles_to_xyz as module
        real = AllChem.EmbedMolecule
        seen = []

        def first_attempt_fails(mol, params):
            seen.append((params.timeout, params.useRandomCoords, params.randomSeed))
            return -1 if len(seen) == 1 else real(mol, params)

        with mock.patch.object(AllChem, "EmbedMolecule", first_attempt_fails):
            result = smiles_to_xyz("CCO")
        self.assertEqual(result["num_atoms"], 9)
        self.assertEqual([(random, seed) for _, random, seed in seen], [(False, 42), (True, 42)])
        for timeout, _, _ in seen:
            self.assertGreaterEqual(timeout, 1)
            self.assertLessEqual(timeout, module.EMBED_BUDGET_SECONDS)

    def test_the_command_line_reports_the_code_and_status(self):
        import contextlib
        import io
        import json
        from unittest import mock
        import smiles_to_xyz as module
        out = io.StringIO()
        with mock.patch.object(module, "EMBED_BUDGET_SECONDS", 1, create=True), \
                contextlib.redirect_stdout(out):
            status = module.main([C60])
        self.assertEqual(status, 1)
        body = json.loads(out.getvalue())
        self.assertEqual(body["status"], "error")
        self.assertEqual((body["error"]["code"], body["error"]["status"], body["error"]["field"]),
                         ("smiles_embedding_timeout", 422, "smiles"))
        self.assertEqual(body["message"], body["error"]["message"])


if __name__ == "__main__":
    unittest.main()
