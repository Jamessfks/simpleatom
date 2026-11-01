<div align="center">

# SimpleAtom

**MACE machine-learning force fields, in your browser.**
Single-point energies, geometry optimisation and molecular dynamics — no installation, no command line.

[**mace-lake.vercel.app**](https://mace-lake.vercel.app) · [Guided demo](https://mace-lake.vercel.app/calculate?demo=true) · [User docs](https://mace-lake.vercel.app/docs) · [Contributor docs](docs/index.md) · [Changelog](CHANGELOG.md)

<a href="https://github.com/Jamessfks/simpleatom/releases"><img src="https://img.shields.io/badge/version-2.2.0-blue?style=flat-square" alt="Version 2.2.0"/></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT licence"/></a>
<a href="https://github.com/ACEsuit/mace"><img src="https://img.shields.io/badge/mace--torch-0.3.16-purple?style=flat-square" alt="mace-torch 0.3.16"/></a>
<a href="https://github.com/Jamessfks/simpleatom/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Jamessfks/simpleatom/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"/></a>

</div>

<p align="center"><a href="https://mace-lake.vercel.app/calculate"><img src="public/Demo4.png" alt="SimpleAtom calculator: structure upload, model and parameters, 3D viewer and results" width="88%"/></a></p>

## What it does

Upload a structure (`.xyz`, `.extxyz`, `.cif`, POSCAR, `.pdb`), pick one from
the ml-peg catalog, type a SMILES string, or sketch a molecule — then run a
[MACE](https://github.com/ACEsuit/mace) foundation model:

| Model | For | Licence |
|---|---|---|
| **MACE-MPA-0** (default) | Materials and crystals, 89 elements — upstream's own default; Matbench Discovery F1 0.852 | MIT |
| MACE-MP-0 | The 2023 materials model, kept so earlier results can be reproduced | MIT |
| MACE-OFF23 | Organic molecules (H, C, N, O, F, P, S, Cl, Br, I) | [ASL](https://github.com/gabor1/ASL) — non-commercial |

Results come with a 3D viewer (forces, measurement), charts, a trajectory
player, PDF/CSV/JSON export, a shareable MACE Link, and a **reproducibility
manifest**: the SHA-256 of the checkpoint that was actually loaded, library
versions, the structure hash, the MD seed and the code commit. Long runs show
real progress and can be cancelled. A multi-model benchmark compares models
across reference structures and Materials Project formation energies.

**What it is not.** MACE is an interatomic potential trained on DFT data; it is
fast and good, but not "quantum-accurate", and SimpleAtom says what each model
was trained on and how it scores. There is no electron density, so no orbitals
or partial charges; phonons and cell relaxation are not implemented and are
refused rather than faked. See [Scientific integrity](docs/explanation/scientific-integrity.md).

## Run it locally

```bash
git clone https://github.com/Jamessfks/simpleatom.git && cd simpleatom
npm ci
python3 -m pip install -r mace-api/requirements.txt
npm run dev            # http://localhost:3000/calculate?demo=true
```

Local mode needs no configuration. It accepts your own fine-tuned `.model`
checkpoints only after you opt in with `ALLOW_CUSTOM_MODELS=1`, because loading one
runs code from the file; the public site never loads them. On macOS, export `KMP_DUPLICATE_LIB_OK=TRUE` before
running Python yourself. Details: [Install](docs/how-to/install.md) ·
[Deploy](docs/how-to/deploy.md) · [Troubleshoot](docs/how-to/troubleshoot.md).

## Architecture in one paragraph

A Next.js 16 front end (Vercel) submits calculations as jobs to one Python
engine (`mace-api/calculate.py`, ASE + mace-torch) — either spawned locally or
running as FastAPI on a Hugging Face Space. `mace-api/contract.json` defines
every accepted parameter, limit and model, enforced by the backend and mirrored
by the UI. Only pinned checkpoints are ever unpickled. Shared results go
through a validating server route into Supabase. CI gates every merge and is
the only thing that deploys the backend. Read the
[architecture](docs/explanation/architecture.md) and the
[decision records](docs/adr/README.md).

## Contributing, security, citation

[CONTRIBUTING.md](CONTRIBUTING.md) explains the gates every change must pass.
Report vulnerabilities as described in [SECURITY.md](SECURITY.md). If you use
SimpleAtom in published work, cite it with [CITATION.cff](CITATION.cff) and cite
MACE (Batatia et al., NeurIPS 2022) and the model you used.

Built by Zicheng Zhao, Northeastern University · zhao.zic@northeastern.edu or zezepy070413@gmail.com ·
MIT licence; third-party components and model licences in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
