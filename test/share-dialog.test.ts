import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Design review of the publish confirmation: it was a bottom sheet even at
// 1280 px, it did not warn about a result that did not converge, and focus
// landed on the first control instead of the safe choice for an irreversible,
// public action. (No DOM in the test environment, so these read the source.)
const page = readFileSync("app/calculate/page.tsx", "utf8").replace(/\s+/g, " ");

describe("the publish dialog", () => {
  it("is centred from 768 px up and a bottom sheet below", () => {
    expect(page).toMatch(/side="bottom" className="[^"]*md:top-0[^"]*md:my-auto[^"]*md:h-fit[^"]*md:rounded-2xl/);
  });

  it("puts focus on Keep private when it opens", () => {
    expect(page).toMatch(/onOpenAutoFocus=\{\(event\) => \{ event\.preventDefault\(\); keepPrivateRef\.current\?\.focus\(\)/);
    expect(page).toMatch(/<Button ref=\{keepPrivateRef\}/);
  });

  it("lists what is wrong with the result before the user publishes it", () => {
    expect(page).toMatch(/shareCaveats\(result\)/);
    expect(page).toMatch(/role="note"|role="alert"/);
  });
});
