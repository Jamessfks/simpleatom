/**
 * What a custom-vs-foundation comparison may honestly say.
 *
 * Absolute energies are only comparable when both come from the same reference
 * convention (ADR-0019, registry `energyConvention`). A custom checkpoint's is
 * unknown, and MACE-OFF's differs from the MACE-MP family's by orders of
 * magnitude, so those differences are refused rather than printed. Forces have
 * no such offset, so the RMS difference between the two models' forces is
 * always available when they describe the same atoms.
 */

import { findModel } from "@/lib/contract";
import type { CalculationResult } from "@/types/mace";

export interface ComparisonSummary {
  /** The foundation model that ran, e.g. "MACE-MPA-0 (medium)". */
  foundationLabel: string;
  /** custom − foundation, eV/atom; null when the two energies are not comparable. */
  deltaEnergyPerAtom: number | null;
  /** Why there is no energy difference; null when there is one. */
  energyNote: string | null;
  /** RMS over atoms of |F_custom − F_foundation|, eV/Å; null when the atoms differ. */
  forceRmsd: number | null;
}

function labelOf(result: CalculationResult): string {
  const model = findModel(result.params?.modelType);
  if (!model) return "the foundation model";
  const size = result.params?.modelSize;
  return size && Object.keys(model.sizes).length > 0 ? `${model.label} (${size})` : model.label;
}

export function summariseComparison(
  custom: CalculationResult,
  foundation: CalculationResult,
): ComparisonSummary {
  const foundationLabel = labelOf(foundation);
  const n = custom.symbols?.length ?? 0;
  const sameAtoms = n > 0 && n === foundation.symbols?.length;

  const a = findModel(custom.params?.modelType)?.energyConvention ?? "unknown";
  const b = findModel(foundation.params?.modelType)?.energyConvention ?? "unknown";
  const comparable = a !== "unknown" && a === b;

  let deltaEnergyPerAtom: number | null = null;
  let energyNote: string | null = null;
  if (!sameAtoms) {
    energyNote = "Energy difference not shown: the two results do not describe the same number of atoms.";
  } else if (!comparable) {
    const reference = (c: string) =>
      c === "off" ? "the MACE-OFF reference" : c === "mp" ? "the MACE-MP reference" : "an unknown reference";
    energyNote =
      `Energy difference not shown: the two models measure energy from different or unknown references ` +
      `(${labelOf(custom)}: ${reference(a)}; ${foundationLabel}: ${reference(b)}), so their absolute ` +
      `energies cannot be subtracted. Forces are comparable.`;
  } else if (typeof custom.energy === "number" && typeof foundation.energy === "number") {
    deltaEnergyPerAtom = (custom.energy - foundation.energy) / n;
  }

  let forceRmsd: number | null = null;
  const fc = custom.forces;
  const ff = foundation.forces;
  if (sameAtoms && fc && ff && fc.length === n && ff.length === n) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) sum += (fc[i][k] - ff[i][k]) ** 2;
    }
    forceRmsd = Math.sqrt(sum / n);
  }

  return { foundationLabel, deltaEnergyPerAtom, energyNote, forceRmsd };
}
