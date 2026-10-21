---
status: accepted
date: 2026-08-09
decision-makers: Zicheng Zhao
---

# 0016 — Judge quality by blind builder/critic rounds against fetched public bars

## Context and problem statement

Self-graded quality drifts. Scores out of ten invite negotiation.

## Decision outcome

Each piece has a bar — a real, fetchable product (Rowan, Materials Project, ACEsuit/mace, Mol*, Matbench Discovery, NOMAD; schrodinger.com for app finish since v2.2.0) — a builder, and a separate critic with fresh context who sees ours and the bar blind and *picks*. A verdict is void if the bar did not load, the claim was read rather than run, or the wrong build was measured.

### Consequences

* Good, because wins are hard to fake.
* Bad, because expensive; a run budget (2.5M tokens) and one-piece-per-day cadence keep it sustainable.

### Confirmation

`python3 test_scripts/daily_gate.py` (gates, guards, bars reachable) before any judging.

## More information

* docs/v2/SUCCESS-CRITERIA.md
* docs/v2/CONTINUE.md
* 29523c5
