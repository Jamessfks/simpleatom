"""Phase 3 feasibility: time + accuracy of candidate features at OMP_NUM_THREADS=2.
Standalone: ase, numpy, torch, mace, rdkit (structure generation only)."""
import json, os, sys, time, platform, subprocess
import numpy as np, torch
torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", "2")))
import ase
from ase import Atoms, units
from ase.io import read
from ase.optimize import BFGS
from ase.vibrations import Vibrations, VibrationsData
from ase.thermochemistry import IdealGasThermo
from ase.filters import FrechetCellFilter
from ase.eos import EquationOfState
from ase.mep import NEB
from mace.calculators import mace_off, mace_mp
from importlib.metadata import version as v
out = {"machine": subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip(),
       "threads": torch.get_num_threads(), "python": platform.python_version(), "torch": torch.__version__,
       "ase": ase.__version__, "mace-torch": v("mace-torch")}
print(json.dumps(out)); R = {"env": out}
REPO = os.path.dirname(os.path.abspath(__file__)).rsplit("/docs/", 1)[0]
WD = sys.argv[1]; os.chdir(WD)

def rdkit_mol(smiles):
    from rdkit import Chem
    from rdkit.Chem import AllChem
    m = Chem.AddHs(Chem.MolFromSmiles(smiles)); AllChem.EmbedMolecule(m, randomSeed=7); AllChem.MMFFOptimizeMolecule(m)
    c = m.GetConformer(); return Atoms([a.GetSymbol() for a in m.GetAtoms()], positions=[list(c.GetAtomPosition(i)) for i in range(m.GetNumAtoms())])

def freqs_hessian(atoms, calc):
    t = time.perf_counter(); H = np.asarray(calc.get_hessian(atoms=atoms)); dt = time.perf_counter() - t
    n = len(atoms); H2 = H.reshape(3 * n, 3 * n); H2 = 0.5 * (H2 + H2.T)
    return VibrationsData.from_2d(atoms, H2).get_frequencies(), dt, H.shape

def freqs_fd(atoms, name):
    t = time.perf_counter(); vib = Vibrations(atoms, name=name, delta=0.01, nfree=2); vib.clean(); vib.run(); f = vib.get_frequencies(); dt = time.perf_counter() - t; vib.clean()
    return f, dt

def split(f, linear=False):
    f = np.asarray(f); nz = 5 if linear else 6
    order = np.argsort(np.abs(f)); vib = f[order[nz:]]
    return vib, int(np.sum(np.iscomplex(vib) & (np.abs(vib.imag) > 1e-6)))

mols = {"water": read(os.path.join(REPO, "public/demo/water.xyz")),
        "ethanol": read(os.path.join(REPO, "public/demo/ethanol.xyz")),
        "caffeine": rdkit_mol("Cn1cnc2c1c(=O)n(C)c(=O)n2C"),
        "ibuprofen": rdkit_mol("CC(C)Cc1ccc(cc1)C(C)C(=O)O"),
        "cholesterol": rdkit_mol("CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C")}
R["vib"] = {}
for size in ["small", "medium"]:
    calc = mace_off(model=size, default_dtype="float64", device="cpu")
    for name, a0 in mols.items():
        if size == "medium" and name not in ("water", "ethanol", "caffeine"): continue
        a = a0.copy(); a.calc = calc
        t = time.perf_counter(); conv = BFGS(a, logfile=None).run(fmax=0.001, steps=2000); topt = time.perf_counter() - t
        fmax = float(np.linalg.norm(a.get_forces(), axis=1).max())
        fh, th, shape = freqs_hessian(a, calc)
        ff, tf = freqs_fd(a, f"vib_{name}_{size}")
        vh, imh = split(fh); vf, imf = split(ff)
        d = np.abs(np.real(vh) - np.real(vf)) if len(vh) == len(vf) else None
        rec = {"nAtoms": len(a), "optConverged": bool(conv), "optSeconds": round(topt, 2), "fmaxAfter": fmax,
               "hessianSeconds": round(th, 3), "hessianShape": list(shape), "fdSeconds": round(tf, 2), "fdForceCalls": 6 * len(a) + 1,
               "nVib": len(vh), "expected3N6": 3 * len(a) - 6, "imagHessian": imh, "imagFD": imf,
               "maxAbsDeltaCm": float(d.max()) if d is not None else None, "medianAbsDeltaCm": float(np.median(d)) if d is not None else None,
               "lowestRealCm": float(np.real(vh).min()), "highestCm": float(np.real(vh).max())}
        if name == "water":
            rec["harmonicHessianCm"] = sorted(float(np.real(x)) for x in vh); rec["harmonicFDCm"] = sorted(float(np.real(x)) for x in vf)
            th_ = IdealGasThermo(vib_energies=np.real(vh) * units.invcm, geometry="nonlinear", atoms=a, symmetrynumber=2, spin=0, potentialenergy=0.0)
            rec["ZPE_eV"] = float(th_.get_ZPE_correction()); rec["S_298_JmolK"] = float(th_.get_entropy(298.15, 1e5, verbose=False) / units.J * units.mol)
            rec["H_298_minus_E_eV"] = float(th_.get_enthalpy(298.15, verbose=False))
        R["vib"][f"{name}/{size}"] = rec; print(name, size, json.dumps(rec)[:600], flush=True)

