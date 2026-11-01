#!/usr/bin/env python3
"""
validate_result() judged by inputs it must reject (D81).

The distance check ignored the cell and stopped after 200 atoms, so two atoms
0.10 Å apart across a boundary, or atoms 250 and 251 0.3 Å apart, were
"reasonable". The MD check divided the energy range by |mean total energy|,
whose zero is arbitrary, so a +500 eV NVE drift was "stable". Each case here
failed before the fix.

Run: python test_scripts/run_suite.py test_validator.py --min 12
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from validate_calculation import validate_result  # noqa: E402


def _result(symbols, positions, lattice=None, **extra):
    n = len(symbols)
    out = {"status": "success", "energy": -4.0 * n, "forces": [[0.0, 0.0, 0.0]] * n,
           "symbols": symbols, "positions": positions, "lattice": lattice,
           "params": {"modelType": "MACE-MPA-0"}}
    out.update(extra)
    return out


def _md(ensemble, totals, temperatures, n_atoms=8, target=300.0):
    symbols = ["Si"] * n_atoms
    a = 5.43
    positions = [[(i % 2) * a / 2, ((i // 2) % 2) * a / 2, (i // 4) * a / 2] for i in range(n_atoms)]
    steps = list(range(0, 10 * len(totals), 10))
    return _result(symbols, positions, [[a, 0, 0], [0, a, 0], [0, 0, a]],
                   params={"modelType": "MACE-MPA-0", "calculationType": "molecular-dynamics",
                           "mdEnsemble": ensemble, "temperature": target, "timeStep": 1.0},
                   trajectory={"energies": [t - 1.0 for t in totals], "totalEnergies": totals,
                               "temperatures": temperatures, "step": steps})


class TestDistances(unittest.TestCase):

    def test_atoms_overlapping_across_a_cell_boundary_are_an_issue(self):
        r = validate_result(_result(["Cu", "Cu"], [[0.05, 1.0, 1.0], [3.45, 1.0, 1.0]],
                                    [[3.5, 0, 0], [0, 3.5, 0], [0, 0, 3.5]]))
        self.assertFalse(r["valid"], r)
        self.assertTrue(any("0.100" in i for i in r["issues"]), r["issues"])

    def test_atoms_past_index_200_are_checked(self):
        positions = [[2.0 * (i % 8), 2.0 * ((i // 8) % 8), 2.0 * (i // 64)] for i in range(256)]
        positions[251] = [positions[250][0] + 0.3, positions[250][1], positions[250][2]]
        r = validate_result(_result(["Ar"] * 256, positions, [[16, 0, 0], [0, 16, 0], [0, 0, 8]]))
        self.assertFalse(r["valid"], r)
        self.assertTrue(any("0.300" in i for i in r["issues"]), r["issues"])

    def test_an_isolated_molecule_uses_plain_distances(self):
        r = validate_result(_result(["O", "H", "H"],
                                    [[0, 0, 0], [0.9572, 0, 0], [-0.24, 0.9266, 0]]))
        self.assertTrue(r["valid"], r)
        self.assertTrue(any("0.957" in i for i in r["info"]), r["info"])

    def test_a_crystal_reports_its_minimum_image_distance(self):
        a = 5.43
        r = validate_result(_result(["Si", "Si"], [[0, 0, 0], [a / 4, a / 4, a / 4]],
                                    [[0, a / 2, a / 2], [a / 2, 0, a / 2], [a / 2, a / 2, 0]]))
        self.assertTrue(r["valid"], r)
        self.assertTrue(any("2.351" in i for i in r["info"]), r["info"])


class TestMaceOffEnergyBand(unittest.TestCase):
    """D52: MACE-OFF's E/N depends on which elements are present (water -693.7, CH2Br2
    -28232.6 eV/atom), so it is judged relative to the model's own isolated atoms."""

    def _off(self, symbols, energy, relative=None):
        r = _result(symbols, [[1.2 * i, 0, 0] for i in range(len(symbols))],
                    params={"modelType": "MACE-OFF"})
        r["energy"] = energy
        if relative is not None:
            r["properties"] = {"energyPerAtomVsIsolatedAtoms": relative}
        return r

    def test_heavy_atoms_are_not_flagged_by_their_raw_energy(self):
        r = validate_result(self._off(["C", "H", "H", "Br", "Br"], -28232.6 * 5, relative=-2.97))
        self.assertTrue(r["valid"], r)
        self.assertEqual([w for w in r["warnings"] if "Energy/atom" in w], [])
        self.assertTrue(any("isolated atoms" in i and "-2.97" in i for i in r["info"]), r["info"])

    def test_a_relative_energy_outside_the_enforced_band_is_an_issue(self):
        r = validate_result(self._off(["O", "H", "H"], -693.7 * 3, relative=-15.0))
        self.assertFalse(r["valid"], r)
        self.assertTrue(any("isolated atoms" in i for i in r["issues"]), r["issues"])

    def test_without_the_relative_energy_the_check_says_it_was_skipped(self):
        r = validate_result(self._off(["O", "H", "H"], -693.7 * 3))
        self.assertTrue(r["valid"], r)
        self.assertTrue(any("skipped" in i for i in r["info"]), r["info"])

    def test_the_contract_claims_no_raw_band_for_mace_off(self):
        import json
        conv = json.loads((pathlib.Path(__file__).resolve().parent.parent / "mace-api" / "contract.json")
                          .read_text())["energyConventions"]["off"]
        self.assertIsNone(conv["enforced"])
        self.assertIsNone(conv["typical"])
        self.assertIsNotNone(conv["relativeToIsolatedAtoms"]["enforced"])


class TestMolecularDynamics(unittest.TestCase):

    def test_a_drifting_nve_run_is_an_issue(self):
        totals = [-40.0 + 500.0 * k / 99 for k in range(100)]
        r = validate_result(_md("NVE", totals, [300.0] * 100))
        self.assertFalse(r["valid"], r)
        self.assertTrue(any("not conserved" in i for i in r["issues"]), r["issues"])

    def test_a_conserving_nve_run_is_valid_and_states_its_drift(self):
        totals = [-40.0 + 1e-4 * ((-1) ** k) for k in range(100)]
        r = validate_result(_md("NVE", totals, [300.0] * 100))
        self.assertTrue(r["valid"], r)
        self.assertTrue(any("meV/atom/ps" in i for i in r["info"]), r["info"])

    def test_a_thermostat_that_lost_control_is_an_issue(self):
        temps = [300.0] * 50 + [3000.0 + 100 * k for k in range(50)]
        r = validate_result(_md("NVT", [-40.0 + 0.1 * k for k in range(100)], temps))
        self.assertFalse(r["valid"], r)
        self.assertTrue(any("300 K" in i for i in r["issues"]), r["issues"])

    def test_a_thermostatted_run_near_its_target_is_valid(self):
        temps = [300.0 + 40.0 * ((-1) ** k) for k in range(100)]
        r = validate_result(_md("NVT", [-40.0 + 0.3 * ((-1) ** k) for k in range(100)], temps))
        self.assertTrue(r["valid"], r)
        self.assertFalse(any("fluctuation" in w for w in r["warnings"]), r["warnings"])


if __name__ == "__main__":
    unittest.main()
