---
status: accepted
date: 2026-08-09
decision-makers: Zicheng Zhao
---

# 0018 — Scope: MACE potentials only — no electron-density properties, phonons or fine-tuning

## Context and problem statement

MACE is an interatomic potential: energies, forces, stress. It has no electron density. Features that need one (orbitals, partial charges, Fukui indices, pKa, NMR) cannot be approximated honestly, and a "coming soon" toggle would be a claim the code cannot back.

## Decision outcome

SimpleAtom offers single-point, BFGS geometry optimisation and MD. `phonon` is a known type that is refused with a hint, not stubbed. Fine-tuning, community databases and donations are out of scope. ASL-licensed foundation models beyond MACE-OFF23 (OMAT-0, MATPES, MH-1, OMOL, POLAR-1) are not offered (ADR-0021).

### Consequences

* Good, because every surface describes something the code performs.
* Bad, because users wanting vibrations or cell relaxation must use other tools for now.

### Confirmation

Refusal guard: `calculate_local.py ... '{"calculationType":"phonon"}'` returns `unsupported_calculation`.

## History

Removed: community database, semiconductor pages and 'MACE Freeze' (72ba501, 19bd20b, ce58de6); the Ko-fi/Support page (98aa539 → removed 49063fe); the RDKit-WASM sketcher (988a4cf → removed 0b1326f).

## More information

* docs/v2/SUCCESS-CRITERIA.md §Scope
* f2daf99
* b25b7d4
* 8482310
* 49063fe
