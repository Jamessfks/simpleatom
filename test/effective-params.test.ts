import { describe, expect, it } from "vitest";
import { effectiveRunParams } from "@/components/calculate/effective-params";
import type { CalculationParams } from "@/types/mace";

// The calculator form always holds every field, defaults included.
const form = (extra: Partial<CalculationParams> = {}): CalculationParams => ({
  modelSize: "medium",
  modelType: "MACE-MPA-0",
  device: "cpu",
  calculationType: "molecular-dynamics",
  dispersion: false,
  temperature: 300,
  pressure: 0,
  timeStep: 1,
  friction: 0.005,
  mdSteps: 100,
  mdEnsemble: "NVT",
  forceThreshold: 0.05,
  maxOptSteps: 500,
  ...extra,
});

// What mace-api/calculate.py `_run_md` echoes: friction for NVT only (D55),
// pressure for NPT only.
const echo = (extra: Partial<CalculationParams> = {}): Partial<CalculationParams> => ({
  calculationType: "molecular-dynamics",
  modelType: "MACE-MPA-0",
  modelSize: "medium",
  device: "cpu",
  precision: "float32",
  dispersion: false,
  temperature: 300,
  timeStep: 1,
  mdSteps: 100,
  seed: 42,
  ...extra,
});

// D55: the Langevin thermostat is the only reader of `friction`. A result for
// NVE or NPT must not state a coefficient that nothing used, and the form's
// default (0.005) must not be merged back in where the backend left it out.
describe("effectiveRunParams: friction belongs to NVT alone (D55)", () => {
  it("shows the friction an NVT run echoed", () => {
    const shown = effectiveRunParams(form(), echo({ mdEnsemble: "NVT", friction: 0.01 }));
    expect(shown.friction).toBe(0.01);
  });

  it("falls back to the requested friction for NVT when the backend echoed nothing", () => {
    expect(effectiveRunParams(form({ friction: 0.02 }), undefined).friction).toBe(0.02);
  });

  it("does not borrow the form's friction for an NVE run", () => {
    const shown = effectiveRunParams(form({ mdEnsemble: "NVE" }), echo({ mdEnsemble: "NVE" }));
    expect(shown.mdEnsemble).toBe("NVE");
    expect(shown).not.toHaveProperty("friction");
  });

  it("does not borrow the form's friction for an NPT run, and keeps its pressure", () => {
    const shown = effectiveRunParams(
      form({ mdEnsemble: "NPT", pressure: 1 }),
      echo({ mdEnsemble: "NPT" }),
    );
    expect(shown).not.toHaveProperty("friction");
    expect(shown.pressure).toBe(1);
  });

  it("drops friction when the echo is missing and the request says NVE", () => {
    expect(effectiveRunParams(form({ mdEnsemble: "NVE" }), undefined)).not.toHaveProperty("friction");
  });

  it("drops friction an older backend echoed for NVE or NPT", () => {
    for (const mdEnsemble of ["NVE", "NPT"] as const) {
      const shown = effectiveRunParams(form({ mdEnsemble }), echo({ mdEnsemble, friction: 0.005 }));
      expect(shown, mdEnsemble).not.toHaveProperty("friction");
    }
  });

  it("still keeps the rest of an NVE run's description", () => {
    const shown = effectiveRunParams(form({ mdEnsemble: "NVE" }), echo({ mdEnsemble: "NVE" }));
    expect(shown).toMatchObject({ temperature: 300, timeStep: 1, mdSteps: 100, seed: 42 });
    expect(shown).not.toHaveProperty("pressure");
  });

  it("never gives a single-point or an optimisation a friction", () => {
    for (const calculationType of ["single-point", "geometry-opt"] as const) {
      const shown = effectiveRunParams(form({ calculationType }), echo({ calculationType }));
      expect(shown, calculationType).not.toHaveProperty("friction");
    }
  });
});
