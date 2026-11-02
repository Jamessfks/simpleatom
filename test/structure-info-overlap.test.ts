import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParsedStructureInfo } from "@/components/calculate/structure-info";
import { CONTRACT } from "@/lib/contract";
import { parseStructureText } from "@/lib/parse-structure";

// D153: the engine refuses atoms closer than structureChecks.minInteratomicDistanceA
// (overlapping_atoms), the validator reports the same value as an issue, and the
// preview warns at it. The preview used to hard-code 0.4 Å, so a pair at 0.45 Å
// looked fine here and was refused by the server.
const limit = CONTRACT.structureChecks.minInteratomicDistanceA;

const summary = (distance: number): string => {
  const parsed = parseStructureText(`2\n\nH 0 0 0\nH ${distance} 0 0\n`, "pair.xyz");
  return renderToStaticMarkup(createElement(ParsedStructureInfo, { parsed })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
};

describe("the structure preview warns about overlapping atoms at the registry's distance (D153)", () => {
  it("flags a pair just inside the limit, including one the old 0.4 Å would have passed", () => {
    for (const d of [limit - 0.05, limit - 0.01, 0.1]) {
      expect(summary(d), `${d} Å`).toContain("Overlapping atoms detected");
    }
  });

  it("does not flag a pair at the limit or beyond it", () => {
    for (const d of [limit, limit + 0.01, 0.74]) {
      expect(summary(d), `${d} Å`).not.toContain("Overlapping atoms detected");
    }
  });

  it("names the limit it applied, read from the registry", () => {
    expect(summary(limit - 0.05)).toContain(`closer than ${limit} Å`);
  });
});
