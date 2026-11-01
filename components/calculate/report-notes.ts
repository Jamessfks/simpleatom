import { licenseNotice } from "@/lib/contract";
import type { CalculationResult } from "@/types/mace";
import { runOutcome, warningsBeyondOutcome } from "./run-outcome";

/**
 * What a PDF report has to say besides the numbers (D69 / F21): how the run
 * ended (the report printed "Status: success" for an optimisation that did not
 * converge), the warnings the calculation raised, and the licence notice that
 * every on-screen result carries (MACE-OFF is non-commercial).
 */
export interface ReportNotes {
  outcome: { headline: string; detail: string | null };
  /** Backend warnings, without the one the outcome already says. */
  warnings: string[];
  /** The model's licence notice, or null for a model without one. */
  licenseNotice: string | null;
}

export function reportNotes(result: CalculationResult): ReportNotes {
  const { headline, detail } = runOutcome(result);
  return {
    outcome: { headline, detail },
    warnings: warningsBeyondOutcome(result),
    licenseNotice: result.licenseNotice ?? licenseNotice(result.params?.modelType),
  };
}
