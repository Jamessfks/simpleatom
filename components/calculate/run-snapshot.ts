/**
 * What a finished result belongs to.
 *
 * The calculator's form stays editable while a result is on screen. Anything
 * that describes the RESULT (its filename, the model it ran, the structure a
 * comparison must reuse) therefore has to come from what was submitted, not
 * from the form as it stands now. A snapshot is taken when the run starts and
 * feeds the dashboard, Share and "Compare with foundation model".
 */

import { findModel } from "@/lib/contract";
import { foundationModelFor } from "@/lib/model-domain";
import type { ParsedStructure } from "@/lib/parse-structure";
import type { CalculationParams, CalculationResult } from "@/types/mace";

export interface RunSnapshot {
  files: File[];
  params: CalculationParams;
  /** Name of the first uploaded file, the one the run was labelled with. */
  filename: string | undefined;
  structure: ParsedStructure | null;
  customModelName?: string;
}

/** Copy what the run was submitted with, so later form edits cannot reach it. */
export function snapshotRun(input: {
  files: readonly File[];
  params: CalculationParams;
  structure: ParsedStructure | null;
  customModelName?: string;
}): RunSnapshot {
  return {
    files: [...input.files],
    params: { ...input.params },
    filename: input.files[0]?.name,
    structure: input.structure,
    customModelName: input.customModelName,
  };
}

/** True when the result was computed by an uploaded checkpoint. */
export function isCustomResult(result: CalculationResult): boolean {
  return result.params?.modelType === "custom";
}

/**
 * Parameters for the foundation-model run a comparison needs: the snapshot's
 * own settings, the model chosen from its parsed structure, and a size that
 * model actually has (a custom run carries no size, and a stale one from an
 * earlier selection is refused by the backend).
 */
export function foundationParamsFor(snapshot: RunSnapshot): CalculationParams {
  const modelType = foundationModelFor(snapshot.structure);
  const entry = findModel(modelType);
  const { customModelName: _name, ...rest } = snapshot.params;
  void _name;
  return {
    ...rest,
    modelType,
    modelSize: (entry?.defaultSize ?? rest.modelSize) as CalculationParams["modelSize"],
    // Only the MACE-MP family accepts D3; MACE-OFF already includes dispersion.
    dispersion: entry?.dispersion.allowed ? rest.dispersion : false,
  };
}
