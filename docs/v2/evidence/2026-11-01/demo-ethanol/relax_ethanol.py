#!/usr/bin/env python3
"""
D119: the user-facing demo ethanol, as a documented MACE-OFF float64 relaxation.

The old demo (now test/fixtures/ethanol-golden.xyz, which carries the golden
energies) is strained: C-C 1.478 A, max|F| 2.04 eV/A, 0.296 eV above its relaxed
geometry. This relaxes it with MACE-OFF23 medium in float64, BFGS to fmax 0.001 eV/A,
positions only, twice: as it stands (it falls into the gauche conformer) and with
the hydroxyl H turned to the trans (anti) position CCCBDB's experimental geometry
has. The trans result becomes public/demo/ethanol.xyz; its bonds are compared
with the CCCBDB values in docs/v2/validation/structure-references.json.

    KMP_DUPLICATE_LIB_OK=TRUE python docs/v2/evidence/2026-11-01/demo-ethanol/relax_ethanol.py

Writes relaxed.xyz and results.json next to this script.
"""
import json
import pathlib

import numpy as np
from ase.io import read, write
from ase.optimize import BFGS
from mace.calculators import mace_off

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[4]
START = ROOT / "test" / "fixtures" / "ethanol-golden.xyz"
CCCBDB = {"r_CC": 1.512, "r_CO": 1.431, "r_OH": 0.971, "angle_CCO": 107.8, "angle_HOC": 105.4}

def relax(atoms):
    atoms.calc = mace_off(model="medium", default_dtype="float64", device="cpu")
    e0 = float(atoms.get_potential_energy())
    f0 = float(np.linalg.norm(atoms.get_forces(), axis=1).max())
    opt = BFGS(atoms, logfile=None)
    converged = bool(opt.run(fmax=0.001, steps=1000))
    return {"converged": converged, "steps": int(opt.nsteps),
            "energy_start_eV": e0, "energy_relaxed_eV": float(atoms.get_potential_energy()),
            "max_force_start_eV_per_A": f0,
            "max_force_relaxed_eV_per_A": float(np.linalg.norm(atoms.get_forces(), axis=1).max())}


def geometry(atoms):
    c1, c2, o = 0, 1, 2
    h = int(np.argmin([atoms.get_distance(o, i) for i in range(3, len(atoms))])) + 3
    return h, {"r_CC": atoms.get_distance(c1, c2), "r_CO": atoms.get_distance(c2, o),
               "r_OH": atoms.get_distance(o, h), "angle_CCO": atoms.get_angle(c1, c2, o),
               "angle_HOC": atoms.get_angle(h, o, c2), "dihedral_CCOH": atoms.get_dihedral(c1, c2, o, h)}


# The strained file relaxes to the gauche conformer (C-C-O-H about 60 degrees).
gauche = read(str(START))
gauche_run = relax(gauche)
_, gauche_geom = geometry(gauche)

# CCCBDB's experimental ethanol is trans (anti): rotate the hydroxyl H to 180 degrees and relax.
trans = read(str(START))
h, _ = geometry(trans)
mask = [i == h for i in range(len(trans))]
trans.set_dihedral(0, 1, 2, h, 180.0, mask=mask)
trans_run = relax(trans)
_, measured = geometry(trans)

comment = ("Ethanol C2H5OH, trans (anti) conformer, MACE-OFF23 medium float64 BFGS fmax 0.001 eV/A; "
           "see docs/v2/evidence/2026-11-01/demo-ethanol")
write(str(HERE / "relaxed.xyz"), trans, format="xyz", comment=comment)
result = {
    "start": str(START.relative_to(ROOT)), "model": "MACE-OFF23 medium", "dtype": "float64",
    "optimizer": "BFGS", "fmax_target_eV_per_A": 0.001,
    "trans": {**trans_run, "geometry": {k: round(float(v), 4) for k, v in measured.items()}},
    "gauche": {**gauche_run, "geometry": {k: round(float(v), 4) for k, v in gauche_geom.items()}},
    "trans_minus_gauche_eV": trans_run["energy_relaxed_eV"] - gauche_run["energy_relaxed_eV"],
    "cccbdb_experimental_trans": CCCBDB,
    "trans_difference_vs_cccbdb": {k: round(float(measured[k]) - v, 4) for k, v in CCCBDB.items()},
}
(HERE / "results.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