# Cell relaxation + EOS on silicon
R["cell"] = {}
from ase.build import bulk
for key in ["medium-mpa-0", "medium"]:
    calc = mace_mp(model=key, default_dtype="float64", device="cpu", dispersion=False)
    for rep in [(1, 1, 1), (2, 2, 2)]:
        si = bulk("Si", "diamond", a=5.60, cubic=True).repeat(rep); si.calc = calc
        t = time.perf_counter(); conv = BFGS(FrechetCellFilter(si), logfile=None).run(fmax=0.001, steps=500); trel = time.perf_counter() - t
        a_fin = float(np.cbrt(si.get_volume() / np.prod(rep)))
        s = si.get_stress(voigt=False); asym = float(np.abs(s - s.T).max())
        v0 = si.get_volume(); cell0 = si.get_cell().copy(); vols, ens = [], []
        t = time.perf_counter()
        for x in np.linspace(0.94, 1.06, 11):
            b = si.copy(); b.calc = calc; b.set_cell(cell0 * x ** (1 / 3), scale_atoms=True); vols.append(b.get_volume()); ens.append(b.get_potential_energy())
        eos = EquationOfState(vols, ens, eos="birchmurnaghan"); v_eos, e_eos, B = eos.fit(); teos = time.perf_counter() - t
        rec = {"nAtoms": len(si), "converged": bool(conv), "relaxSeconds": round(trel, 2), "a_relaxed_A": a_fin,
               "stressAsymMaxEvA3": asym, "eosSeconds": round(teos, 2), "eosPoints": 11, "B_GPa": float(B / units.GPa),
               "a_from_eos_A": float(np.cbrt(v_eos / np.prod(rep)))}
        R["cell"][f"{key}/{'x'.join(map(str, rep))}"] = rec; print("Si", key, rep, json.dumps(rec), flush=True)

# CI-NEB: HCN -> HNC (MACE-OFF small, float64), 9 intermediate images
calc = mace_off(model="small", default_dtype="float64", device="cpu")
def relaxed(a):
    a = a.copy(); a.calc = calc; BFGS(a, logfile=None).run(fmax=0.001, steps=1000); return a
hcn = relaxed(Atoms("HCN", positions=[[0, 0, -1.07], [0, 0, 0], [0, 0, 1.16]]))
hnc = relaxed(Atoms("HCN", positions=[[0, 0, 2.15], [0, 0, 0], [0, 0, 1.17]]))
images = [hcn] + [hcn.copy() for _ in range(9)] + [hnc]
for im in images: im.calc = mace_off(model="small", default_dtype="float64", device="cpu")
neb = NEB(images, climb=True, allow_shared_calculator=False); neb.interpolate(method="idpp")
t = time.perf_counter(); conv = BFGS(neb, logfile=None).run(fmax=0.05, steps=500); tneb = time.perf_counter() - t
E = [im.get_potential_energy() for im in images]
R["neb"] = {"system": "HCN->HNC", "images": 11, "converged": bool(conv), "seconds": round(tneb, 2),
            "barrier_eV": float(max(E) - E[0]), "reaction_eV": float(E[-1] - E[0])}
print("NEB", json.dumps(R["neb"]), flush=True)

# Force-call cost vs size (budget arithmetic)
R["forceCall"] = {}
for name in ["caffeine", "cholesterol"]:
    a = mols[name].copy(); a.calc = calc; a.get_forces(); a.positions += 1e-4
    t = time.perf_counter()
    for _ in range(10): a.positions += 1e-5; a.get_forces()
    R["forceCall"][f"{name}/{len(a)} atoms/off-small"] = round((time.perf_counter() - t) / 10, 4)
print("forceCall", R["forceCall"])
json.dump(R, open(os.path.join(WD, "feasibility.json"), "w"), indent=2)
