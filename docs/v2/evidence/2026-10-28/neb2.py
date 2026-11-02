import json, os, time, numpy as np, torch
torch.set_num_threads(2)
from ase import Atoms
from ase.optimize import BFGS, FIRE
from ase.mep import NEB
from mace.calculators import mace_off
def calc(): return mace_off(model="small", default_dtype="float64", device="cpu")
def arc(theta, r=1.15, cn=1.16):
    mid = np.array([0, 0, cn / 2]); h = mid + r * np.array([np.sin(theta), 0, -np.cos(theta)])
    return Atoms("HCN", positions=[h, [0, 0, 0], [0, 0, cn]])
def relaxed(a):
    a.calc = calc(); BFGS(a, logfile=None).run(fmax=0.001, steps=1000); return a
rs, ps = relaxed(arc(0.0, r=1.07 + 0.58)), relaxed(arc(np.pi, r=0.99 + 0.58))
images = [rs] + [arc(t) for t in np.linspace(0, np.pi, 11)[1:-1]] + [ps]
for im in images[1:-1]: im.calc = calc()
neb = NEB(images, climb=True)
t = time.perf_counter(); conv = FIRE(neb, logfile=None).run(fmax=0.05, steps=1500); dt = time.perf_counter() - t
E = [im.get_potential_energy() for im in images]
print(json.dumps({"system": "HCN->HNC arc guess", "images": len(images), "converged": bool(conv), "seconds": round(dt, 2),
                  "steps": FIRE.__name__, "barrier_eV": round(max(E) - E[0], 4), "reaction_eV": round(E[-1] - E[0], 4),
                  "tsImage": int(np.argmax(E))}))
