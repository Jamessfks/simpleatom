> **Superseded snapshot.** Written 2026-08-09 against the code at that time; many findings are fixed. Current state: [docs/audits/2026-10-20.md](../audits/2026-10-20.md) and `docs/v2/defects.json`.

# Scientific Accuracy Tooling for SimpleAtom v2.0

**Research date:** 2026-08-09 · **Author:** research pass for Zicheng Zhao
**Question:** what actually exists *today* to make an AI coding agent scientifically accurate on this codebase, and what should we install?

Everything below was verified by direct probe (live HTTP request, PyPI JSON API, authenticated GitHub API, or local execution) on 2026-08-09. Claims I could not verify are marked **UNVERIFIED**. Things that do not exist are called out as such rather than replaced with a plausible-sounding name.

**Verified local environment:** Python 3.13.11 · ASE 3.27.0 (3.29.0 available) · NumPy 2.4.2 · PyTorch 2.10.0 · mace-torch 0.3.15 (0.3.16 available) · pydantic 2.12.4 already present. `pytest`, `hypothesis`, `pint` are **not** installed.

---

## Recommendation table

Ordered by value-per-unit-effort. "Effort" is my estimate of implementation time for someone who knows this codebase.

| # | Tool | What it gives us | Install | Effort | Verdict |
|---|------|------------------|---------|--------|---------|
| 0 | **Fix `params` echo in `_build_result`** | Turns the existing validator's model-aware energy bounds from dead code into working code. Currently every MACE-OFF result is judged against MACE-MP-0 bounds. | none (1 line) | 5 min | **ADOPT — do this first** |
| 1 | **Fix the `validate_calculation.py` path** | The documented command `python mace-api/validate_calculation.py --test` fails — the file is in `test_scripts/`. 19 references across README, CLAUDE.md, in-app `/docs`. | none (move file) | 15 min | **ADOPT** |
| 2 | **Provenance manifest** (stdlib + `pydantic` 2.12.4, already installed) | Per-run record: package versions, **SHA256 of the actual model weights**, input hash, git SHA, seed, params. This is the literal answer to "documentation for future verification." | already installed | 2–3 h | **ADOPT** |
| 3 | **Seed the MD RNG** | `MaxwellBoltzmannDistribution` is unseeded → MD is not reproducible run-to-run. `smiles_to_xyz.py` already sets `randomSeed=42`, so the pattern exists in-repo. | none | 30 min | **ADOPT** |
| 4 | **`pytest` + `pytest-regressions` 2.11.0** | Golden-file tests for energy/force arrays with explicit `atol`/`rtol`. Catches silent numeric drift from a MACE or torch upgrade. | `pip install pytest pytest-regressions` | 3–4 h | **ADOPT** |
| 5 | **`hypothesis` 6.165.2** | Property tests for physics invariants: energy invariant under rotation/translation, `Σ F_i ≈ 0` for isolated molecules. Tests laws, not values. | `pip install "hypothesis[numpy]"` | 3–4 h | **ADOPT** |
| 6 | **`ase.db` (already installed with ASE)** | Zero-new-dependency append-only calculation log. SQLite or JSON, queryable, stores structure + arbitrary key/value + nested JSON. Verified working. | none | 1–2 h | **ADOPT** |
| 7 | **arXiv MCP server** (`blazickjp/arxiv-mcp-server`, 3032★) | Agent can search/read arXiv full text + LaTeX by section. | `claude mcp add --transport stdio --scope user arxiv -- uvx arxiv-mcp-server` | 10 min | **ADOPT (optional)** |
| 8 | **HF papers markdown endpoint** | Full text of all three MACE papers as markdown, no auth, no install. Already available via the installed `huggingface-skills` plugin. | already installed | 0 | **ADOPT — free** |
| 9 | **OPTIMADE no-auth MP endpoint** | `formation_energy_per_atom` + `energy_above_hull` from Materials Project **with no API key**. Verified live. | `curl` / `pip install optimade` | 2–4 h | **ADOPT (v2 benchmark)** |
| 10 | **`matbench-discovery`** | Published MACE-MP-0 and MACE-MPA-0 leaderboard numbers — cite instead of re-deriving. Verified: `models/mace/mace-mp-0.yml`, `mace-mpa-0.yml`. | `pip install matbench-discovery` | 1–2 h | **ADOPT (cite)** |
| 11 | **`mp-api[mcp]` 0.46.4** | **Official first-party** Materials Project MCP server (`mpmcp`). Gives the agent direct MP DFT queries. Needs a free API key. | `pip install "mp-api[mcp]"` + key | 30 min | **CONSIDER** |
| 12 | **K-Dense `paper-lookup` skill** | 11 literature APIs (PubMed, arXiv, OpenAlex, Crossref, Unpaywall…), **no credentials**, built around reproducible provenance. | `npx skills add K-Dense-AI/scientific-agent-skills` | 15 min | **CONSIDER — see §1.5** |
| 13 | **`pint` 0.25.3 / `unyt` 3.1.0** | Dimensional-analysis unit checking. | `pip install pint` | 4–6 h | **SKIP for now** — see §3.1 |
| — | Third-party Materials Project MCP servers | 12★ and 1★ hobby repos, superseded by the official `mp-api[mcp]`. | — | — | **SKIP** |
| — | PubChem MCP servers | All ≤11★ hobby. PUG-REST needs no auth — just `curl` it. | — | — | **SKIP** |
| — | AiiDA / atomate2 / jobflow | AiiDA hard-requires PostgreSQL **and** RabbitMQ. Wrong weight class entirely. | — | — | **SKIP** |
| — | `recipy`, `provenance`, `cffconvert`, `pytest-snapshot`, `sacred` | Dead or stale. See §3.3. | — | — | **SKIP** |
| — | DVC / MLflow | Solve multi-run experiment tracking we don't have. | — | — | **SKIP** |

---

