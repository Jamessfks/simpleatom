---
status: accepted
date: 2026-10-20
decision-makers: Zicheng Zhao
---

# 0029 — App-surface finish bar: schrodinger.com discipline, landing layout frozen

## Context and problem statement

The calculator, results, benchmark and shared-result screens were functional but unfinished: an empty right column until a result existed, 9–11 px muted labels at 3.56:1 contrast, borders and the focus ring at 1.2–1.7:1, 963 arbitrary `[var(--color-…)]` classes and 165 hex literals. Schrödinger's site was chosen as the bar for finish.

## Decision outcome

Polish the app screens only; the landing page layout is frozen (copy may still be corrected for accuracy). Adopt the bar's discipline, not its brand: a contrast-safe token set exposed through Tailwind `@theme`, a 12 px minimum with sans "eyebrow" labels and mono reserved for numbers, pill primary actions, a sticky right pane on the calculator, and the accessibility floor (44 px targets at 375 px, visible focus, reduced motion). The four pieces that already won blind comparisons (viewer render, viewer interaction, results units, navigation) must not regress.

### Consequences

* Good, because measurable criteria: contrast, minimum size, target size, no hex in touched files.
* Bad, because visual work is judged by a critic, not by tests alone.

### Confirmation

`verify-ui` screenshots at 1440 and 375; `design-critic` blind review; contrast scan 0 AA failures on app screens.

## More information

* docs/audits/2026-10-20.md §App UI
* app/globals.css
