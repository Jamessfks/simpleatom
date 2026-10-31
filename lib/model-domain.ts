/**
 * Which foundation model a structure belongs to.
 *
 * MACE-OFF and the MACE-MP family report energies on incompatible conventions
 * (roughly -1..-15 vs -100..-600 eV/atom), so this choice decides whether a
 * number printed next to another number means anything. Element coverage and
 * the materials default both come from the model registry
 * (mace-api/contract.json).
 */

import { DEFAULT_MODEL_TYPE, findModel, type ModelId } from "@/lib/contract";

/** Elements MACE-OFF was trained on (organic chemistry space only). */
export const MACE_OFF_ELEMENTS: ReadonlySet<string> = new Set<string>(
  findModel("MACE-OFF")?.elements ?? [],
);

/**
 * The foundation model that can actually describe this structure.
 *
 * MACE-OFF only for an isolated molecule built entirely from the elements it
 * was trained on. Everything else — periodic structures, anything carrying an
 * element outside that set, and a structure that failed to parse — falls to
 * the materials default (MACE-MPA-0), whose 89 elements make it the baseline
 * that cannot be out of domain.
 */
export function foundationModelFor(
  structure: { isPeriodic: boolean; elements: string[] } | null | undefined,
): ModelId {
  if (!structure || structure.isPeriodic) return DEFAULT_MODEL_TYPE;
  return structure.elements.every((el) => MACE_OFF_ELEMENTS.has(el))
    ? "MACE-OFF"
    : DEFAULT_MODEL_TYPE;
}
