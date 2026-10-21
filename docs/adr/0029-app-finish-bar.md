---
status: accepted
date: 2026-10-20
decision-makers: Zicheng Zhao
---

# 0029 — App-surface finish bar: schrodinger.com discipline, landing layout frozen

## Context and problem statement

The calculator, results, benchmark and shared-result screens worked, but they were unfinished:

* the right column stayed empty until a result existed;
* labels were 9–11 px, muted, and at 3.56:1 contrast;
* borders and the focus ring were at 1.2–1.7:1;
* the code had 963 arbitrary `[var(--color-…)]` classes and 165 hex literals.

Schrödinger's site was chosen as the bar for finish.

## Decision outcome

Polish the app screens only. The landing page layout is frozen, though its copy may still be corrected for accuracy.

Adopt the bar's discipline, not its brand:

* **Contrast-safe tokens.** Text meets AA on all three canvas tiers, and control borders and the focus ring are at least 3:1.
* **Type.** Nothing smaller than 12 px. Labels are in sentence case, with no tracked all-caps "eyebrows" and no "→" in buttons. Mono is reserved for numbers, units, hashes and file names.
* **Run summary.** A "What will run" panel sits beside the calculator's configuration. It is sticky until a result exists, then folds to one line so the result is visible at the fold.
* **Accessibility floor.** Hit areas are at least 44 px on phone widths and coarse pointers. Focus is visible and reduced motion is respected.

The four pieces that already won blind comparisons must not regress: viewer render, viewer interaction, results units and navigation.

### Consequences

* Good, because the criteria are measurable: contrast, minimum size, hit area, and units.
* Bad, because visual quality is judged by a critic, not by tests alone.

### Implementation status (v2.2.0)

**Done:**
* the contrast tokens;
* the 12 px minimum and sentence-case labels;
* the run summary and numbered steps;
* hit areas: a `touch-target` utility for icon controls, plus `max-sm:`/`pointer-coarse:` minimums in the shared primitives;
* a skip link and a solid focus ring;
* card hover lifts and coloured decorative card edges removed (severity edges kept on validation).

**Deferred:** moving the semantic tokens into Tailwind `@theme` and removing the arbitrary `[var(--color-…)]` classes (703 remain) and hex literals (137 remain in `.tsx`). This is a mechanical codemod with no visible change, so it gets its own PR.

### Confirmation

Blind `design-critic` review of production versus the candidate, at 1440 and 375, against schrodinger.com captured the same day:

* **First run:** the candidate won 8 of 9 screens. It lost the desktop results fold, because the full summary pushed the energy below it. That was fixed by folding the summary after a run; the energy now ends at y = 767 px in a 900 px viewport.

Measured on 2026-10-21 against the local build:

| Check | Result |
|---|---|
| AA contrast scan, every text node on calculator (config and result), benchmark and shared-result screens | 0 failures (disabled options exempt) |
| Text under 12 px on those screens | 0 nodes |
| Hit test at 375 px (9 sample points over a ≥ 44 × 44 box per control) | 0 failures, excluding inline links in sentences (WCAG 2.5.8 exception) and the viewer toolbar, which sizes itself on the pointer rather than the width and is 44 px on coarse pointers |
| Viewer framing, same ethanol result, production versus candidate | Identical molecule bounding box at 1440 and 375 (fill 0.876 at 375) |

## More information

* docs/audits/2026-10-20.md §App UI
* app/globals.css (`touch-target`, contrast tokens)
* components/calculate/run-ledger.tsx
