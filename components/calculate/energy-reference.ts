/**
 * Which energy a result is judged by, and against what band (D52).
 *
 * The registry (`CONTRACT.energyConventions`) decides, never this file:
 *  - the MACE-MP family has a raw band on energy per atom (E/N);
 *  - MACE-OFF has none, because E/N depends on which elements are present (water
 *    is -693.7 eV/atom, CH2Br2 -28232.6), so its `typical` and `enforced` are
 *    null. What holds is a band on (E - sum of the model's isolated-atom
 *    energies) / N, which the backend reports as
 *    `properties.energyPerAtomVsIsolatedAtoms`.
 * A result without that number (one stored before D52, or a run whose model the
 * backend could not read E0 from) is not judged at all: a raw E/N is never held
 * against a band it has no right to.
 */

import { CONTRACT, findModel } from "@/lib/contract";
import type { CalculationResult } from "@/types/mace";

const METHODS: Record<string, string> = {
  mp: "PBE(+U) DFT reference",
  off: "ωB97M-D3BJ reference",
};

export interface EnergyReference {
  /** What `value` is: E/N, or (E - isolated atoms)/N. */
  basis: "per-atom" | "vs-isolated-atoms";
  method: string;
  /** Typical band for `value`, eV/atom, read from the registry. */
  band: [number, number];
  /** The number the band applies to, eV/atom; null when the result does not carry it. */
  value: number | null;
  /** Null when there is no value to judge. */
  inRange: boolean | null;
}

type Band = { minEvPerAtom: number; maxEvPerAtom: number };

const isBand = (v: unknown): v is Band =>
  typeof v === "object" && v !== null &&
  Number.isFinite((v as Band).minEvPerAtom) && Number.isFinite((v as Band).maxEvPerAtom);

/** The energy basis, band and verdict for a result; undefined when the registry knows no convention for its model. */
export function energyReference(result: CalculationResult): EnergyReference | undefined {
  const model = findModel(result.params?.modelType);
  if (!model) return undefined;
  const key = model.energyConvention;
  const convention: Record<string, unknown> = CONTRACT.energyConventions[key];
  const method = METHODS[key];
  if (!method) return undefined;

  const atomCount = result.symbols?.length ?? 0;
  const judge = (value: number | null, band: Band, basis: EnergyReference["basis"]): EnergyReference => ({
    basis,
    method,
    band: [band.minEvPerAtom, band.maxEvPerAtom],
    value,
    inRange: value === null ? null : value >= band.minEvPerAtom && value <= band.maxEvPerAtom,
  });

  // The band relative to the model's own isolated atoms, when the registry gives
  // one: it holds for any composition, which a raw E/N band does not.
  const relative = convention.relativeToIsolatedAtoms as { typical?: unknown } | undefined;
  if (relative && isBand(relative.typical)) {
    const reported = result.properties?.energyPerAtomVsIsolatedAtoms;
    return judge(typeof reported === "number" && Number.isFinite(reported) ? reported : null, relative.typical, "vs-isolated-atoms");
  }

  // Otherwise a raw band on E/N, when the registry has one (the MACE-MP family).
  if (isBand(convention.typical)) {
    const perAtom = result.energy != null && atomCount > 0 ? result.energy / atomCount : null;
    return judge(perAtom !== null && Number.isFinite(perAtom) ? perAtom : null, convention.typical, "per-atom");
  }
  return undefined;
}
