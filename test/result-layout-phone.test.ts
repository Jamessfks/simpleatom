import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Design review 2026-11-01 (result-actions-375): at 375 px the result tabs wrapped
// onto two rows with the active underline on one of them, and the 2x2 action grid
// sat off-centre in its card (about 21 px left, 50 px right).
const src = readFileSync("components/calculate/metrics-dashboard.tsx", "utf8");

describe("the result view on a phone", () => {
  it("keeps the section tabs on one scrollable row", () => {
    const list = src.match(/aria-label="Result sections"[\s\S]*?className="([^"]+)"/)?.[1] ?? "";
    expect(list).toMatch(/\bmax-sm:flex-nowrap\b/);
    expect(list).toMatch(/\bmax-sm:overflow-x-auto\b/);
  });

  it("lets the action grid fill its card", () => {
    expect(src).toMatch(/max-sm:grid max-sm:w-full max-sm:grid-cols-2/);
  });
});
