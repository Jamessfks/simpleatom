import { describe, expect, it } from "vitest";
import { CONTRACT } from "@/lib/generated/contract";

// D176: the dashboard called I2 (-0.31 / -0.47 eV/atom relative to isolated atoms)
// outside the typical range while the validator accepted it. The typical band must
// cover the measured molecules: -4.99 to -0.31 eV/atom over 30 molecules (batch 4).
const band = CONTRACT.energyConventions.off.relativeToIsolatedAtoms;

describe("MACE-OFF's relative energy band (D176)", () => {
  it("calls every measured molecule typical, I2 included", () => {
    for (const value of [-4.99, -0.47, -0.31]) {
      expect(value).toBeGreaterThanOrEqual(band.typical.minEvPerAtom);
      expect(value).toBeLessThanOrEqual(band.typical.maxEvPerAtom);
    }
  });

  it("keeps the typical band inside the enforced one", () => {
    expect(band.typical.minEvPerAtom).toBeGreaterThanOrEqual(band.enforced.minEvPerAtom);
    expect(band.typical.maxEvPerAtom).toBeLessThanOrEqual(band.enforced.maxEvPerAtom);
  });
});
