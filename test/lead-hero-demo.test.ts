import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// D119: the landing hero shows the same relaxed ethanol as the demo file.
const demo = readFileSync("public/demo/ethanol.xyz", "utf8").trim().split("\n").slice(2)
  .map((line) => line.trim().split(/\s+/));
const hero = readFileSync("components/intro-section.tsx", "utf8");

describe("the hero molecule (D119)", () => {
  it("uses the demo file's coordinates", () => {
    const start = hero.indexOf("positions: [");
    const block = hero.slice(start, hero.indexOf("\n  ],", start));
    const rows = [...block.matchAll(/\[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\]/g)].map((m) => m.slice(1, 4).map(Number));
    expect(rows).toHaveLength(demo.length);
    rows.forEach((row, i) => row.forEach((v, k) => expect(v).toBeCloseTo(Number(demo[i][k + 1]), 5)));
  });
});
