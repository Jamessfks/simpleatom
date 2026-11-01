import { findModel } from "@/lib/contract";

/**
 * Where MACE stands on the Matbench Discovery leaderboard. Ranks move, so they
 * are kept in one record with the date they were read; the scores come from the
 * model registry (mace-api/contract.json), the same numbers the calculator shows.
 */
export const MATBENCH = {
  retrieved: "2026-10-28",
  total: 43,
  ranks: { "MACE-MPA-0": 22, "MACE-MP-0": 36 },
} as const;

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
}

function standing(id: keyof typeof MATBENCH.ranks): string {
  const model = findModel(id);
  const score = model?.benchmark
    ? ` (F1 ${model.benchmark.f1}, MAE ${model.benchmark.maeEvPerAtom} eV/atom)`
    : "";
  return `${id} ranks ${ordinal(MATBENCH.ranks[id])} of ${MATBENCH.total}${score}`;
}

/** The card text for a bar: Matbench Discovery's is built from the record above. */
export function barText(bar: { name: string; fetchable: string }): string {
  if (bar.name !== "Matbench Discovery") return bar.fetchable;
  return (
    `Fully public leaderboard. ${standing("MACE-MPA-0")}, SimpleAtom's default; ` +
    `${standing("MACE-MP-0")}. (Matbench Discovery, retrieved ${MATBENCH.retrieved}.)`
  );
}
