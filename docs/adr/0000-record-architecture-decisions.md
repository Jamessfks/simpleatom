---
status: accepted
date: 2026-10-20
decision-makers: Zicheng Zhao
---

# 0000 — Record architecture decisions as MADR with an executable confirmation

## Context and problem statement

SimpleAtom's decisions lived in code header comments, commit bodies, two "Key Design Decisions" tables that disagreed with each other, and the defect backlog's `fixNote` fields. A new contributor — or the daily agent routine — could not tell which decisions were still in force, which had been reversed, or why. Six of this project's worst defects were code that reviewed as correct and did nothing at runtime, so a decision that is only *written down* is not enough.

## Decision outcome

Record every decision that shapes the system as a Markdown Architecture Decision Record in `docs/adr/`, using the [MADR 4.0](https://adr.github.io/madr/) structure, numbered `NNNN-kebab-title.md`, indexed in `docs/adr/README.md`. Every ADR's **Confirmation** section must name an *executable* check — a gate, a test, a guard command — not "reviewed". Superseded decisions keep their file with status `superseded by NNNN`; history from before this record was started lives in the *History* section of the ADR that replaced it.

### Consequences

* Good, because A decision and the check that proves it is still true sit side by side.
* Good, because reversals are explicit (supersession) instead of silent.
* Bad, because every structural change now carries a small documentation cost.

### Confirmation

`docs/adr/README.md` lists every file in `docs/adr/`; reviewers reject a PR that changes a recorded decision without a new or amended ADR (PULL_REQUEST_TEMPLATE.md checklist).

## More information

* docs/audits/2026-10-20.md §Documentation
