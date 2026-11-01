import { describe, expect, it } from "vitest";
import { referenceAccuracy } from "@/components/calculate/reference-accuracy";
import type { CalculationResult } from "@/types/mace";

// D90 (web review W2): the reference energy and forces in an uploaded file
// describe the INPUT geometry. A single point is computed there, so comparing
// is fair. A geometry optimisation or MD run returns the FINAL geometry's
// forces, and comparing those with the input's reference scored the geometry
// change as model error: a model identical to its reference showed a force MAE
// of 1715.8 meV/A (opt) and 2408.6 meV/A (MD).

const refForces = [[0.5, 0, 0], [-0.5, 0, 0]];
const refEnergy = -10;

function result(type: string | undefined, over: Partial<CalculationResult> = {}): CalculationResult {
  return {
    status: "success",
    symbols: ["H", "H"],
    energy: -10, // the model reproduces its own reference at the input geometry
    forces: refForces,
    referenceEnergy: refEnergy,
    referenceForces: refForces,
    params: type ? ({ calculationType: type } as CalculationResult["params"]) : undefined,
    ...over,
  };
}

describe("a single point is scored against its reference (D90)", () => {
  it("compares the final energy and forces, and says nothing is caveated", () => {
    const acc = referenceAccuracy(result("single-point"));
    expect(acc.basis).toBe("final-geometry");
    expect(acc.forceMAE).toBe(0);
    expect(acc.energyMAE).toBe(0);
    expect(acc.predictedEnergy).toBe(-10);
    expect(acc.note).toBeNull();
  });

  it("scores a model that differs from its reference", () => {
    const acc = referenceAccuracy(result("single-point", { energy: -9.9, forces: [[0.6, 0, 0], [-0.5, 0, 0]] }));
    expect(acc.forceMAE).toBeCloseTo((0.1 / 6) * 1000, 6);
    expect(acc.energyError).toBeCloseTo(0.1, 12);
    expect(acc.energyMAE).toBeCloseTo((0.1 / 2) * 1000, 6);
  });
});

describe("a geometry optimisation or MD run is not scored against the input's reference (D90)", () => {
  const moved = {
    energy: -10.3, // final geometry: lower
    forces: [[0.01, 0, 0], [-0.01, 0, 0]],
    trajectory: { energies: [-10, -10.2, -10.3], step: [0, 1, 2], positions: [] as number[][][] },
  };

  for (const type of ["geometry-opt", "molecular-dynamics"]) {
    it(`${type}: no force error, and the energy is compared at step 0`, () => {
      const acc = referenceAccuracy(result(type, moved));
      expect(acc.basis).toBe("input-geometry");
      expect(acc.forceMAE).toBeNull();
      expect(acc.forceRMSE).toBeNull();
      expect(acc.maxForceError).toBeNull();
      expect(acc.predictedEnergy).toBe(-10); // frame 0 = the input geometry
      expect(acc.energyMAE).toBe(0); // a perfect model shows no error, not 143.6 meV/atom
      expect(acc.note).toMatch(/input geometry/i);
      expect(acc.note).toMatch(/single point/i);
    });

    it(`${type}: without a trajectory there is nothing to compare, and it says why`, () => {
      const acc = referenceAccuracy(result(type, { ...moved, trajectory: undefined }));
      expect(acc.energyMAE).toBeNull();
      expect(acc.energyError).toBeNull();
      expect(acc.predictedEnergy).toBeNull();
      expect(acc.note).toMatch(/input geometry/i);
    });
  }

  it("a trajectory that does not begin at step 0 is not the input geometry", () => {
    const acc = referenceAccuracy(
      result("geometry-opt", { ...moved, trajectory: { ...moved.trajectory, step: [5, 6, 7] } }),
    );
    expect(acc.predictedEnergy).toBeNull();
  });
});

describe("results without params (shared before v2.2)", () => {
  it("a result with a trajectory is not treated as a single point", () => {
    const acc = referenceAccuracy(
      result(undefined, { trajectory: { energies: [-10, -11], step: [0, 1], positions: [] } }),
    );
    expect(acc.basis).toBe("input-geometry");
    expect(acc.forceMAE).toBeNull();
  });

  it("a result with no trajectory is read as a single point", () => {
    expect(referenceAccuracy(result(undefined)).basis).toBe("final-geometry");
  });
});

describe("no reference data", () => {
  it("reports nothing", () => {
    const acc = referenceAccuracy(result("single-point", { referenceEnergy: undefined, referenceForces: undefined }));
    expect(acc.forceMAE).toBeNull();
    expect(acc.energyMAE).toBeNull();
    expect(acc.note).toBeNull();
  });
});