## §0. What I found in *this* repo (read this first)

The most valuable finding of this research is not an external tool. **The scientific-accuracy machinery this repo already claims to have is not actually running.** Four verified defects, all cheap to fix.

### 0.1 The documented validation command does not work

`CLAUDE.md`, `README.md`, `docs/science/validation.md`, `docs/getting-started.md`, and the in-app `app/docs/validation/page.tsx` all instruct the reader (and any AI agent following `CLAUDE.md`) to run:

```
python mace-api/validate_calculation.py --test
```

Verified result:

```
python3: can't open file '.../mace-api/validate_calculation.py': [Errno 2] No such file or directory
```

The file lives at **`/Users/jameszhao/Desktop/mace/test_scripts/validate_calculation.py`**. Git history confirms it was never in `mace-api/`. There are **19 references to the wrong path** across docs and UI.

This matters more than a typo: `CLAUDE.md` line 85 tells agents to "spawn a validation agent to run `python mace-api/validate_calculation.py --test`" after every `mace-api/*.py` edit. That instruction fails silently-ish every time, so the validation gate in the agent workflow never actually fires.

### 0.2 The validator's model-aware energy bounds are dead code

`test_scripts/validate_calculation.py:57` reads the model type to pick energy bounds:

```python
params = result.get("params", {})
model_type = params.get("modelType", "unknown")
```

But `mace-api/calculate.py::_build_result()` **never puts `params` into the result dict.** So `model_type` is always `"unknown"` and `is_off` is always `False` → MACE-MP-0 bounds (min −20 eV/atom) are applied to *everything*, including MACE-OFF results that legitimately sit at −100 to −600 eV/atom.

This is a contract mismatch, not a design choice: `types/mace.ts:63` already declares `params?: Partial<CalculationParams>` on `CalculationResult`. The TypeScript side expects it; the Python side never sends it.

Demonstrated with a realistic MACE-OFF ethanol result (9 atoms, −4200 eV):

```
--- CASE 1: exactly what calculate.py emits today (no params) ---
  WARNING: Energy/atom = -466.6667 eV is unusually low
           (< -20.0 eV/atom for unknown). Check structure.

--- CASE 2: same result WITH params echoed (the one-line fix) ---
  info: Energy/atom = -466.6667 eV — within reasonable range for MACE-OFF
```

Every valid MACE-OFF calculation currently produces a spurious "check structure" warning. The validator's own `--test` suite shows the same tell: `"within reasonable range for unknown"`.

**Fix:** add `"params": params` to the dict in `_build_result()` (and thread `params` into it). One line.

### 0.3 The validator is never called in the production path

`grep` across the whole repo: `validate_result` / `validate_params` are referenced **only inside `test_scripts/validate_calculation.py` itself**. Not by `calculate.py`, not by `calculate_local.py`, not by `main.py`, not by `app/api/calculate/route.ts`. It is a standalone script a human must remember to run, not a gate.

For "every scientific calculation needs double-checking," this is the gap: validation exists but is not wired to anything.

### 0.4 MD is not reproducible

`_run_md()` calls `MaxwellBoltzmannDistribution(atoms, temperature_K=temp_K)` with no seed. There is no `seed` or RNG handling anywhere in `mace-api/calculate.py`. Two identical MD requests produce different trajectories with no record of why.

Note the repo already does this correctly elsewhere — `mace-api/smiles_to_xyz.py:55` sets `params.randomSeed = 42` for RDKit embedding. The pattern just wasn't applied to MD.

### 0.5 Nothing records *what produced* a result

The result dict contains `energy`, `forces`, `positions`, `symbols`, `lattice`, `properties`, `message`, `timeTaken`. It does **not** contain: mace-torch version, ASE version, torch version, model identity or checksum, input file hash, or the parameters used. A shared MACE Link result is currently unreproducible in principle — you cannot tell which model weights generated it.

---

## §1. Agent skills / plugins for scientific literature

### 1.1 The official channels have nothing scientific

Verified by parsing the real `marketplace.json` in the local checkout of `anthropics/claude-plugins-official` — **284 plugins**, ground truth, not a scrape:

- 39 are vendored locally as first-party (`agent-sdk-dev`, `claude-security`, `code-review`, `feature-dev`, `math-olympiad`, `mcp-server-dev`, `pr-review-toolkit`, various `*-lsp`, …) plus 15 external (`asana`, `context7`, `github`, `linear`, `playwright`, `serena`, `terraform`, …); the rest are registry entries.
- **Dedicated science / chemistry / paper / citation plugins: zero out of 284.**

Regex matches on science-ish keywords are all false positives, and two are actively misleading:

| Plugin | What it actually is |
|---|---|
| `atomic-agents` | **Not atomistic simulation.** An AI-agent framework ("building AI agents with the Atomic Agents framework"). |
| `exa`, `tavily`, `youdotcom-agent-skills` | General *web* search / "research with citations" meaning web citations, not academic reference management. |
| `bigdata-com` | Financial research (RavenPack). |
| `dominodatalab` | MLOps platform. |
| `math-olympiad` | Competition math, not literature. |

`anthropics/skills` (167k★, pushed 2026-08-07) contains 17 skills — `algorithmic-art`, `brand-guidelines`, `canvas-design`, `claude-api`, `doc-coauthoring`, `docx`, `frontend-design`, `internal-comms`, `mcp-builder`, `pdf`, `pptx`, `skill-creator`, `slack-gif-creator`, `theme-factory`, `web-artifacts-builder`, `webapp-testing`, `xlsx`. **No science skills.**

> The in-client MCP registry search tool returned empty results for *every* query including `"github"`, so it is non-functional in this environment. I am reporting that as inconclusive, not as evidence of absence.

### 1.2 The best literature option is already installed and costs nothing

The `huggingface-skills` plugin (v1.0.23, from `github.com/huggingface/skills`, Apache-2.0, first-party Hugging Face) ships a `huggingface-papers` skill. Its core mechanism is a plain unauthenticated fetch:

