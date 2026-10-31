import { describe, expect, it } from "vitest";
import { runOutcome, stopCause } from "@/components/calculate/run-outcome";
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
