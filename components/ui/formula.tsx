/**
 * A chemical formula with legible subscripts.
 *
 * Formulas arrive with Unicode subscript digits ("C₂H₆O", from the structure
 * parser and the catalog). Inter draws those glyphs at roughly 40% of the text
 * size, about 6 px at 14 px text, which is unreadable. This renders each run
 * of them as a real <sub> at no less than 12 px, nudged down without changing
 * the line height. Copying gives plain digits ("C2H6O"), which is also what a
 * screen reader reads.
 */

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";

export function Formula({ text }: { text: string }) {
  const parts = text.split(/([₀-₉]+)/u).filter(Boolean);
  return (
    <>
      {parts.map((part, i) =>
        /^[₀-₉]+$/u.test(part) ? (
          <sub key={i} className="relative top-[0.1em] align-baseline text-[max(12px,0.8em)] leading-none">
            {[...part].map((c) => SUBSCRIPTS.indexOf(c)).join("")}
          </sub>
        ) : (
          part
        ),
      )}
    </>
  );
}
