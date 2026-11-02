import { describe, expect, it } from "vitest";
import { energyReference } from "@/components/calculate/energy-reference";
import { CONTRACT } from "@/lib/contract";
import type { CalculationResult } from "@/types/mace";

const result = (modelType: string, extra: Partial<CalculationResult> = {}): CalculationResult =>
  ({
    status: "success",
    energy: -100,
    symbols: ["A", "B"],
    params: { modelType, modelSize: "small", calculationType: "single-point", device: "cpu", dispersion: false },
    ...extra,
  }) as unknown as CalculationResult;

const offBand = CONTRACT.energyConventions.off.relativeToIsolatedAtoms.typical;
const mpBand = CONTRACT.energyConventions.mp.typical;

describe("energyReference reads the band and the quantity from the registry (D52)", () => {
  it("judges the MACE-MP family by energy per atom", () => {
    const ref = energyReference(result("MACE-MPA-0", { energy: -10 }))!;
    expect(ref.basis).toBe("per-atom");
    expect(ref.value).toBe(-5);
    expect(ref.band).toEqual([mpBand.minEvPerAtom, mpBand.maxEvPerAtom]);
    expect(ref.inRange).toBe(true);
    expect(energyReference(result("MACE-MP-0", { energy: -1000 }))!.inRange).toBe(false);
  });

  it("judges MACE-OFF by the energy relative to isolated atoms, whatever the raw energy is", () => {
    const heavy = result("MACE-OFF", {
      energy: -28232.6 * 2,
      properties: { energyPerAtomVsIsolatedAtoms: (offBand.minEvPerAtom + offBand.maxEvPerAtom) / 2 },
    });
    const ref = energyReference(heavy)!;
    expect(ref.basis).toBe("vs-isolated-atoms");
    expect(ref.band).toEqual([offBand.minEvPerAtom, offBand.maxEvPerAtom]);
    expect(ref.inRange).toBe(true);
    expect(energyReference(result("MACE-OFF23", { properties: { energyPerAtomVsIsolatedAtoms: offBand.maxEvPerAtom + 1 } }))!.inRange).toBe(false);
  });

  it("does not judge a MACE-OFF result that lacks the relative energy, rather than using the raw one", () => {
    for (const properties of [undefined, {}, { energyPerAtomVsIsolatedAtoms: Number.NaN }]) {
      const ref = energyReference(result("MACE-OFF", { energy: -693.7 * 2, properties }))!;
      expect(ref.value).toBeNull();
      expect(ref.inRange).toBeNull();
    }
  });

  it("knows no convention for a custom checkpoint or an unknown model", () => {
    expect(energyReference(result("custom"))).toBeUndefined();
    expect(energyReference(result("MACE-XYZ"))).toBeUndefined();
    expect(energyReference({ status: "success" } as CalculationResult)).toBeUndefined();
  });
});
