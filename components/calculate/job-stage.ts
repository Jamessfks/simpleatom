/**
 * The stages a job reports, and what a screen reader is told about them.
 *
 * The progress bar used to be a guess from elapsed time; every value shown now
 * comes from the backend: its phase, and the BFGS or MD step (docs/adr/0023).
 */

import type { JobView } from "@/lib/api-client";
import type { RunOutcome } from "./run-outcome";
import type { CalculationResult } from "@/types/mace";

export const STAGES: { key: string; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "reading-structure", label: "Reading structure" },
  { key: "loading-model", label: "Loading model" },
  { key: "computing", label: "Computing" },
];

export function stageIndex(job: JobView | null): number {
  if (!job || job.status === "queued") return 0;
  const phase = job.progress.phase;
  if (phase === "reading-structure") return 1;
  if (phase === "loading-model") return 2;
  return 3;
}

export function stepSummary(job: JobView | null): string | null {
  const p = job?.progress;
  if (!p || p.step == null) return null;
  if (p.phase === "geometry-opt") {
    const fmax = typeof p.fmax === "number" ? ` · max force ${p.fmax.toFixed(3)} eV/Å` : "";
    return `BFGS step ${p.step} of at most ${p.totalSteps}${fmax}`;
  }
  if (p.phase === "molecular-dynamics") {
    const t = typeof p.temperature === "number" ? ` · ${p.temperature.toFixed(0)} K` : "";
    return `MD step ${p.step} of ${p.totalSteps}${t}`;
  }
  return `Step ${p.step}${p.totalSteps ? ` of ${p.totalSteps}` : ""}`;
}

/**
 * What the polite live region says while a job runs. It names the stage and
 * nothing that ticks (elapsed seconds, step counts), so it changes, and is
 * read, only when the stage does.
 */
export function stageAnnouncement(job: JobView | null): string {
  const stage = STAGES[stageIndex(job)];
  if (stage.key === "queued" && job?.queuePosition) {
    return `${stage.label}, position ${job.queuePosition + 1}`;
  }
  return stage.label;
}

/** One sentence for the end of a run: how it ended, and its energy. */
export function completionAnnouncement(outcome: RunOutcome, result: CalculationResult): string {
  const energy = typeof result.energy === "number" ? ` Energy ${result.energy.toFixed(4)} eV.` : "";
  const detail = outcome.detail ? ` ${outcome.detail}` : "";
  return `${outcome.headline}.${detail}${energy}`;
}
