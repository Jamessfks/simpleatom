import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

// D67: the docs may describe only what the code does. validate_calculation.py's
// self-test records numbers for tests 1 and 2 without asserting anything,
// checks only that the ethanol energy did not rise, and loads MACE-MP-0 small,
// not the default MPA-0. And "DFT-level accuracy" needs its qualifier.
describe("docs say only what the validator and the benchmarks support (D67)", () => {
  const validation = read("app/docs/validation/page.tsx");
  const home = read("app/docs/page.tsx");
  const calculations = read("app/docs/calculations/page.tsx");

  it("does not claim checks that tests 1 and 2 never make", () => {
    expect(validation).not.toMatch(/correct range \(/i);
    expect(validation).not.toMatch(/equilibrium forces near zero/i);
    expect(validation).not.toMatch(/all of which must pass/i);
    expect(validation).toMatch(/record[s]? (the )?(energy|numbers)[^.]*(does not|do not|without) (assert|check)/i);
  });

  it("describes the ethanol test as the energy not rising, not convergence", () => {
    expect(validation).not.toMatch(/decreases monotonically and converges/i);
    expect(validation).toMatch(/does not (rise|increase)/i);
  });

  it("says which model the self-test loads", () => {
    expect(validation).toMatch(/MACE-MP-0 \(small\)|MACE-MP-0 small/);
  });

  it("does not promise a monotonic force decrease or steepest descent", () => {
    for (const text of [validation, calculations]) {
      expect(text).not.toMatch(/monotonically/i);
    }
    expect(calculations).not.toMatch(/in the direction of the forces/i);
    expect(calculations).toMatch(/BFGS/);
  });

  it("qualifies accuracy with the leaderboard result and its date", () => {
    expect(home).not.toMatch(/reached DFT-level accuracy/i);
    expect(home).toMatch(/Matbench Discovery/);
    expect(home).toMatch(/retrieved 2026-10-28/);
    expect(home).toMatch(/22nd of 43/);
  });
});
