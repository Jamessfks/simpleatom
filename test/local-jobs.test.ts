import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("local job runner (D95)", () => {
  it("fails a job whose Python cannot be started, instead of leaving it running and blocking the queue", async () => {
    vi.stubEnv("SIMPLEATOM_PYTHON", "/nonexistent/simpleatom/python");
    const { submitLocalJob, getLocalJob } = await import("@/lib/server/local-jobs");
    const job = submitLocalJob(["structure.xyz", "{}"], mkdtempSync(join(tmpdir(), "sa-job-")), "local");
    for (let i = 0; i < 50 && getLocalJob(job.id)?.status !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 40));
    }
    const done = getLocalJob(job.id);
    expect(done?.status).toBe("failed");
    expect(done?.error?.code).toBe("python_unavailable");
    expect(done?.error?.message).toMatch(/SIMPLEATOM_PYTHON/);
  });
});