```bash
curl -s "https://huggingface.co/papers/{ARXIV_ID}.md"
```

The skill's own description scopes it to "AI research papers," which suggested it might not cover computational chemistry. **I tested it against the three papers that actually matter for this project:**

| arXiv ID | Paper | Result |
|---|---|---|
| `2401.00096` | A foundation model for atomistic materials chemistry (MACE-MP-0) | HTTP 200, 113 KB, 10 sections |
| `2206.07697` | MACE: Higher Order Equivariant Message Passing NNs | HTTP 200, 72 KB, 10 sections |
| `2312.15211` | Short Range Transferable ML Force Fields (MACE-OFF) | HTTP 200, 95 KB, 10 sections |

Content depth confirmed — the MACE-OFF fetch yields `### II.2 Train`, `### II.3 Model detail`, `### III.5 Comput…` headings, and numeric data extracts cleanly (`0.040 eV`, `2.27 Å`, `1.0 meV`, `0.025 Å`).

**Verdict: ADOPT, zero cost.** This is the single best literature capability available and it is already installed. Chemistry/materials coverage works despite the AI-flavored skill description.

### 1.3 Dedicated arXiv MCP servers

Verified via authenticated GitHub API and PyPI:

| Repo | Stars | Last push | Open issues | PyPI | Verdict |
|---|---|---|---|---|---|
| `blazickjp/arxiv-mcp-server` | 3032 | 2026-07-29 | 13 | `arxiv-mcp-server` 0.6.2 (2026-07-29) | **REAL, MAINTAINED** |
| `andybrandt/mcp-simple-arxiv` | 200 | 2026-02-19 | 2 | UNVERIFIED | Real, quiet ~6 mo |
| `prashalruchiranga/arxiv-mcp-server` | 40 | 2025-08-08 | 0 | UNVERIFIED | Stale ~12 mo, hobby |

`blazickjp/arxiv-mcp-server` is Apache-2.0, runs locally over stdio, and per its README does search, paper download, bounded full-text reading, **original LaTeX retrieval by section**, citation-graph following, and research alerts. LaTeX-by-section is the genuinely useful bit over the HF endpoint — that is where equations survive intact.

```bash
# verified from the repo README
claude mcp add --transport stdio --scope user arxiv -- uvx arxiv-mcp-server

# or as a plugin (MCP connection + bundled arXiv research skill)
claude plugin marketplace add blazickjp/arxiv-mcp-server
```

Hobby project, not officially maintained by anyone — but 3k stars and a push 11 days ago. **ADOPT if you want equation-level extraction; otherwise §1.2 already covers you.**

### 1.4 Citation management

| Target | Best repo | Stars | Last push | Verdict |
|---|---|---|---|---|
| Zotero | `54yyyu/zotero-mcp` | **4577** | 2026-08-06 | **REAL, actively maintained** |
| Zotero (alt) | `cookjohn/zotero-mcp` | 1065 | 2026-06-11 | Real |
| Semantic Scholar | `akapet00/semantic-scholar-mcp` | 30 | 2026-05-07 | Hobby |
| OpenAlex | `hbiaou/openalex-mcp` | 15 | 2025-06-25 | Hobby, stale |
| OpenAlex (alt) | `cyanheads/openalex-mcp-server` | 11 | 2026-07-27 | Hobby |

Zotero is the only mature one. PyPI package name is **`zotero-mcp-server`** (0.9.1, released 2026-08-06) — note it differs from the repo name.

```bash
uv tool install zotero-mcp-server
zotero-mcp setup
```

Optional extras exist for semantic search (ChromaDB), PDF outlines (PyMuPDF), and Scite citation intelligence.

**Verdict: ADOPT only if you already keep a Zotero library.** For a paper's reference list, this is a real workflow improvement. It does nothing for calculation correctness. Semantic Scholar and OpenAlex MCP servers are all sub-30★ hobby projects — use their plain REST APIs instead if needed.

### 1.5 The most complete literature option: K-Dense `scientific-agent-skills`

`K-Dense-AI/scientific-agent-skills` — **33,022★, MIT, pushed 2026-08-09 (today), 161 skills, 6 open issues.** Third-party (K-Dense Inc., a commercial company), not Anthropic-blessed.

```bash
npx skills add K-Dense-AI/scientific-agent-skills
# or per-skill with GitHub CLI v2.90+:  gh skill install ...
```

The relevant skill is **`paper-lookup`**, and I read its `SKILL.md` directly. It covers 11 literature APIs — PubMed, PMC, Europe PMC, bioRxiv, medRxiv, arXiv, OpenAlex, Crossref, Semantic Scholar, CORE, Unpaywall — with, verbatim from its frontmatter, *"No credentials are required"* (optional keys only raise rate limits). Python 3.11+ stdlib only.

Two things make it unusually well-matched to your stated requirement:

1. It is explicitly built around **reproducible provenance** — its own description asks for results carrying "endpoints, parameters, identifiers, access date" so "a human or another agent can repeat it."
2. It documents a failure mode worth internalising project-wide: **"These APIs fail with HTTP 200."** PMC returns a well-formed article with an empty body when redistribution is forbidden; arXiv returns one entry titled `Error` for a malformed parameter; Europe PMC puts `errCode` in a 200 body. Silent wrong answers, never an exception.

Sibling skills `citation-management` (→ validated BibTeX) and `literature-review` are also real.

**Caveats, be clear-eyed:**
- It installs **161 skills** — a large surface for what you need. Prefer installing only `paper-lookup` / `citation-management`.
- Its chemistry skills are **not relevant to this project**. I checked `molecular-dynamics`: it wraps **OpenMM + MDAnalysis for protein/small-molecule biophysics**, not ASE/MACE atomistic materials MD. Likewise `deepchem` / `medchem` are drug-discovery oriented. **Do not install this expecting MACE or materials support.**
- Star count on a 10-month-old commercial repo is a marketing signal as much as a quality one; the *content* checks out on inspection, the popularity claim should not be over-read.

