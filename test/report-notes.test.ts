import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reportNotes } from "@/components/calculate/report-notes";
import type { CalculationResult } from "@/types/mace";

// D69 / F21: the PDF report printed "Status: success" for an optimisation that
// did not converge, omitted the warnings the calculation raised, and left out
// the MACE-OFF licence notice that every on-screen result carries.
const result = (extra: Partial<CalculationResult>): CalculationResult => ({ status: "success", energy: -1, ...extra });

describe("what the PDF report must say besides the numbers (F21)", () => {
  it("a clean run: complete, no warnings, no licence notice for an MIT model", () => {
    const notes = reportNotes(result({ params: { calculationType: "single-point", modelType: "MACE-MPA-0" } }));
    expect(notes.outcome).toEqual({ headline: "Calculation complete", detail: null });
    expect(notes.warnings).toEqual([]);
    expect(notes.licenseNotice).toBeNull();
  });

  it("an optimisation that did not converge is said so, with why", () => {
    const notes = reportNotes(
      result({
        converged: false,
        params: { calculationType: "geometry-opt", maxOptSteps: 5, optSteps: 5, finalFmax: 0.2, forceThreshold: 0.05 },
        warnings: ["Precision 'Auto' ran this in float64.", "Optimization not converged: 0.2 eV/Å > fmax 0.05 eV/Å after 5/5 steps."],
      }),
    );
    expect(notes.outcome.headline).toBe("Optimization did not converge");
    expect(notes.outcome.detail).toMatch(/not a relaxed minimum/);
    // The convergence fact is in the outcome; it is not repeated as a warning.
    expect(notes.warnings).toEqual(["Precision 'Auto' ran this in float64."]);
  });

  it("MACE-OFF carries its non-commercial licence notice, from the result or the model", () => {
    const own = reportNotes(result({ licenseNotice: "Non-commercial use only (ASL).", params: { modelType: "MACE-OFF" } }));
    expect(own.licenseNotice).toBe("Non-commercial use only (ASL).");
    const fromModel = reportNotes(result({ params: { modelType: "MACE-OFF" } }));
    expect(fromModel.licenseNotice).toMatch(/Academic Software License[^.]*does not permit commercial use/);
  });

  it("the PDF document prints all three", () => {
    const doc = readFileSync("components/calculate/pdf-report-document.tsx", "utf8");
    expect(doc).toMatch(/reportNotes\(result\)/);
    expect(doc).toMatch(/notes\.outcome\.headline/);
    expect(doc).toMatch(/notes\.warnings/);
    expect(doc).toMatch(/notes\.licenseNotice/);
  });
});
