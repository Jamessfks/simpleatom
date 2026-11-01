import { describe, expect, it } from "vitest";
import {
  STAGES,
  completionAnnouncement,
  stageAnnouncement,
  stageIndex,
  stepSummary,
} from "@/components/calculate/job-stage";
import { runOutcome } from "@/components/calculate/run-outcome";
import type { JobView } from "@/lib/api-client";
import type { CalculationResult } from "@/types/mace";

const job = (extra: Partial<JobView>): JobView => ({
  jobId: "j1",
  status: "running",
  progress: {},
  queuePosition: null,
  ...extra,
});

// D61: the progress area used to be one polite live region that also held a
// ticking "Elapsed n s". Screen readers now hear a short sentence only when the
// stage changes, and one sentence when the run ends (the status pill that used
// to carry that is hidden below 640 px).
describe("job stage announcements (D61)", () => {
  it("names the stage, and the queue position while waiting", () => {
    expect(stageAnnouncement(null)).toBe("Queued");
    expect(stageAnnouncement(job({ status: "queued", queuePosition: 2 }))).toBe("Queued, position 3");
    expect(stageAnnouncement(job({ progress: { phase: "reading-structure" } }))).toBe("Reading structure");
    expect(stageAnnouncement(job({ progress: { phase: "loading-model" } }))).toBe("Loading model");
  });

  it("does not change while steps or elapsed time tick", () => {
    const a = stageAnnouncement(job({ progress: { phase: "geometry-opt", step: 3, totalSteps: 500, fmax: 0.4 } }));
    const b = stageAnnouncement(job({ progress: { phase: "geometry-opt", step: 4, totalSteps: 500, fmax: 0.39 } }));
    expect(a).toBe("Computing");
    expect(b).toBe(a);
  });

  it("announces how a run ended, with its energy", () => {
    const ok = { status: "success", energy: -1.23456 } as CalculationResult;
    expect(completionAnnouncement(runOutcome(ok), ok)).toBe("Calculation complete. Energy -1.2346 eV.");

    const stopped = {
      status: "success",
      energy: -2,
      stoppedEarly: { reason: "time-budget", atStep: 10, budgetSeconds: 60 },
      params: { calculationType: "molecular-dynamics", mdSteps: 100 },
    } as CalculationResult;
    const text = completionAnnouncement(runOutcome(stopped), stopped);
    expect(text).toMatch(/^Stopped at the time budget\./);
    expect(text).toMatch(/step 10 of 100/);
  });

  it("keeps the stage list and the step summary the page relied on", () => {
    expect(STAGES.map((s) => s.key)).toContain("computing");
    expect(stageIndex(job({ progress: { phase: "geometry-opt" } }))).toBe(STAGES.length - 1);
    expect(stepSummary(job({ progress: { phase: "geometry-opt", step: 3, totalSteps: 500, fmax: 0.1234 } }))).toBe(
      "BFGS step 3 of at most 500 · max force 0.123 eV/Å",
    );
  });
});