**Also real, if you prefer an MCP server to a skill:** `openags/paper-search-mcp` — 2,383★, MIT, pushed 2026-07-02, 48 open issues. Covers arXiv, PubMed, bioRxiv, medRxiv, Semantic Scholar, Crossref, OpenAlex in one server.

---

## §2. MCP servers for scientific data

### 2.1 Materials Project — an *official* MCP server exists (I initially got this wrong)

**Correction, stated plainly:** my first pass concluded "no official Materials Project MCP server exists," based on searching the `materialsproject` GitHub org for **repository names** matching `mcp|agent|llm|ai` — which returns zero. That method has a blind spot: the server is a **subpackage inside the existing `mp-api` repo**, not a separate repo. A parallel research stream caught it and I then verified it directly.

**Verified evidence:**

- `mp-api` 0.46.4 PyPI metadata declares the extra: `fastmcp; extra == "mcp"` and `fastmcp; extra == "all"`.
- `materialsproject/api` (176★, pushed 2026-07-16, not archived) contains `mp_api/mcp/` with `server.py`, `tools.py`, `mp_mcp.py`, `_schemas.py`, `utils.py`, `__init__.py`.
- `pyproject.toml` declares the console script: `mpmcp = "mp_api.mcp.server:_run_mp_mcp_server"`.

```bash
pip install "mp-api[mcp]"
export MP_API_KEY=...   # free, from next-gen.materialsproject.org/dashboard
mpmcp
```

This is **first-party, released (not an unmerged branch), and new**. Pin the version and expect rough edges — the official docs page for it reportedly still tells you to clone a core contributor's fork rather than use the released extra, which means documentation is lagging the code.

Community alternatives are now superseded, but for completeness:

| Repo | Stars | Last push | Verdict |
|---|---|---|---|
| `pathintegral-institute/mcp.science` | 146 | 2026-02-27 | Real multi-server science collection (MIT). Includes a `materials-project` server **and** a `gpaw-computation` server that runs actual DFT via GPAW. Best third-party option. |
| `benedictdebrah/materials-project-mcp` | 12 | 2026-05-20 | Hobby. Not dependable. |
| `fair2wise/materials_project_mcp` | 1 | 2025-06-17 | Abandoned; the GitHub URL 404s while still being listed on aggregator sites. |

**Prefer the official `mp-api[mcp]`.** Do not trust MCP directory sites (Glama, LobeHub, mcp.so) — the parallel research stream hit two Materials-Project MCP names that were listed on aggregators or produced by search summaries but returned flat 404s on GitHub.

**`mp-api` 0.46.4** (released 2026-06-15, maintained, requires Python ≥3.11 — we have 3.13.11) — `pip install mp-api`. **Requires a free API key**; I verified the main endpoint rejects unauthenticated requests:

```
https://api.materialsproject.org/materials/summary/?formula=Si  ->  HTTP 401
```

Keys are free from `https://next-gen.materialsproject.org/api`. `pymatgen` 2026.5.4 is separately maintained and pairs with it.

#### The useful finding: MP's OPTIMADE endpoint needs no key at all

```
https://optimade.materialsproject.org/v1/structures?filter=chemical_formula_reduced="Si"  ->  HTTP 200
https://providers.optimade.org/v1/links                                                    ->  HTTP 200
```

OPTIMADE's *core* spec is structures-only — no energies. But MP ships a vendor extension field, `_mp_stability`, and it **does** carry energetics. Verified live on `mp-165`:

```json
"_mp_stability": {
  "gga_gga+u":        { "energy_above_hull": 0.01342025, "formation_energy_per_atom": 0.01342025 },
  "r2scan":           { "energy_above_hull": 0.01360687, "formation_energy_per_atom": 0.01360687 },
  "gga_gga+u_r2scan": { "energy_above_hull": 0.01360687, "formation_energy_per_atom": 0.01360687 }
}
```

**Two scientific caveats that must not be lost:**

1. **Use the `gga_gga+u` key, not `r2scan`.** MACE-MP-0 was trained on MPtrj, which is GGA/GGA+U (PBE). Comparing MACE-MP-0 against r2SCAN reference values compares two different levels of theory.
2. **`formation_energy_per_atom` is not MACE's total energy per atom.** Formation energy is referenced to elemental reference states; MACE-MP-0 outputs total energies on the MPtrj reference. To compare, you must compute the elemental references with the *same* MACE model and form the difference. Comparing raw MACE total E/atom to MP formation energy is meaningless.

This second caveat also applies to what the repo does today. `lib/mlpeg-catalog.ts` stores **experimental** cohesive energies (Kittel, CRC Handbook) — the catalog already flags this correctly in a comment at line 73. Good discipline, but experimental cohesive energy is a third, distinct quantity. OPTIMADE gives you a PBE-level number that is at least the *right level of theory* for MACE-MP-0.

`optimade` (the Python tools package) is 1.5.0, released 2026-06-21, maintained — but for read-only queries plain `curl`/`requests` against the endpoint is enough.

### 2.2 PubChem — works, no auth, no MCP server needed

PUG-REST verified live, no key:

```
https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/ethanol/property/MolecularFormula,CanonicalSMILES/JSON
  ->  HTTP 200  ->  {"CID": 702, "MolecularFormula": "C2H6O", "ConnectivitySMILES": "CCO"}
```

**Gotcha worth recording:** I requested `CanonicalSMILES` and PubChem returned the key as **`ConnectivitySMILES`**. PubChem renamed this property; code that indexes `["CanonicalSMILES"]` on the response will `KeyError`.

