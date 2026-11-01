import { describe, expect, it } from "vitest";
import { renderBenchmarkBlob } from "@/components/benchmark/benchmark-export-pdf";
import { renderReportBlob } from "@/components/calculate/pdf-report-document";
import type { BenchmarkResult, CalculationResult } from "@/types/mace";
import { pdfTextOf, squash } from "./pdf-extract";

// D163: both PDFs set their text in built-in Helvetica, which draws only the
// Windows-1252 characters. react-pdf writes anything else as its low byte, so
// "omega" (U+03C9) came out as E-acute (0xC9) and the subscript two in "H2O"
// (U+2082) as a low double quote (0x82). These tests read the text back out of
// the rendered PDFs, as a viewer would show it.

const model = (label: string) => ({
  modelLabel: label,
  modelType: "MACE-MPA-0" as const,
  modelSize: "medium" as const,
  status: "success" as const,
  energyPerAtom: -7.1,
  timeTaken: 1,
});

const benchmark: BenchmarkResult = {
  status: "success",
  summary: {
    totalStructures: 3,
    totalModels: 1,
    totalCalculations: 3,
    successCount: 3,
    errorCount: 0,
    totalTime: 3,
  },
  results: [
    ["mp-72", "ω-Ti (mp-72)", "Ti"],
    ["water", "Water (H₂O)", "H2O"],
    ["x", "Fe₂O₃ · θ-phase ≥ 5 Å ☃", "Fe2O3"],
  ].map(([structureId, structureName, formula]) => ({
    structureId,
    structureName,
    category: "c",
    formula,
    atomCount: 3,
    models: [model("MACE-MPA-0 (medium)")],
  })),
};

async function benchmarkText(result: BenchmarkResult): Promise<string> {
  const blob = await renderBenchmarkBlob(result);
  return pdfTextOf(Buffer.from(await blob.arrayBuffer()));
}

async function reportText(result: CalculationResult): Promise<string> {
  const blob = await renderReportBlob(result);
  return pdfTextOf(Buffer.from(await blob.arrayBuffer()));
}

describe("the benchmark PDF prints structure names legibly (D163)", () => {
  it("spells omega-Ti and H2O in ASCII, not as mojibake", async () => {
    const text = squash(await benchmarkText(benchmark));
    expect(text).toContain("omega-Ti(mp-72)");
    expect(text).toContain("Water(H2O)");
    expect(text).not.toContain("É");
    expect(text).not.toContain("‚");
  });

  it("keeps the characters Helvetica can draw and replaces the rest", async () => {
    const text = squash(await benchmarkText(benchmark));
    expect(text).toContain("Fe2O3·theta-phase>=5Å?");
  });
});

describe("the calculation report prints free text legibly (D163)", () => {
  const result: CalculationResult = {
    status: "success",
    energy: -7.1,
    symbols: ["Ti"],
    forces: [[0, 0, 0]],
    message: "Relaxed ω-Ti: ΔE = −0.012 eV, H₂O reference",
    warnings: ["α-quartz is outside the training set", "Δ above 5 meV"],
    params: { calculationType: "single-point" },
  };

  it("maps omega, Delta, the minus sign and the subscript in the note and warnings", async () => {
    const text = squash(await reportText(result));
    expect(text).toContain("Relaxedomega-Ti:DeltaE=-0.012eV,H2Oreference");
    expect(text).toContain("alpha-quartzisoutsidethetrainingset");
    expect(text).toContain("Deltaabove5meV");
    expect(text).not.toContain("É");
    expect(text).not.toContain("‚");
  });
});
