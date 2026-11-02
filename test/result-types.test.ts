import { describe, expect, it } from "vitest";
import type { CalculationResult, SmilesToXyzResponse } from "@/types/mace";

// The backend (mace-api/calculate.py, smiles_to_xyz.py) returns these keys; the
// types must name them so a reader of a result is told what each one is. This
// file is checked by `npm run typecheck`: it does not compile until
// types/mace.ts declares every key, with the shapes below.
describe("result keys the backend now returns are typed", () => {
  it("accepts a result carrying every one of them", () => {
    const result: CalculationResult = {
      status: "success",
      energy: -14.2,
      // Indices of atoms a constraint acts on (POSCAR selective dynamics, D132).
      constrainedAtoms: [0, 1],
      // Which file key each reference value came from.
      referenceSource: { energy: "REF_energy", forces: "REF_forces" },
      // MD statistics (D53); the NVE drift exists for NVE only.
      mdSummary: {
        warmupFraction: 0.2,
        warmupFrames: 20,
        meanTemperature: 301.2,
        temperatureStdError: 2.1,
        temperatureBlocks: 5,
        nveDriftMeVPerAtomPerPs: -0.4,
      },
      properties: {
        stress: [0, 0, 0, 0, 0, 0],
        pressure: 0,
        // Whether the pressure includes the ideal-gas term (MD, D54).
        stressIncludesKineticTerm: true,
        // (E - sum of the model's isolated-atom energies) / N, and that sum (D52).
        isolatedAtomsEnergy: -2079.5,
        energyPerAtomVsIsolatedAtoms: -3.35,
      },
      params: {
        // NPT rotated the cell into ASE's standard form (positions, forces and lattice follow).
        cellRotation: {
          reason: "NPT needs a triangular cell",
          form: "lower-triangular",
          rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        },
      },
    };
    expect(result.constrainedAtoms).toEqual([0, 1]);
    expect(result.properties?.energyPerAtomVsIsolatedAtoms).toBe(-3.35);
    expect(result.params?.cellRotation?.rotation).toHaveLength(3);
  });

  it("types the SMILES converter's answer, with the force field that shaped the geometry", () => {
    const answers: SmilesToXyzResponse[] = [
      { xyz: "1\n\nH 0 0 0\n", num_atoms: 1, smiles_canonical: "[H]", formula: "H", force_field: "MMFF94" },
      { xyz: "1\n\nB 0 0 0\n", num_atoms: 1, smiles_canonical: "[B]", formula: "B", force_field: "UFF" },
      { xyz: "1\n\nZn 0 0 0\n", num_atoms: 1, smiles_canonical: "[Zn]", formula: "Zn", force_field: null },
    ];
    expect(answers.map((a) => a.force_field)).toEqual(["MMFF94", "UFF", null]);
  });
});
