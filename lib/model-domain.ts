/**
 * Which foundation model a structure belongs to.
 *
 * MACE-OFF and MACE-MP-0 report energies on incompatible conventions
 * (roughly -1..-15 vs -100..-600 eV/atom), so this choice decides whether a
 * number printed next to another number means anything.
 */

/** Elements MACE-OFF was trained on (organic chemistry space only). Per
 * CLAUDE.md's Model Selection rules; used to warn when a loaded structure
 * falls outside MACE-OFF's domain. */
export const MACE_OFF_ELEMENTS = new Set([
  "H", "C", "N", "O", "F", "P", "S", "Cl", "Br", "I",
]);

/**
 * The foundation model that can actually describe this structure.
 *
 * MACE-OFF only for an isolated molecule built entirely from the elements it
 * was trained on. Everything else — periodic structures, anything carrying an
 * element outside that set, and a structure that failed to parse — falls to
 * MACE-MP-0, whose 89 elements make it the baseline that cannot be out of
 * domain.
 */
export function foundationModelFor(
  structure: { isPeriodic: boolean; elements: string[] } | null | undefined,
): "MACE-OFF" | "MACE-MP-0" {
  if (!structure || structure.isPeriodic) return "MACE-MP-0";
  return structure.elements.every((el) => MACE_OFF_ELEMENTS.has(el))
    ? "MACE-OFF"
    : "MACE-MP-0";
}