MCP servers for PubChem all exist but are tiny: `cyanheads/pubchem-mcp-server` (9★, 2026-07-30), `sssjiang/pubchem_mcp_server` (11★), `PhelanShao/pubchem-mcp-server` (7★). **SKIP** — an MCP server adds a dependency and a failure mode over a one-line unauthenticated HTTP GET. `pubchempy` 1.0.5 exists on PyPI (2025-09-08, quiet ~11 months, only 2 dependencies) if you want a client wrapper.

### 2.3 NIST CCCBDB — no API, scrape-only

```
https://cccbdb.nist.gov/        ->  HTTP 200
https://cccbdb.nist.gov/api     ->  HTTP 404
https://cccbdb.nist.gov/rest    ->  HTTP 404
```

CCCBDB is an ASP form-driven HTML site with no machine-readable API and no MCP server. Any use requires HTML scraping against unstable form endpoints. **Do not build on it.** If you need molecular reference data (frequencies, atomization energies) for MACE-OFF validation, hand-curate a small table with citations into the catalog the way `mlpeg-catalog.ts` already does — that is more honest and more stable than a scraper.

### 2.4 No MACE or ASE MCP server — but two atomistic projects do exist

My keyword searches (`chemistry mcp server`, `ase atomic simulation mcp`) returned zero, which overstates the case; a parallel stream surfaced two real projects I then confirmed:

