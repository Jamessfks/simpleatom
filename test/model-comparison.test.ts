import { describe, expect, it } from "vitest";
import { summariseComparison } from "@/components/calculate/comparison";
import type { CalculationResult } from "@/types/mace";

const result = (
  energy: number,
  forces: number[][],
  modelType: string,
  modelSize?: string,
): CalculationResult =>
  ({
    status: "success",
    energy,
    forces,
    symbols: forces.map(() => "C"),
    params: { modelType, modelSize },
  }) as CalculationResult;

const f2 = [[0, 0, 0], [0, 0, 0]];

// D68: "Compare with foundation model" printed customEnergy - foundationEnergy
// even though a custom checkpoint's energy zero is unknown (ADR-0019), never
// said which foundation model ran, and the docs promised metrics (R²) that
// were never computed.
describe("model comparison (D68)", () => {
  it("refuses an energy difference against a custom checkpoint and says why", () => {
    const s = summariseComparison(result(-3604.5, f2, "custom"), result(-10, f2, "MACE-OFF", "medium"));
    expect(s.deltaEnergyPerAtom).toBeNull();
    expect(s.energyNote).toMatch(/reference/i);
    expect(s.energyNote).toMatch(/MACE-OFF23/);
  });

  it("refuses it across two different known conventions", () => {
    const s = summariseComparison(result(-1, f2, "MACE-OFF"), result(-1, f2, "MACE-MPA-0"));
    expect(s.deltaEnergyPerAtom).toBeNull();
    expect(s.energyNote).toBeTruthy();
  });

  it("reports a per-atom difference when both models share a convention", () => {
    const s = summariseComparison(result(-10, f2, "MACE-MP-0", "small"), result(-9, f2, "MACE-MPA-0", "medium"));
    expect(s.deltaEnergyPerAtom).toBeCloseTo(-0.5, 10);
    expect(s.energyNote).toBeNull();
  });

  it("names the foundation model that ran, with its size", () => {
    const s = summariseComparison(result(-1, f2, "custom"), result(-1, f2, "MACE-MPA-0", "medium"));
    expect(s.foundationLabel).toBe("MACE-MPA-0 (medium)");
    expect(summariseComparison(result(-1, f2, "custom"), result(-1, f2, "MACE-OFF", "medium")).foundationLabel).toBe(
      "MACE-OFF23 (medium)",
    );
  });

  it("computes the RMS difference between the two models' forces, per atom", () => {
    const a = result(0, [[0, 0, 0], [0, 0, 0]], "custom");
    const b = result(0, [[3, 0, 0], [0, 4, 0]], "MACE-MPA-0", "medium");
    expect(summariseComparison(a, b).forceRmsd).toBeCloseTo(Math.sqrt((9 + 16) / 2), 10);
  });

  it("compares nothing when the atom counts differ", () => {
    const s = summariseComparison(result(-1, f2, "MACE-MP-0"), result(-1, [[0, 0, 0]], "MACE-MPA-0", "medium"));
    expect(s.deltaEnergyPerAtom).toBeNull();
    expect(s.forceRmsd).toBeNull();
  });
});
