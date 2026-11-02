import { describe, expect, it } from "vitest";
import { bfgsSteps, runOutcome, shareCaveats, stopCause, warningsBeyondOutcome } from "@/components/calculate/run-outcome";
import type { CalculationResult } from "@/types/mace";

const result = (extra: Partial<CalculationResult>): CalculationResult => ({
  status: "success",
  energy: -1,
  ...extra,
});

// D60: a run that did not finish what was asked is not "complete". The backend
// reports converged=false and stoppedEarly; the banner must say so, and name
// the real reason rather than blaming a step limit for a time-budget stop.
describe("run outcome (D60)", () => {
  it("calls an ordinary run complete", () => {
    const o = runOutcome(result({ params: { calculationType: "single-point" } }));
    expect(o.kind).toBe("complete");
    expect(o.headline).toBe("Calculation complete");
    expect(o.detail).toBeNull();
  });

  it("calls a converged optimisation complete", () => {
    const o = runOutcome(result({ converged: true, params: { calculationType: "geometry-opt" } }));
    expect(o.kind).toBe("complete");
  });

  it("says an optimisation that hit maxOptSteps did not converge", () => {
    const o = runOutcome(
      result({
        converged: false,
        params: { calculationType: "geometry-opt", maxOptSteps: 500, optSteps: 500, finalFmax: 0.12, forceThreshold: 0.05 },
      }),
    );
    expect(o.kind).toBe("not-converged");
    expect(o.headline).not.toMatch(/complete/i);
    expect(o.detail).toMatch(/500/);
    expect(o.detail).toMatch(/0\.120/);
    expect(o.detail).toMatch(/not a relaxed minimum/i);
  });

  it("names the time budget, and the step it stopped at, for a stopped MD run", () => {
    const o = runOutcome(
      result({
        stoppedEarly: { reason: "time-budget", atStep: 1200, budgetSeconds: 240 },
        params: { calculationType: "molecular-dynamics", mdSteps: 5000 },
      }),
    );
    expect(o.kind).toBe("stopped-early");
    expect(o.headline).toMatch(/time budget/i);
    expect(o.detail).toMatch(/1200 of 5000/);
    expect(o.detail).toMatch(/240 s/);
  });

  it("blames the time budget, not the step limit, for a budget-stopped optimisation", () => {
    const r = result({
      converged: false,
      stoppedEarly: { reason: "time-budget", atStep: 80, budgetSeconds: 240 },
      params: { calculationType: "geometry-opt", maxOptSteps: 500, finalFmax: 0.2 },
    });
    expect(stopCause(r)).toBe("time-budget");
    const o = runOutcome(r);
    expect(o.kind).toBe("stopped-early");
    expect(o.detail).toMatch(/80 of 500/);
    expect(o.detail).toMatch(/not a relaxed minimum/i);
  });

  it("reads stoppedEarly from the echoed params when the top level lacks it", () => {
    const r = result({
      params: {
        calculationType: "molecular-dynamics",
        mdSteps: 100,
        stoppedEarly: { reason: "time-budget", atStep: 10, budgetSeconds: 60 },
      },
    });
    expect(runOutcome(r).kind).toBe("stopped-early");
  });

  it("names the step limit when only the ceiling was hit", () => {
    expect(stopCause(result({ converged: false, params: { calculationType: "geometry-opt" } }))).toBe("step-limit");
    expect(stopCause(result({ converged: true }))).toBeNull();
  });
});

// Design review: "(1 BFGS steps)", and the same fact said three times — in the
// banner, in a second card and as a bullet in the warnings list.
describe("the not-converged outcome says it once, in the singular when it is one step", () => {
  const notConverged = result({
    converged: false,
    params: { calculationType: "geometry-opt", maxOptSteps: 1, optSteps: 1, finalFmax: 0.673, forceThreshold: 0.05 },
    warnings: [
      "Precision 'Auto' ran this geometry optimization in float64.",
      "Optimization not converged: 0.6726 eV/Å > fmax 0.05 eV/Å after 1/1 steps.",
    ],
  });

  it("pluralises BFGS steps", () => {
    expect(bfgsSteps(1)).toBe("1 BFGS step");
    expect(bfgsSteps(0)).toBe("0 BFGS steps");
    expect(bfgsSteps(500)).toBe("500 BFGS steps");
    const detail = runOutcome(notConverged).detail!;
    expect(detail).toMatch(/\(1 BFGS step\)/);
    expect(detail).not.toMatch(/1 BFGS steps/);
  });

  it("drops the backend's own not-converged warning, which the banner already says", () => {
    expect(warningsBeyondOutcome(notConverged)).toEqual(["Precision 'Auto' ran this geometry optimization in float64."]);
  });

  it("keeps every warning when the run converged, or the banner has nothing to say", () => {
    const converged = result({ converged: true, params: { calculationType: "geometry-opt" }, warnings: ["a", "Optimization not converged: x"] });
    expect(warningsBeyondOutcome(converged)).toEqual(["a", "Optimization not converged: x"]);
    expect(warningsBeyondOutcome(result({}))).toEqual([]);
  });
});

// Design review: the publish confirmation said nothing about a result that did
// not converge or carries warnings, although both are published with it.
describe("what the publish dialog warns about", () => {
  it("nothing for a clean run", () => {
    expect(shareCaveats(result({ converged: true, params: { calculationType: "geometry-opt" } }))).toEqual([]);
    expect(shareCaveats(result({ params: { calculationType: "single-point" } }))).toEqual([]);
  });

  it("says a run that did not converge is not a relaxed minimum", () => {
    const caveats = shareCaveats(
      result({ converged: false, params: { calculationType: "geometry-opt", maxOptSteps: 5, optSteps: 5, finalFmax: 0.2, forceThreshold: 0.05 } }),
    );
    expect(caveats.join(" ")).toMatch(/not a relaxed minimum/);
  });

  it("counts the warnings that will be published with it", () => {
    expect(shareCaveats(result({ warnings: ["a"] }))).toEqual([
      "1 warning from the calculation is published with the result.",
    ]);
    expect(shareCaveats(result({ warnings: ["a", "b"] }))).toEqual([
      "2 warnings from the calculation are published with the result.",
    ]);
  });
});
