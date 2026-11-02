/**
 * Text for a PDF that is set in a built-in font (D163).
 *
 * Both PDFs (the benchmark report and the calculation report) use Helvetica,
 * one of the 14 standard PDF fonts, which carries no glyph outside Windows-1252
 * (WinAnsi). @react-pdf/renderer does not warn about that: it writes any other
 * code point as its low byte, so omega (U+03C9) printed as E-acute (0xC9) and the
 * subscript two in H2O (U+2082) as a low double quote (0x82). "omega-Ti (mp-72)"
 * is a label the app itself generates, so this is not a corner case.
 *
 * pdfText() turns a string into one made only of characters that font draws,
 * and it never invents a different meaning for them:
 *   - what WinAnsi has stays as it is (Å, ³, ±, ×, ·, µ, °, the en and em
 *     dashes, bullets, curly quotes, the ellipsis, Š and the rest);
 *   - subscript and superscript digits become ASCII digits;
 *   - Greek letters become their names ("ω" is "omega", "Δ" is "Delta"), except
 *     Greek mu, which becomes the micro sign Latin-1 has for it;
 *   - the Unicode minus and the other dashes become "-", arrows and comparisons
 *     are spelled with ASCII;
 *   - unusual spaces become spaces and invisible format characters are dropped;
 *   - an accented letter WinAnsi lacks falls back to its base letter, and a
 *     compatibility form (a ligature, a full-width letter) to its plain form;
 *   - anything else becomes "?", once per code point, so a missing glyph is
 *     visible instead of a different, wrong, character.
 *
 * Use it on every string a PDF prints that did not come from a literal in the
 * document: structure names, model labels, notes, warnings, licence notices.
 */

/** Windows-1252 characters above 0xFF's reach: bytes 0x80-0x9F, as code points. */
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

function isDrawable(cp: number): boolean {
  return (
    (cp >= 0x20 && cp <= 0x7e) ||
    (cp >= 0xa0 && cp <= 0xff && cp !== 0xad) || // 0xAD, the soft hyphen, is invisible
    WIN_ANSI_EXTRAS.has(cp)
  );
}

const GREEK_LOWER: Record<string, string> = {
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", ζ: "zeta", η: "eta",
  θ: "theta", ι: "iota", κ: "kappa", λ: "lambda", μ: "µ", ν: "nu", ξ: "xi",
  ο: "omicron", π: "pi", ρ: "rho", ς: "sigma", σ: "sigma", τ: "tau", υ: "upsilon",
  φ: "phi", χ: "chi", ψ: "psi", ω: "omega",
  // Variant forms
  ϑ: "theta", ϕ: "phi", ϖ: "pi", ϵ: "epsilon", ϱ: "rho", ϰ: "kappa",
};

const GREEK_UPPER_NAMES = [
  "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa",
  "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho", /* U+03A2 is unassigned */ "Sigma",
  "Tau", "Upsilon", "Phi", "Chi", "Psi", "Omega",
];

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  // ¹ ² ³ are Latin-1: Helvetica draws them, so Å³ stays Å³.
};

const REPLACEMENTS: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [ch, name] of Object.entries(GREEK_LOWER)) map.set(ch, name);
  GREEK_UPPER_NAMES.forEach((name, i) => {
    map.set(String.fromCodePoint(0x391 + i + (i >= 17 ? 1 : 0)), name);
  });
  [...SUBSCRIPTS].forEach((ch, digit) => map.set(ch, String(digit)));
  for (const [ch, to] of Object.entries(SUPERSCRIPTS)) map.set(ch, to);
  const other: Record<string, string> = {
    // Sub- and superscript signs and the letter n
    "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ⁿ": "n",
    "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")",
    // Signs that stand for a letter or a Greek capital
    "Å": "Å", // angstrom sign
    "Ω": "Omega", // ohm sign
    "∆": "Delta", // increment
    // Minus, hyphens and dashes
    "−": "-", "‐": "-", "‑": "-", "‒": "-", "―": "-",
    // Dot operators, to the Latin-1 middle dot
    "⋅": "·", "∙": "·",
    // Primes
    "′": "'", "″": '"',
    // Arrows, comparisons, a few operators
    "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "⇐": "<=", "⇔": "<=>", "⇌": "<=>",
    "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "∼": "~", "∞": "inf", "√": "sqrt",
    "∠": "angle ",
    // Line and paragraph separators
    " ": "\n", " ": "\n",
    // Tab
    "\t": " ",
  };
  for (const [ch, to] of Object.entries(other)) map.set(ch, to);
  return map;
})();

const MARK = /^\p{M}$/u;
const CONTROL_OR_FORMAT = /^[\p{Cc}\p{Cf}]$/u;
const SPACE = /^\p{Zs}$/u;

/** The replacement for one code point, or null when none is known. */
function direct(ch: string): string | null {
  if (ch === "\n") return ch;
  if (isDrawable(ch.codePointAt(0)!)) return ch;
  const mapped = REPLACEMENTS.get(ch);
  if (mapped !== undefined) return mapped;
  if (MARK.test(ch) || CONTROL_OR_FORMAT.test(ch)) return "";
  if (SPACE.test(ch)) return " ";
  return null;
}

function mapCodePoint(ch: string): string {
  const known = direct(ch);
  if (known !== null) return known;
  // An accented letter, a ligature, a full-width form: decompose it, drop the
  // combining marks, and map what is left.
  const decomposed = ch.normalize("NFKD");
  if (decomposed !== ch) {
    let out = "";
    for (const piece of decomposed) out += direct(piece) ?? "?";
    return out;
  }
  return "?";
}

/** `text` with every character Helvetica cannot draw replaced as described above. */
export function pdfText(text: string): string {
  if (typeof text !== "string") text = text == null ? "" : String(text);
  let out = "";
  for (const ch of text) out += mapCodePoint(ch);
  return out;
}
