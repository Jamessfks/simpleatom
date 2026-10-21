import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStructureText } from "@/lib/parse-structure";

describe("parseStructureText", () => {
  it("converts silicon.cif fractional coordinates (nearest neighbour a*sqrt(3)/4)", () => {
    // Regresses to ~0.43 Å if fractional coordinates stop being multiplied
    // through the cell — the bug that once shipped. This is the TypeScript
    // parser's own check; the daily gate's silicon fixture reads the file
    // with ASE, which cannot catch a regression here.
    const parsed = parseStructureText(readFileSync("public/demo/silicon.cif", "utf8"), "silicon.cif");
    expect(parsed.atomCount).toBe(8);
    expect(parsed.isPeriodic).toBe(true);
    expect(parsed.minNeighborDist).toBeCloseTo(2.3516, 3);
  });

  it("parses ethanol.xyz", () => {
    const parsed = parseStructureText(readFileSync("public/demo/ethanol.xyz", "utf8"), "ethanol.xyz");
    expect(parsed.atomCount).toBe(9);
    expect(parsed.empiricalFormula).toBe("C₂H₆O");
    expect(parsed.isPeriodic).toBe(false);
  });

  it("keeps the first frame of a multi-frame XYZ", () => {
    const frame = (x: number) => `2\nframe\nH ${x} 0 0\nH ${x + 0.74} 0 0\n`;
    const parsed = parseStructureText(frame(0) + frame(5), "two.xyz");
    expect(parsed.frameCount).toBe(2);
    expect(parsed.positions[0][0]).toBe(0);
  });
});
