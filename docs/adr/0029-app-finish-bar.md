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
* card hover lifts and coloured decorative card edges removed (severity edges kept on validation);
* chemical formulas rendered with legible subscripts (`components/ui/formula.tsx`).

**Deferred, then done as its own change: the token migration.** The semantic tokens are now Tailwind utilities, through an `@theme inline reference` block in `app/globals.css` (`text-text-muted`, `bg-accent-soft`, `border-border-subtle/40`). The `:root` and `.dark` values are unchanged and remain the only definitions. A codemod replaced the arbitrary classes and every hex literal that exactly equals a token value. Counted as before (lines for the classes, six-digit hex in `.tsx` for the literals):

* arbitrary `[var(--color-…)]` classes: 703 lines → 40 (984 → 51 occurrences). All 40 are in `components/intro-section.tsx`, because the landing layout is frozen.
* hex literals: 137 → 104. None of the 104 has a token it could use:
  * **38 have no token.** 36 are on the `/v2` dashboard: its status and severity tints, its `#E4DFD3` border, and the pre-ADR muted `#8A8478`, which the contrast work replaced with `#6B655A`. The other 2 are the energy chart's axis titles, also `#8A8478`.
  * **40 go where CSS variables cannot be read:** Plotly layouts (27), react-pdf styles (6), 3Dmol colours and backgrounds (6), and the energy chart's fallback series colour (1), which feeds SVG `stopColor`.
  * **8 are in documents without the app stylesheet:** `app/global-error.tsx` (5) and the WEAS iframe (3). The iframe element's background is kept equal to its srcdoc background.
  * **18 are comments** in `molecule-viewer-3d.tsx` that quote element colours.

Zero visual change, measured on 2026-10-21. The before and after production builds were run with the same calculator, MD and benchmark results recorded from the local backend, and a fake MACE Link row for `/r/abc12345`. Screens covered, each at 1440 and 375 (60 full-page captures):
* calculator configuration;
* single-point and MD results, every result tab;
* benchmark configuration and results, every result tab;
* the shared result, its embed, and the not-found page;
* landing, every docs page, and `/v2`.

| Check | Result |
|---|---|
| Pixels changed, after versus before | 0, beyond the run-to-run noise floor (two boxes of 13 and 9 px at Δ1, which also differ between two before runs) |
| Computed colour, border, outline, shadow, fill, stroke, opacity, size and box of every element | identical, apart from ids that vary between runs (Plotly gradients, React `useId`) |
| Compiled CSS outside `@layer utilities` | byte-identical |

Tailwind sorts utilities that set the same property by class name, so a rename can reorder the cascade. A static check found 9 such pairs within a few lines of each other. None share an element, and the one inside a cva variant map goes through `cn()`.

### Confirmation

Blind `design-critic` review of production versus the candidate, at 1440 and 375, against schrodinger.com captured the same day:

* **First run:** the candidate won 8 of 9 screens. It lost the desktop results fold, because the full summary pushed the energy below it. That was fixed by folding the summary after a run; the energy now ends at y = 767 px in a 900 px viewport.
* **Re-review** of that screen plus the two phone screens the critic scored lowest: the candidate won all three (results fold 7 vs 5; phone results 6 vs 2; phone benchmark 6 vs 3).
* **Follow-ups the re-review named, all done:**
  * formula subscripts rendered at about 6 px; they are now real `<sub>` elements at 12 px or larger;
  * on a phone, a finished result now scrolls into view;
  * the benchmark Run row is sticky;
  * the phone export row is a 2 × 2 grid.

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
