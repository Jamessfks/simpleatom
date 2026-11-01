import { describe, expect, it } from "vitest";
import { pdfText } from "@/components/pdf-text";
import { MODELS } from "@/lib/contract";
import { MLPEG_CATALOG } from "@/lib/mlpeg-catalog";
import { MP_REFERENCE_ENTRIES, mpEntryLabel } from "@/lib/mp-reference";

// D163: the PDFs use built-in Helvetica, which draws the Windows-1252 characters
// and nothing else. react-pdf writes any other code point as its low byte, so
// omega (U+03C9) printed as E-acute and the subscript two (U+2082) as a quote.
// pdfText() is what both documents pass every user- or registry-derived string
// through.

// The characters Helvetica's WinAnsi encoding can draw, taken from the
// Windows-1252 decoder rather than from pdfText's own tables: bytes 0x20-0xFF
// minus the five undefined ones, minus the soft hyphen, plus newline.
const WIN_ANSI = (() => {
  const decoder = new TextDecoder("windows-1252");
  const set = new Set<string>(["\n"]);
  for (let b = 0x20; b <= 0xff; b++) {
    const ch = decoder.decode(new Uint8Array([b]));
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x7f && cp <= 0x9f) continue; // DEL and the undefined bytes decode to C1 controls
    if (cp === 0xad) continue; // soft hyphen is invisible
    set.add(ch);
  }
  return set;
})();

function expectPrintable(text: string, what: string) {
  for (const ch of text) {
    expect(WIN_ANSI.has(ch), `${what}: U+${ch.codePointAt(0)!.toString(16).toUpperCase()} in "${text}"`).toBe(true);
  }
}

