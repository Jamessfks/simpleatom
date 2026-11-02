import { describe, expect, it } from "vitest";
import {
  foundationParamsFor,
  isCustomResult,
  snapshotRun,
} from "@/components/calculate/run-snapshot";
import type { CalculationParams, CalculationResult } from "@/types/mace";

const file = (name: string) => ({ name }) as File;

const baseParams = (extra: Partial<CalculationParams> = {}): CalculationParams => ({
  modelSize: "large",
  modelType: "custom",
  device: "cpu",
  calculationType: "single-point",
  dispersion: false,
  temperature: 300,
  pressure: 0,
  timeStep: 1,
  friction: 0.005,
  mdSteps: 100,
  mdEnsemble: "NVT",
  forceThreshold: 0.05,
  maxOptSteps: 500,
  customModelName: "tuned.model",
  ...extra,
});

const crystal = { isPeriodic: true, elements: ["Na", "Cl"] } as never;
const molecule = { isPeriodic: false, elements: ["C", "H", "O"] } as never;

// D58: a result belongs to the run that produced it. Everything the dashboard,
// Share and Compare need is captured when the run starts, so editing the form
// afterwards cannot rewrite what a finished result is said to be.
describe("run snapshot (D58)", () => {
  it("keeps the run's own files and parameters when the form changes afterwards", () => {
    const files = [file("A.xyz")];
    const params = baseParams();
    const snap = snapshotRun({ files, params, structure: molecule, customModelName: "tuned.model" });

    files[0] = file("B.xyz");
    files.push(file("extra.xyz"));
    params.modelType = "MACE-OFF";
    params.temperature = 999;

    expect(snap.filename).toBe("A.xyz");
    expect(snap.files.map((f) => f.name)).toEqual(["A.xyz"]);
    expect(snap.params.modelType).toBe("custom");
    expect(snap.params.temperature).toBe(300);
  });

  it("decides whether a result is custom from the result, not the form", () => {
    const off = { status: "success", params: { modelType: "MACE-OFF" } } as CalculationResult;
    const custom = { status: "success", params: { modelType: "custom" } } as CalculationResult;
    expect(isCustomResult(off)).toBe(false);
    expect(isCustomResult(custom)).toBe(true);
    expect(isCustomResult({ status: "success" } as CalculationResult)).toBe(false);
  });

  it("builds the comparison run from the snapshot with a size the foundation model has", () => {
    const onCrystal = snapshotRun({ files: [file("nacl.cif")], params: baseParams(), structure: crystal });
    const p = foundationParamsFor(onCrystal);
    expect(p.modelType).toBe("MACE-MPA-0");
    // MPA-0 ships only `medium`; the custom run's stale "large" would be refused.
    expect(p.modelSize).toBe("medium");
    expect(p.customModelName).toBeUndefined();
  });

  it("never asks MACE-OFF for D3 dispersion", () => {
    const onMolecule = snapshotRun({
      files: [file("ethanol.xyz")],
      params: baseParams({ dispersion: true }),
      structure: molecule,
    });
    const p = foundationParamsFor(onMolecule);
    expect(p.modelType).toBe("MACE-OFF");
    expect(p.dispersion).toBe(false);
  });
});
