import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, runCalculationJob, type JobView } from "@/lib/api-client";

const job = (status: JobView["status"], extra: Partial<JobView> = {}): JobView => ({
  jobId: "job-1",
  status,
  progress: {},
  queuePosition: null,
  ...extra,
});
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Call = { url: string; method: string };

/** A fetch stub that records calls and answers GET /api/jobs/:id from a script. */
function stubJobs(polls: Array<() => Response | Promise<Response>>, submit?: () => Promise<Response>) {
  const calls: Call[] = [];
  let poll = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (method === "POST") return submit ? submit() : reply(job("queued"));
      if (method === "DELETE") return reply({});
      const next = polls[Math.min(poll++, polls.length - 1)];
      return next();
    }),
  );
  return calls;
}

const form = () => new FormData();

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// D65: leaving the page, one dropped poll, or Cancel during submit used to
// strand a job on the shared CPU.
describe("run lifecycle (D65)", () => {
  it("retries a dropped poll instead of abandoning the job", async () => {
    stubJobs([
      () => {
        throw new TypeError("network down");
      },
      () => reply({ error: { code: "bad_gateway", message: "upstream" } }, 502),
      () => reply(job("succeeded", { result: { status: "success", energy: -1 } })),
    ]);
    const run = runCalculationJob(form());
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(run).resolves.toMatchObject({ energy: -1 });
  });

  it("cancels the job, and names it, when polling keeps failing", async () => {
    const calls = stubJobs([
      () => {
        throw new TypeError("network down");
      },
    ]);
    const run = runCalculationJob(form()).catch((e) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    const err = await run;
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.message).toContain("job-1");
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/job-1"))).toBe(true);
  });

  it("does not retry an answer that will not change", async () => {
    const calls = stubJobs([() => reply({ error: { code: "not_found", message: "No such job." } }, 404)]);
    const run = runCalculationJob(form()).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await run).message).toContain("No such job.");
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });

  it("cancels a job whose submit was still in flight when Cancel was pressed", async () => {
    let finishSubmit!: (r: Response) => void;
    const calls = stubJobs(
      [() => reply(job("running"))],
      () => new Promise<Response>((resolve) => (finishSubmit = resolve)),
    );
    const abort = new AbortController();
    const run = runCalculationJob(form(), { signal: abort.signal }).catch((e) => e);
    abort.abort();
    finishSubmit(reply(job("queued")));
    const err = await run;
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe("cancelled");
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/jobs/job-1"]);
    expect(calls.some((c) => c.method === "GET")).toBe(false);
  });

  it("sends the cancel as soon as the signal aborts, not after the next poll", async () => {
    const calls = stubJobs([() => reply(job("running"))]);
    const abort = new AbortController();
    const run = runCalculationJob(form(), { signal: abort.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    abort.abort();
    // Synchronously after abort(): this is what lets a page being closed cancel.
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/job-1"))).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    await run;
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });

  it("does not wait out a poll interval on an already-aborted signal", async () => {
    stubJobs([() => reply(job("running"))]);
    const abort = new AbortController();
    const run = runCalculationJob(form(), { signal: abort.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    // Less than the first 700 ms interval: the sleep must reject at once.
    await vi.advanceTimersByTimeAsync(50);
    const err = await Promise.race([run, Promise.resolve("still waiting")]);
    expect(err).not.toBe("still waiting");
  });
});