describe("pdfText maps what Helvetica cannot draw (D163)", () => {
  it("leaves printable ASCII and Latin-1 alone", () => {
    const same = "MACE-MPA-0 (medium): Fe2O3, 300 K, 0.05 eV/Å, Å³, ± 2 × 3 ÷ 4 · 5 µm 90°, ½";
    expect(pdfText(same)).toBe(same);
  });

  it("leaves the Windows-1252 extras alone (dash, bullet, quotes, ellipsis)", () => {
    const same = "a – b — c • d ‘e’ “f” … €";
    expect(pdfText(same)).toBe(same);
  });

  it("turns subscript and superscript digits into ASCII digits", () => {
    expect(pdfText("H₂O")).toBe("H2O");
    expect(pdfText("C₂H₅OH")).toBe("C2H5OH");
    expect(pdfText("Aspirin (C₉H₈O₄)")).toBe("Aspirin (C9H8O4)");
    expect(pdfText("(H₂O)₂")).toBe("(H2O)2");
    expect(pdfText("x⁴ y⁹ z⁰")).toBe("x4 y9 z0");
    expect(pdfText("Å⁻¹")).toBe("Å-1");
    expect(pdfText("Fe₂₊")).toBe("Fe2+");
  });

  it("keeps the superscripts Latin-1 already has, so Å³ stays Å³", () => {
    expect(pdfText("12.5 Å³ cm² ¹")).toBe("12.5 Å³ cm² ¹");
  });

  it("turns Greek letters into their names", () => {
    expect(pdfText("ω-Ti (mp-72)")).toBe("omega-Ti (mp-72)");
    expect(pdfText("α-quartz")).toBe("alpha-quartz");
    expect(pdfText("θ-Al2Cu")).toBe("theta-Al2Cu");
    expect(pdfText("ΔE")).toBe("DeltaE");
    expect(pdfText("σ π Σ Ω")).toBe("sigma pi Sigma Omega");
    expect(pdfText("ς")).toBe("sigma");
  });

  it("keeps the micro sign for Greek mu, which has a Latin-1 twin", () => {
    expect(pdfText("5 μm")).toBe("5 µm");
  });

  it("turns the angstrom, ohm and kelvin signs into the letters they stand for", () => {
    expect(pdfText("Å")).toBe("Å");
    expect(pdfText("Ω")).toBe("Omega");
    expect(pdfText("300 K")).toBe("300 K");
  });

  it("turns the Unicode minus and other dashes into ASCII hyphens", () => {
    expect(pdfText("−0.012 eV")).toBe("-0.012 eV");
    expect(pdfText("a‐b‑c‒d")).toBe("a-b-c-d");
  });

  it("turns the dot operators into the Latin-1 middle dot", () => {
    expect(pdfText("a ⋅ b ∙ c")).toBe("a · b · c");
  });

  it("spells arrows and comparisons in ASCII", () => {
    expect(pdfText("A → B ← C ↔ D")).toBe("A -> B <- C <-> D");
    expect(pdfText("≤ ≥ ≠ ≈")).toBe("<= >= != ~");
  });

  it("replaces unusual spaces and drops invisible characters", () => {
    expect(pdfText("a b c　d")).toBe("a b c d");
    expect(pdfText("a​b﻿c­d")).toBe("abcd");
  });

  it("keeps newlines, turns tabs into spaces and drops other control characters", () => {
    expect(pdfText("a\nb\tc\u0000d\u0007e\r\nf\u007F")).toBe("a\nb cde\nf");
  });

  it("falls back to the base letter for accented letters Latin-1 lacks", () => {
    expect(pdfText("Černý")).toBe("Cerny");
    expect(pdfText("Jurečka, Šponer")).toBe("Jurecka, Šponer"); // Š is in Windows-1252
    expect(pdfText("ά")).toBe("alpha");
    expect(pdfText("ﬁnal")).toBe("final");
  });

  it("replaces anything else with a question mark, once per code point", () => {
    expect(pdfText("☃")).toBe("?");
    expect(pdfText("a∮b")).toBe("a?b");
    expect(pdfText("😀")).toBe("?");
    expect(pdfText("日本")).toBe("??");
  });

  it("never throws on a value that is not a string", () => {
    expect(pdfText(undefined as unknown as string)).toBe("");
    expect(pdfText(null as unknown as string)).toBe("");
    expect(pdfText(12 as unknown as string)).toBe("12");
  });

  it("returns an empty string unchanged", () => {
    expect(pdfText("")).toBe("");
  });

  it("is idempotent", () => {
    for (const s of ["ω-Ti", "H₂O", "Å³", "☃", "Černý", "a​b"]) {
      expect(pdfText(pdfText(s))).toBe(pdfText(s));
    }
  });

  it("only ever returns characters Helvetica can draw", () => {
    let all = "";
    for (let cp = 0; cp < 0x3000; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      all += String.fromCodePoint(cp);
    }
    all += "😀𝐇𝒳\u{1F9EA}";
    expectPrintable(pdfText(all), "every code point below U+3000");
  });
});

describe("what the PDFs print from the registries comes out printable (D163)", () => {
  it("every Materials Project entry label", () => {
    expect(MP_REFERENCE_ENTRIES.length).toBeGreaterThan(0);
    for (const e of MP_REFERENCE_ENTRIES) expectPrintable(pdfText(mpEntryLabel(e)), e.mpId);
  });

  it("omega-Ti is spelled out", () => {
    const ti = MP_REFERENCE_ENTRIES.find((e) => e.mpId === "mp-72")!;
    expect(pdfText(mpEntryLabel(ti))).toBe("omega-Ti (mp-72)");
  });

  it("every catalog formula and name", () => {
    const entries = MLPEG_CATALOG.flatMap((c) => c.entries);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expectPrintable(pdfText(e.formula), `formula of ${e.id}`);
      expectPrintable(pdfText(e.name), `name of ${e.id}`);
    }
    const water = entries.find((e) => e.id === "water")!;
    expect(pdfText(water.name)).toBe("Water (H2O)");
  });

  it("every model label, summary, level of theory and licence notice", () => {
    for (const m of MODELS) {
      for (const text of [m.label, m.summary, m.levelOfTheory, m.license.notice ?? ""]) {
        expectPrintable(pdfText(text), m.id);
      }
    }
  });
});
