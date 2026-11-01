import type { BenchmarkStructureResult } from "@/types/mace";

/**
 * Largest minus smallest energy PER ATOM across the models that succeeded on
 * one structure, in meV/atom — or null when fewer than two did. "No
 * comparison" is not "perfect agreement": the leaderboard used to show 0.0
 * for a row where one model errored (D97).
 */
export function energySpread(row: BenchmarkStructureResult): number | null {
  const energies = row.models
    .filter((m) => m.status === "success" && m.energyPerAtom != null)
    .map((m) => m.energyPerAtom!);
  if (energies.length < 2) return null;
  return (Math.max(...energies) - Math.min(...energies)) * 1000;
}

export function formatSpread(spread: number | null): string {
  return spread === null ? "—" : `${spread.toFixed(1)} meV/atom`;
}

/** Mean spread over the structures that could be compared; null when none could. */
export function meanSpread(rows: BenchmarkStructureResult[]): number | null {
  const spreads = rows.map(energySpread).filter((s): s is number => s !== null);
  return spreads.length > 0 ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null;
}
