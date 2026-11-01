/**
 * How a finished run ended, in words the banner can print.
 *
 * `status === "success"` only says the calculation returned numbers. A BFGS
 * run that exhausted maxOptSteps is not a relaxed minimum, and a run the
 * deployment's time budget cut short covers fewer steps than were asked for.
 * Calling either one "complete" is the same class of error as reporting a
 * calculation that never ran, so the banner and the status pill read this.
 */

import type { CalculationParams, CalculationResult, StoppedEarly } from "@/types/mace";

export type RunOutcomeKind = "complete" | "not-converged" | "stopped-early";

export interface RunOutcome {
  kind: RunOutcomeKind;
  /** Banner text. */
  headline: string;
  /** Short label for the status pill. */
  pill: string;
  /** What stopped the run and what that means for the numbers; null when nothing to add. */
  detail: string | null;
  tone: "success" | "warning";
}

/** The deployment's early stop, from the result or from its echoed params. */
function stoppedEarlyOf(result: CalculationResult): StoppedEarly | undefined {
  return result.stoppedEarly ?? result.params?.stoppedEarly;
}

/**
 * Why a run ended before its goal: the deployment's time budget, or the
 * optimizer's maxOptSteps ceiling. Null when it ended as asked.
 */
export function stopCause(result: CalculationResult): "time-budget" | "step-limit" | null {
  if (stoppedEarlyOf(result)) return "time-budget";
  const converged = result.converged ?? result.params?.converged;
  return converged === false ? "step-limit" : null;
}

function requestedSteps(params: Partial<CalculationParams> | undefined): number | undefined {
  if (params?.calculationType === "geometry-opt") return params.maxOptSteps;
  if (params?.calculationType === "molecular-dynamics") return params.mdSteps;
  return undefined;
}

export function runOutcome(result: CalculationResult): RunOutcome {
  const params = result.params;
  const converged = result.converged ?? params?.converged;
  const stopped = stoppedEarlyOf(result);

  if (stopped) {
    const total = requestedSteps(params);
    const where =
      total != null ? `step ${stopped.atStep} of ${total}` : `step ${stopped.atStep}`;
    const unrelaxed = converged === false ? " The reported geometry is not a relaxed minimum." : "";
    return {
      kind: "stopped-early",
      headline: "Stopped at the time budget",
      pill: "Stopped early",
      detail:
        `Stopped after ${where}: this deployment's ${stopped.budgetSeconds} s time budget ran out. ` +
        `Everything reported is from the steps that ran.${unrelaxed}`,
      tone: "warning",
    };
  }

  if (converged === false) {
    const steps = params?.optSteps ?? params?.maxOptSteps;
    const fmax =
      typeof params?.finalFmax === "number" ? ` with max force ${params.finalFmax.toFixed(3)} eV/Å` : "";
    const target =
      typeof params?.forceThreshold === "number" ? ` above the ${params.forceThreshold} eV/Å target` : "";
    return {
      kind: "not-converged",
      headline: "Optimization did not converge",
      pill: "Not converged",
      detail:
        `Stopped at the step limit${steps != null ? ` (${steps} BFGS steps)` : ""}${fmax}${target}. ` +
        `The reported geometry is not a relaxed minimum.`,
      tone: "warning",
    };
  }

  return { kind: "complete", headline: "Calculation complete", pill: "Complete", detail: null, tone: "success" };
}
