import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { energySpread, formatSpread, meanSpread } from "@/components/benchmark/benchmark-spread";
import type { BenchmarkStructureResult } from "@/types/mace";

// D97 (web review W9): with fewer than two models the leaderboard showed
// "0.0 meV" for dE_max, which reads as perfect agreement. dE is a difference of
// energies PER ATOM, so it is meV/atom, and the cells and the heatmap said "eV"
// and "meV". The footer averaged eV/atom over unrelated structures (Si, Cu,
// ethanol...), which means nothing.

const row = (energies: (number | null)[]): BenchmarkStructureResult =>
  ({
    structureId: "s",
    structureName: "s",
    category: "c",
    atomCount: 2,
    models: energies.map((e, i) =>
      e === null
        ? { modelLabel: `m${i}`, status: "error", error: "x" }
        : { modelLabel: `m${i}`, status: "success", energy: e * 2, energyPerAtom: e },
    ),
  }) as unknown as BenchmarkStructureResult;

describe("energy spread between models, meV/atom", () => {
  it("is null, not 0, when fewer than two models succeeded", () => {
    expect(energySpread(row([-1.0, null]))).toBeNull();
    expect(energySpread(row([null, null]))).toBeNull();
    expect(energySpread(row([-1.0]))).toBeNull();
  });

  it("is the largest minus the smallest energy per atom, in meV/atom", () => {
    expect(energySpread(row([-1.0, -1.002, -1.001]))).toBeCloseTo(2, 9);
  });

  it("is 0 only when two models genuinely agree", () => {
    expect(energySpread(row([-1.5, -1.5]))).toBe(0);
  });

  it("formats with its unit, and a dash when there is none", () => {
    expect(formatSpread(null)).toBe("—");
    expect(formatSpread(2)).toBe("2.0 meV/atom");
  });

  it("averages only the rows that can be compared, and is null when none can", () => {
    expect(meanSpread([row([-1, -1.002]), row([-1, null]), row([-1, -1.004])])).toBeCloseTo(3, 9);
    expect(meanSpread([row([-1, null])])).toBeNull();
  });
});

describe("benchmark components state per-atom units and invent no numbers", () => {
  const files = [
    "components/benchmark/benchmark-leaderboard.tsx",
    "components/benchmark/benchmark-export.tsx",
    "components/benchmark/benchmark-export-pdf.tsx",
    "components/benchmark/benchmark-heatmap.tsx",
  ];
  const text = (f: string) => readFileSync(f, "utf8");

  it("never labels an energy difference meV without /atom", () => {
    for (const f of files) {
      expect(text(f).match(/meV(?!\/atom)/g), f).toBeNull();
    }
  });

  it("labels energies per atom eV/atom, not eV", () => {
    expect(text("components/benchmark/benchmark-leaderboard.tsx")).not.toMatch(/\?\.toFixed\(4\) \?\? "N\/A"\} eV</);
    expect(text("components/benchmark/benchmark-export-pdf.tsx")).not.toMatch(/Leaderboard \(eV\)/);
  });

  it("does not average eV/atom across unrelated structures", () => {
    expect(text("components/benchmark/benchmark-leaderboard.tsx")).not.toMatch(/Avg: \$\{/);
  });

  it("does not turn a missing comparison into 0", () => {
    for (const f of files) {
      expect(text(f), f).not.toMatch(/energies\.length >= 2[\s\S]{0,120}: 0\b/);
      expect(text(f), f).not.toMatch(/if \(energies\.length < 2\) return 0/);
    }
  });

  it("the CSV says the reference cohesive energy is experimental", () => {
    expect(text("components/benchmark/benchmark-export.tsx")).toMatch(/Ref_Cohesive_Energy_experimental \(eV\/atom\)/);
  });

  it("no one cites a handbook the catalog does not use", () => {
    for (const f of files) expect(text(f), f).not.toMatch(/CRC Handbook/);
  });
});
