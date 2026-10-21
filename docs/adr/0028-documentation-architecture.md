---
status: accepted
date: 2026-10-20
decision-makers: Zicheng Zhao
---

# 0028 — One documentation source per audience

## Context and problem statement

Three user-doc sets — MkDocs `docs/`, the in-app `/docs` pages and a 27 KB README — contradicted each other and the code (validator bounds, pressure units, MACE-OFF's level of theory, five version strings), and 165 KB of internal process notes were published as if they were documentation.

## Decision outcome

Users read the in-app `/docs` (it lives where they work and was the most current set). Contributors read `docs/` (MkDocs): explanation (architecture, scientific integrity), reference (API, request contract, units, environment), how-to (install, deploy, troubleshoot), ADRs and audits. Pages that duplicated the other audience's content were removed. Process notes (`docs/v2/`) stay in the repo but are excluded from the published site. The README is a short landing page that links into both. Facts that change with code (bounds, models) are generated or linked from `contract.json` rather than copied.

### Consequences

* Good, because every fact has one home.
* Bad, because the in-app docs are TSX, so a docs-only edit is a code change (reviewed like one).

### Confirmation

`mkdocs build --strict` (no broken links or missing nav entries); README size < 10 KB.

## More information

* mkdocs.yml
* docs/index.md
* app/docs/