| Repo | Stars | Last push | What it is |
|---|---|---|---|
| `pathintegral-institute/mcp.science` | 146 | 2026-02-27 | MIT collection of science MCP servers. Includes **`gpaw-computation`** — runs genuine DFT via GPAW (which is itself built on ASE's Calculator interface) — plus `materials-project`. Install: `uvx mcp-science <server-name>`. |
| `XirtamEsrevni/mcp-atomictoolkit` | 11 | 2026-02-09 | Wraps ASE + pymatgen + ML potentials for structure building/optimization/MD. Self-describes as "under active development… not all features fully operational yet." Pseudonymous single author. |

**Still true and worth stating:** there is **no MACE MCP server**, nothing maintained by the ASE project itself, and nothing from the MACE authors. `mcp-atomictoolkit` is the only ASE-adjacent option and it is explicitly pre-production. Do not wait for one to appear; the provenance work in §4 is independent of this gap.

### 2.5 Other providers, and one that is currently down

| Source | Access | Status |
|---|---|---|
| **Alexandria** | via OPTIMADE, no auth, no dedicated client needed | Live: `alexandria.icams.rub.de/pbe/v1/info` → 200, 2.5M+ PBE structures |
| **AFLOW** | Raw AFLUX REST API, no auth | API live (200). But the community pip wrapper **`aflow` last released 2020-02-29 — 6 years stale, ABANDONED.** Query the REST API directly. |
| **NOMAD** | `pip install nomad-lab` (1.4.3, 2026-07-14), no auth for public reads | Maintained, but it's the *entire* NOMAD backend — heavy. Hit the REST API with `requests` instead. |
| **OQMD** | `oqmd.org/oqmdapi` | **Returning HTTP 502 on every endpoint during this research.** `qmpy_rester` wrapper last released 2019. **Do not depend on it without re-checking.** |

### 2.6 Benchmarking reference — matbench-discovery already has MACE numbers

**`matbench-discovery`** 1.3.1 on PyPI; repo `janosh/matbench-discovery` (243★, MIT, pushed 2026-08-05, 2 open issues). Verified directly: the repo contains **`models/mace/mace-mp-0.yml`** and **`models/mace/mace-mpa-0.yml`** — published, community-vetted leaderboard entries for both models.

**Use this rather than re-deriving.** And note the methodological point it makes for free: MACE-MP-0 was *trained* on Materials Project PBE+U data, so benchmarking MACE-MP-0 against MP is a **consistency check, not a held-out generalization test**. matbench-discovery's crystal-stability task is the genuinely held-out evaluation. Cite it; don't claim your own MP comparison is more than a self-consistency check.

**MPtrj** (MACE-MP-0's training set) — community mirrors on Hugging Face; `nimashoghi/mptrj` returns HTTP 200 unauthenticated. These are **third-party mirrors**, not canonical. The canonical release is associated with the CHGNet paper (Figshare) — **UNVERIFIED** in this pass.

### 2.7 Legacy Materials Project API is retired

MP's own docs stated the legacy API would be retired in **September 2025** — 11 months ago. Live probes are consistent with that: `legacy.materialsproject.org` → 403, `materialsproject.org/rest/...` → 301 redirect rather than legacy JSON. Do not build against `pymatgen.ext.matproj.MPRester`. For old task IDs use `mp_api.client.MPRester().materials.tasks.search(task_ids=[...])`.

---

## §3. Verification & reproducibility patterns

### 3.1 Units — skip the unit library, spend the effort on manifests

| Package | Version | Released | Status |
|---|---|---|---|
| `pint` | 0.25.3 | 2026-03-19 | Maintained. Requires Python ≥3.11 (we have 3.13.11 — fine). |
| `unyt` | 3.1.0 | 2026-01-15 | Maintained (yt-project). Lighter — ndarray subclass, depends only on numpy + sympy. |
| `astropy.units` | 8.0.1 | 2026-07-05 | Maintained but you must install all of astropy. Overkill. |
| `ase.units` | ships with ASE | — | **Confirmed: plain float multipliers, not a unit system.** eV/Å/amu/K are literally `1.0`. Nothing stops you adding an energy to a force. |

**There is no atomistic-specific unit-aware library.** Nothing like `ase-pint` exists. The field convention is bare floats with documented units, which is exactly what ASE and MACE do.

**Recommendation: SKIP `pint` for v2.0.** Reasons: (a) Pint's wrapper approach carries real per-operation overhead — roughly an order of magnitude or more versus raw ndarray ops, which is unacceptable inside MD/optimizer loops; (b) applying it only at the JSON boundary catches almost no bugs, because the boundary is where units are already correct by construction; (c) this codebase's actual unit risk is concentrated in a handful of known conversion sites (`units.fs`, `units.GPa`, `friction / units.fs`) which are better covered by targeted assertions than by a type system.

If you disagree and want dimensional safety, prefer **`unyt`** over `pint` here — the `unyt_array` ndarray-subclass design composes better with ASE's numpy-centric API.

### 3.2 Numeric testing — this is where the real wins are

| Package | Version | Released | Status |
|---|---|---|---|
| `hypothesis` | 6.165.2 | 2026-08-05 | Very active (4 days old at time of research) |
| `pytest-regressions` | 2.11.0 | 2026-05-25 | Maintained, 3 maintainers |
| `syrupy` | 5.5.3 | 2026-07-11 | Maintained, zero deps — but no numeric tolerance |
| `pytest-snapshot` | 0.9.0 | 2022-04-23 | **STALE, 4+ years.** Superseded by syrupy. Skip. |

**`pytest-regressions`** is close to purpose-built for this problem. `num_regression` takes a dict of numpy arrays, stores them as CSV, and compares with `numpy.isclose` semantics and per-key tolerances:

```python
def test_ethanol_singlepoint(num_regression):
    result = run_calculation("public/demo/ethanol.xyz", {...})
    num_regression.check(
        {"energy": np.array([result["energy"]]),
         "forces_flat": np.array(result["forces"]).ravel()},
        default_tolerance={"atol": 1e-5, "rtol": 1e-8},
    )
```

Regenerate with `--force-regen` when a model version intentionally changes — which makes model upgrades produce a reviewable diff of exactly which numbers moved. That is precisely "documentation for future verification."

**`hypothesis`** covers what golden files cannot: physical laws.

```python
@given(rotation=..., translation=...)
def test_energy_is_invariant(rotation, translation):
    # E(R·x + t) == E(x)
```

Plus `Σ F_i ≈ 0` for isolated molecules — the repo's own `CLAUDE.md` lists net-force-zero as a manual checklist item, and this converts it into an automated one.

**Existing test style note:** `mace-api/test_geometry_opt.py` uses `unittest` with a `MorsePotential` mock so tests need no GPU and no mace-torch. That is a good foundation and pytest runs `unittest` classes natively, so adoption is incremental, not a rewrite.

### 3.3 Provenance — the dedicated libraries are mostly dead

Verified against PyPI on 2026-08-09:

| Package | Latest | Released | Age | Status |
|---|---|---|---|---|
| `recipy` | 0.3.0 | 2016-09-13 | ~10 yr | **DEAD** |
| `provenance` | 0.14.1 | 2020-12-02 | ~6 yr | **DEAD** |
| `cffconvert` | 2.0.0 | 2021-09-22 | ~5 yr | **DEAD** |
| `pytest-snapshot` | 0.9.0 | 2022-04-23 | ~4 yr | **DEAD** |
| `sacred` | 0.8.7 | 2024-11-26 | ~20 mo | Stale |
| `sumatra` | 0.8.1 | 2025-07-14 | ~13 mo | Alive but slow |
| `prov` (W3C PROV) | 3.1.0 | 2026-08-07 | 2 days | Active |
| `rocrate` | 0.15.1 | 2026-07-10 | 1 mo | Active |
| `dvc` | 3.67.1 | 2026-03-31 | 4 mo | Active but heavy |
| `mlflow` | 3.15.1 | 2026-08-03 | days | Active but heavy |

`recipy` was the closest shape to what we want (auto-hooks file I/O + git SHA + package versions into a local SQLite DB) and it has been unmaintained for a decade.

**There is no maintained small package that does "importlib.metadata + hashlib + git SHA."** This is genuinely a DIY pattern — about 15 lines of standard library. `python-git-info` covers only the git sliver and is itself stale (0.8.3, 2023).

`prov` and `rocrate` are real and current if you later want standards-based interop (W3C PROV graphs, RO-Crate JSON-LD packaging). Neither is needed for v2.0.

### 3.4 "AI agent provenance" standards are not real yet

Names circulating in 2025–2026 preprints — PROV-AGENT, AdProv, Graphectory — have **no corresponding GitHub repositories or PyPI packages**. They are academic proposals, not installable tooling. OpenTelemetry GenAI semantic conventions are real and installable but target LLM API call tracing (prompts, tokens, latency), not "this geometry optimization used model X with seed Y." C2PA targets media asset signing. AIBOM/CycloneDX describes software supply-chain composition. **None of these is the right tool.** Do not wait for a standard; write the manifest.

### 3.5 Computational-chemistry provenance frameworks — all too heavy except `ase.db`

| Tool | Requirement | Verdict |
|---|---|---|
| **AiiDA** (`aiida-core` 2.9.0, 2026-08-06) | Hard-depends on `psycopg[binary]` (**PostgreSQL**) and `kiwipy[rmq]` (**RabbitMQ**) | Exactly the two daemons we ruled out. **SKIP.** |
| **jobflow** 0.3.1 (2026-02-05) | MongoDB optional, technically runs standalone | Exists to orchestrate multi-job dependency graphs. We have one calculation. **SKIP.** |
| **atomate2** 0.1.5 (2026-07-13) | Depends on jobflow + pymatgen + custodian + emmet-core + pymongo | Wrong layer. **SKIP.** |
| **`ase.db`** | **Already installed with ASE** | **ADOPT.** |

#### `ase.db` — verified working end-to-end

I tested it rather than trusting the docs:

```
wrote row id 1
key-value pairs round-tripped: MACE-MP-0-medium -0.0009
nested manifest round-tripped: 0.3.15 / ase 3.27.0
forces shape: 2 x 3
atoms recovered: Si2
db file size: 69632 bytes  | format: sqlite3 (also supports .json)
QUERYABLE: [1]
```

It stores the structure, arbitrary queryable key/value pairs, and a nested JSON blob via `data=`. SQLite or JSON backend, zero configuration, zero new dependencies. This is the right calculation log for this project.

#### extxyz metadata round-trip — also verified

```python
atoms.info["mace_manifest"] = json.dumps({...})
write("t.xyz", atoms, format="extxyz")
```
produces a self-documenting, human-readable header:
```
Lattice="..." Properties=species:S:1:pos:R:3 mace_manifest="{\"mace_torch\": \"0.3.15\", ...}" provenance_version=1
```
and reads back intact. Useful for stamping model identity onto exported structures so a downloaded file carries its own provenance.

### 3.6 MACE model identity — upstream gives you nothing, so hash it yourself

MACE foundation models are distributed as GitHub Releases / Figshare downloads with **no published SHA256 checksums**. Integrity rests on HTTPS alone. Worse, the cached filenames are opaque:

```
~/.cache/mace/20231203mace128L1_epoch199model     (44 MB)  <- MACE-MP-0 medium
~/.cache/mace/MACE_MPtrj_20229model              (134 MB)
~/.cache/mace/5yyxdm76                            (44 MB)
~/.cache/mace/MACE-OFF23_small.model              (7 MB)
```

A name like `5yyxdm76` tells a future reader nothing. **Hashing is the only reliable way to pin which weights produced a result.**

Verified resolution hooks:

```python
# MACE-MP: public helper, returns the cached path without re-downloading
from mace.calculators.foundations_models import download_mace_mp_checkpoint
path = download_mace_mp_checkpoint("medium")
# -> /Users/.../.cache/mace/20231203mace128L1_epoch199model
# -> sha256 01bfe22100139f424713cf921144e5509cbe353d67aa9fa1be9c6e1e0ed35845
```

- **MACE-OFF has no equivalent public helper** — `download_mace_off_checkpoint` does not exist. But its cache filenames are deterministic: `~/.cache/mace/MACE-OFF23_{small,medium,large}.model`.
- **`MACECalculator` does not retain the path.** Its only relevant attributes are `models`, `model_type`, `num_models`. It *prints* the path (`Using MACE-OFF23 MODEL for MACECalculator with /Users/.../MACE-OFF23_small.model`) — note this goes to **stdout**, which is why `route.ts` already has to scan for the first `{` to find the JSON. Resolve the path explicitly; don't try to read it off the calculator.

**Cost is negligible:** full SHA256 of the 134 MB model took **0.06 s**; the 44 MB model took **0.02 s**. Against a multi-second MACE calculation this is free. No need for partial-hash tricks.

---

## §4. What this repo should actually adopt

Prioritized. Items 1–4 are the ones that deliver the user's stated requirement; 5–7 are hardening; 8+ are optional.

### Priority 1 — Repair what's already there (half a day, no new dependencies)

1. **Echo `params` into the result dict** in `_build_result()`. One line. Un-breaks the validator's model-aware bounds and satisfies the `params?` field already declared in `types/mace.ts`.
2. **Move `validate_calculation.py` into `mace-api/`** (or fix all 19 doc references). Right now the command in `CLAUDE.md`, `README.md`, and the in-app `/docs` page does not run. Pick one location and make it true.
3. **Seed the MD RNG.** `MaxwellBoltzmannDistribution(atoms, temperature_K=T, rng=np.random.default_rng(seed))`, seed defaulting to a constant, surfaced in params and recorded in the result.

### Priority 2 — The provenance manifest (2–3 hours, no new dependencies)

Add a `provenance` block to every result. Everything below is stdlib plus already-installed `pydantic` 2.12.4:

```python
{
  "provenance": {
    "schema_version": 1,
    "timestamp_utc": "...",
    "packages": {"mace-torch": "0.3.15", "ase": "3.27.0",
                 "torch": "2.10.0", "numpy": "2.4.2"},   # importlib.metadata
    "model": {"type": "MACE-MP-0", "size": "medium",
              "resolved_path": ".../20231203mace128L1_epoch199model",
              "sha256": "01bfe221..."},                   # hashlib, ~0.02 s
    "input": {"filename": "ethanol.xyz", "sha256": "..."},
    "params": {...},                                      # also fixes §0.2
    "seed": 42,
    "git_sha": "...",                                     # subprocess git rev-parse
    "device": "cpu", "precision": "float32"
  }
}
```

Model the schema with `pydantic.BaseModel` so it validates and can emit JSON Schema. Surface it in the UI on the results page and in the PDF export (`components/calculate/pdf-report.tsx`), and persist it with shared MACE Link results — a shared link that cannot say which model produced it is not verifiable.

### Priority 3 — Wire validation into the actual path (2–3 hours)

Import `validate_result` inside `run_calculation` and attach its output as a `validation` block on every result rather than leaving it as a script a human must remember to run. Surface warnings in the UI. This is the literal implementation of "every scientific calculation needs double-checking."

### Priority 4 — Test harness (1 day)

```bash
pip install pytest pytest-regressions "hypothesis[numpy]"
```

- `pytest-regressions` golden files for each demo structure in `public/demo/` — energy and forces with explicit `atol`/`rtol`. Catches silent drift on any mace-torch/torch upgrade, and makes intentional model changes show up as a reviewable numeric diff.
- `hypothesis` property tests for rotation/translation invariance of energy and `Σ F_i ≈ 0`, reusing the existing `MorsePotential` mock so CI needs no GPU and no model download.

### Priority 5 — Calculation log via `ase.db` (1–2 hours)

Append every run to a local `ase.db` (SQLite or JSON) carrying the manifest from Priority 2 in `data=`. Zero new dependencies, queryable, and gives you a reproducibility trail and a free regression corpus.

### Priority 6 — Agent literature access (10 minutes)

The `huggingface-papers` route already works and is free — I verified all three MACE papers fetch as full markdown. Optionally add:

```bash
claude mcp add --transport stdio --scope user arxiv -- uvx arxiv-mcp-server
```

for LaTeX-by-section equation extraction.

If you want broader coverage (Crossref/OpenAlex/Unpaywall for the v2 paper's bibliography), add K-Dense's `paper-lookup` skill — no credentials, provenance-oriented (§1.5). Install only the skills you need; the full set is 161 skills and its chemistry skills are biomolecular, not atomistic.

### Priority 7 — v2 benchmark reference data (2–4 hours)

Pull `formation_energy_per_atom` from MP's **no-key** OPTIMADE endpoint using the **`gga_gga+u`** functional key, and compute MACE formation energies against MACE-computed elemental references so the comparison is like-for-like. Keep `mlpeg-catalog.ts`'s existing experimental values as a clearly-labelled third column — do not silently mix the three quantities.

Then cite `matbench-discovery`'s published **MACE-MP-0** and **MACE-MPA-0** entries rather than implying your MP comparison is a generalization test. Because MACE-MP-0 trained on MP data, your comparison is a self-consistency check; say so explicitly in the UI copy. That single sentence is worth more scientific credibility than another chart.

If you want the agent to query MP directly during development, `pip install "mp-api[mcp]"` + `mpmcp` is first-party and takes 30 minutes — but it needs an API key, so it is a developer convenience, not something the deployed app should depend on.

### Explicitly do not adopt

- **AiiDA / atomate2 / jobflow** — PostgreSQL + RabbitMQ, or multi-job orchestration we don't need.
- **DVC / MLflow / Sacred / Sumatra** — experiment-tracking mental model, wrong problem.
- **`recipy` / `provenance` / `cffconvert` / `pytest-snapshot`** — dead, 4–10 years stale.
- **`pint`** — real overhead, low bug-catch rate here. Revisit only if a units bug actually ships.
- **Third-party Materials Project MCP servers** — superseded by the official `mp-api[mcp]`.
- **PubChem MCP servers** — 5–46★ hobby projects wrapping a no-auth REST API you can `curl`.
- **NIST CCCBDB automation** — no API exists; scraping will break.
- **OQMD** — returning 502 across all endpoints during this research; wrapper `qmpy_rester` last released 2019.
- **`aflow` pip wrapper** — 6 years stale. The AFLOW REST API itself is fine.
- **K-Dense's `molecular-dynamics` / `deepchem` / `medchem` skills** — OpenMM/biomolecular and drug-discovery, **not** ASE/MACE. Do not install expecting materials support.

---

## Appendix: things that do not exist

Stated plainly so nobody spends time looking:

- **No MACE-specific or ASE-specific MCP server.** GitHub searches for `chemistry mcp server` and `ase atomic simulation mcp` return nothing from the ASE project or the MACE authors. The closest things that exist are `pathintegral-institute/mcp.science`'s `gpaw-computation` server (real DFT via GPAW) and `XirtamEsrevni/mcp-atomictoolkit` (11★, self-described as "not all features fully operational yet"). Neither covers MACE.
- **No dedicated science / paper / citation plugin in the official Anthropic marketplace** — verified against the real `marketplace.json`, **0 of 284**.
- **No science skill in `anthropics/skills`** (17 skills, all document/design/dev).
- **No machine-readable NIST CCCBDB API.** `/api` and `/rest` both 404.
- **No atomistic-simulation unit library.** Nothing like `ase-pint`.
- **No maintained micro-package for "versions + hashes + git SHA."** DIY, ~15 lines.
- **No installable AI-agent-provenance standard.** PROV-AGENT, AdProv, Graphectory are preprints with no code.
- **No published checksums for MACE foundation model weights.** Compute your own.

## Appendix: verification method

- **Live HTTP probes** for PubChem PUG-REST, OPTIMADE (providers + MP), `api.materialsproject.org`, CCCBDB, Hugging Face papers endpoint.
- **PyPI JSON API** for every package version and release date quoted.
- **Authenticated GitHub API** (`gh api`, `gh search repos`) for stars, last-push dates, open issue counts, archived status, README install commands.
- **Local filesystem inspection** of `~/.claude/plugins/marketplaces/claude-plugins-official` and the installed `huggingface-skills` plugin.
- **Local execution** for `ase.db` round-trip, extxyz round-trip, MACE checkpoint path resolution and SHA256 timing, and the `validate_result` MACE-OFF false-positive demonstration.

Three parallel research streams (literature ecosystem, scientific data sources, reproducibility tooling) fed this document. **Every claim retained above was re-verified by me directly** — where a stream's finding contradicted mine, I re-probed the primary source before editing.

### Corrections made during research

- **I was wrong about the Materials Project MCP server.** I concluded none existed by searching the `materialsproject` org for repo *names* matching `mcp`. The server is a subpackage inside the `mp-api` repo. Corrected in §2.1 with direct evidence. Lesson: search package metadata and entry points, not just repository names.
- **Plugin count corrected** from "39 + 15" (the local vendored cache) to **284** (the real `marketplace.json`). The conclusion — zero science/literature plugins — was unaffected.

### Names that do NOT exist — do not repeat them

Search engines, AI summaries, and MCP aggregator directories produced several confident references to things that 404 on GitHub:

- `win4r/arxiv-mcp` — no such repo.
- `justaddcoffee/materials-project-mcp` — no such repo (search-snippet fabrication).
- `fair2wise/materials-project-mcp` — 404 on GitHub while still listed on the Glama aggregator.
- `huggingface-claude-skills` — wrong name; the real repo is `huggingface/skills`.
- A batch of invented plugin names (`webprotein`, `oxford-dictionaries`, `potlatch`, `scarlet-gpt`, `tipranks`, `uniscope`) surfaced by an intermediate page-summarizing call and were discarded after checking against the real `marketplace.json`.

**Operational rule for v2: trust GitHub API and PyPI JSON over MCP directory sites** (Glama, LobeHub, mcp.so, mcpservers.org). Aggregators list dead repos indefinitely.
