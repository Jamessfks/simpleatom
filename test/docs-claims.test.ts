import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ValidationPage from "@/app/docs/validation/page";
import { CONTRACT } from "@/lib/contract";

const read = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

// D67: the docs may describe only what the code does. At 3ee1d64 the page
// described the pre-D38 self-test (upstream calls, MACE-MP-0 small, two verdicts
// that asserted nothing). run_verification_tests() in
// test_scripts/validate_calculation.py is now the source of truth: it drives
// SimpleAtom's own engine, loads the default MACE-MPA-0 (medium) for silicon,
// asserts all five checks, and requires the optimisation to converge in float64.
// And "DFT-level accuracy" needs its qualifier.
describe("docs say only what the validator and the benchmarks support (D67)", () => {
  const validation = read("app/docs/validation/page.tsx");
  const home = read("app/docs/page.tsx");
  const calculations = read("app/docs/calculations/page.tsx");

  it("says the self-test runs SimpleAtom's own engine", () => {
    expect(validation).toMatch(/SimpleAtom(&rsquo;|’|')s own (calculation )?engine/i);
  });

  it("says which models the self-test loads: the default MACE-MPA-0 (medium) and MACE-OFF (small)", () => {
    expect(validation).toMatch(/MACE-MPA-0 \(medium\)/);
    expect(validation).toMatch(/MACE-OFF \(small\)/);
    expect(validation).not.toMatch(/MACE-MP-0 \(small\)|MACE-MP-0 small/);
    expect(validation).not.toMatch(/not the default MACE-MPA-0/i);
  });

  it("runs the silicon test on the 8-atom conventional cell", () => {
    expect(validation).toMatch(/8-atom/);
    expect(validation).not.toMatch(/2-atom/);
  });

  it("says all five checks assert something, and none only records numbers", () => {
    expect(validation).toMatch(/all five (tests|checks) assert/i);
    expect(validation).not.toMatch(/two only record/i);
    expect(validation).not.toMatch(/three tests assert/i);
    expect(validation).not.toMatch(/records? (the )?(energy|numbers)[^.]*(does not|do not|without) (assert|check)/i);
    expect(validation).not.toMatch(/does and does not assert/i);
  });

  it("requires the ethanol optimisation to converge in float64 within 200 BFGS steps", () => {
    expect(validation).toMatch(/up to 200 BFGS steps/);
    expect(validation).not.toMatch(/up to 100 BFGS/);
    expect(validation).toMatch(/must (have )?converge/i);
    expect(validation).toMatch(/float64/);
    expect(validation).not.toMatch(/does not check that the optimi[sz]ation converged/i);
    expect(validation).not.toMatch(/decreases monotonically and converges/i);
  });

  it("runs the result validator on both the silicon and the water results", () => {
    expect(validation).toMatch(/both the silicon and (the )?water/i);
    expect(validation).not.toMatch(/run on the silicon single-point result/i);
  });

  it("says the command fails unless every check passed", () => {
    expect(validation).toMatch(/exits with status 1 unless every check passed/i);
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

// D81: the validator checks every pair at the minimum image when the result has
// a cell, and judges MD by what each ensemble conserves (test_scripts/
// validate_calculation.py, acd8500). The page used to say "minimum distance
// > 0.4 Å" and "bounded energy fluctuation".
describe("the validation page describes what the validator now checks (D81)", () => {
  const validation = read("app/docs/validation/page.tsx");

  it("checks distances over every pair at the minimum image, and an overlap is an issue", () => {
    expect(validation).toMatch(/every pair/i);
    expect(validation).toMatch(/minimum image/i);
    // The limit is the registry's, the same value the engine refuses at (D153),
    // so it is read off the rendered page rather than the source.
    const limit = CONTRACT.structureChecks.minInteratomicDistanceA;
    const rendered = renderToStaticMarkup(ValidationPage()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(rendered).toMatch(new RegExp(`below ${limit.toString().replace(".", "\\.")} Å[^.]*(issue|error)`, "i"));
    expect(rendered).not.toMatch(/below 0\.4 Å/);
  });

  it("checks NaN and Inf in the potential, total and temperature series", () => {
    expect(validation).toMatch(/NaN\/Inf[^.]*potential, total and temperature/i);
  });

  it("judges NVE by the total energy's excursion from its start, with its limits and the drift", () => {
    expect(validation).not.toMatch(/bounded energy fluctuation/i);
    expect(validation).toMatch(/NVE[^.]*total energy[^.]*largest excursion from its start per atom/i);
    expect(validation).toMatch(/issue above 0\.05 eV\/atom/);
    expect(validation).toMatch(/warning above 5 meV\/atom/);
    expect(validation).toMatch(/meV\/atom\/ps/);
  });

  it("judges NVT and NPT by the second-half mean temperature against the target", () => {
    expect(validation).toMatch(/NVT\/NPT[^.]*second-half mean temperature[^.]*target/i);
    expect(validation).toMatch(/issue above 2&times;|issue above 2×/);
    expect(validation).toMatch(/warning above 1\.5&times;|warning above 1\.5×/);
  });
});
