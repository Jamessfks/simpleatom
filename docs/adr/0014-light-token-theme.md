---
status: accepted
date: 2026-07-11
decision-makers: Zicheng Zhao
---

# 0014 — A light, token-driven theme: Fraunces + Inter, Paul Tol data colours

## Context and problem statement

The original navy "Matrix" theme read as a high-contrast dashboard and its accent failed WCAG AA. Scientific charts need colours distinguishable by colour-blind readers.

## Decision outcome

A warm off-white canvas with a green accent, defined as CSS custom properties on `:root` (a dormant `.dark` set is kept); Fraunces for display, Inter for UI, a mono face for numbers; Paul Tol's qualitative palette for data. Rowan's licensed typeface was considered and rejected.

### Consequences

* Good, because calm, readable, accessible by default.
* Bad, because several muted/border tokens sat below AA contrast until ADR-0029 fixed them.

### Confirmation

Contrast check in the UI polish gate (ADR-0029): 0 AA failures on app screens.

## History

Supersedes the navy 'Matrix' theme (47ab783).

## More information

* app/globals.css
* ca3d05a
* 9a8ce3d
