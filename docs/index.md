# SimpleAtom — contributor documentation

SimpleAtom is a free web interface to [MACE](https://github.com/ACEsuit/mace)
machine-learning interatomic potentials: single-point energies and forces,
BFGS geometry optimisation, and molecular dynamics, with a reproducibility
manifest on every result.

**Using SimpleAtom?** The user documentation lives in the app, where you use
it: [mace-lake.vercel.app/docs](https://mace-lake.vercel.app/docs) — models,
calculation types, units, validation, FAQ.

**Working on SimpleAtom?** Start here.

| | |
|---|---|
| [Architecture](explanation/architecture.md) | How a calculation flows from the browser to MACE and back |
| [Scientific integrity](explanation/scientific-integrity.md) | The rules that keep results honest, and why each exists |
| [Install and run locally](how-to/install.md) | Clone, install, check |
| [Deploy](how-to/deploy.md) | Vercel, the Hugging Face Space (via CI), Supabase |
| [Troubleshoot](how-to/troubleshoot.md) | Common errors and what they mean |
| [HTTP API](reference/api.md) | Routes, jobs, errors, result shape |
| [Request contract](reference/contract.md) | Every accepted parameter, limit and model — generated from `mace-api/contract.json` |
| [Environment variables](reference/environment.md) | What to set where |
| [Decision records](adr/README.md) | Why the system is the way it is |
| [Audit 2026-10-20](audits/2026-10-20.md) | The v2.2.0 audit: findings and their status |

Contributing: see [`CONTRIBUTING.md`](https://github.com/Jamessfks/simpleatom/blob/main/CONTRIBUTING.md).
Security reports: [`SECURITY.md`](https://github.com/Jamessfks/simpleatom/blob/main/SECURITY.md).
