import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// D143: the browser learns a job's id only from the POST's answer. If the tab
// closes while the POST is in flight, nobody can cancel that job, so it ran to
// completion on the single hosted worker. The route now cancels a job whose
// caller left before the answer was sent.
const controller = { current: new AbortController() };
const cancelJob = vi.fn(async () => ({ status: 200, body: {} }));

vi.mock("@/lib/server/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/jobs")>()),
  submitJob: vi.fn(async () => {
    controller.current.abort(); // the tab closes while the job is being created
    return { status: 202, body: { jobId: "job-left-behind", status: "queued" } };
  }),
  cancelJob,
}));

function request(signal: AbortSignal): NextRequest {
  const form = new FormData();
  form.append("files", new File(["3\n\nO 0 0 0\nH 0.96 0 0\nH -0.24 0.93 0\n"], "water.xyz"));
  form.append("params", JSON.stringify({ calculationType: "single-point" }));
  return new NextRequest("http://localhost:3000/api/jobs", { method: "POST", body: form, signal });
}

describe("a submit whose caller has gone (D143)", () => {
  beforeEach(() => {
    controller.current = new AbortController();
    cancelJob.mockClear();
  });

  it("cancels the job it just created", async () => {
    const { POST } = await import("@/app/api/jobs/route");
    await POST(request(controller.current.signal));
    expect(cancelJob).toHaveBeenCalledWith("job-left-behind");
  });
});
