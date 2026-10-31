/**
 * Browser client for SimpleAtom's API routes.
 *
 * One error type for every call. The calculator, benchmark, SMILES box and
 * molecule editor each used to parse failures their own way, and one of them
 * printed the raw JSON envelope at the user. Every route now answers errors as
 * `{status:"error", message, error:{code, message, field}}` (lib/server/backend.ts).
 */

import type { CalculationResult } from "@/types/mace";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = "request_failed",
    readonly field: string | null = null,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Turn a failed response into an ApiRequestError with a readable message. */
export async function readError(response: Response, fallback = "Request failed"): Promise<ApiRequestError> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text);
    const err = body?.error;
    if (err && typeof err === "object") {
      return new ApiRequestError(err.message || body.message || fallback, response.status, err.code, err.field ?? null);
    }
    return new ApiRequestError(body?.message || (typeof err === "string" ? err : fallback), response.status);
  } catch {
    // A platform error page (e.g. Vercel's 413 for a body over 4.5 MB).
    if (response.status === 413) {
      return new ApiRequestError("The upload is too large for this deployment.", 413, "upload_too_large");
    }
    return new ApiRequestError(`${fallback} (HTTP ${response.status}).`, response.status);
  }
}

/** POST JSON and parse the JSON answer, raising ApiRequestError on failure. */
export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw await readError(response);
  return response.json() as Promise<T>;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** Real progress from the backend: the phase, and the BFGS / MD step when there is one. */
export interface JobProgress {
  phase?: "reading-structure" | "loading-model" | "computing" | "geometry-opt" | "molecular-dynamics" | string;
  step?: number | null;
  totalSteps?: number | null;
  energy?: number;
  fmax?: number;
  temperature?: number;
}

export interface JobView {
  jobId: string;
  status: JobStatus;
  progress: JobProgress;
  queuePosition: number | null;
  result?: CalculationResult;
  error?: { code: string; message: string; field: string | null; status: number };
}

export async function submitJob(form: FormData, signal?: AbortSignal): Promise<JobView> {
  const response = await fetch("/api/jobs", { method: "POST", body: form, signal });
  if (!response.ok) throw await readError(response, "Could not start the calculation");
  return response.json();
}

export async function getJob(jobId: string, signal?: AbortSignal): Promise<JobView> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store", signal });
  if (!response.ok) throw await readError(response, "Lost track of the calculation");
  return response.json();
}

export async function cancelJob(jobId: string): Promise<void> {
  await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => undefined);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Submit a calculation and wait for its result, reporting real progress.
 *
 * Aborting `signal` cancels the job on the server too — closing the panel or
 * pressing Cancel stops the computation instead of leaving it running.
 */
export async function runCalculationJob(
  form: FormData,
  options: { signal?: AbortSignal; onUpdate?: (job: JobView) => void } = {},
): Promise<CalculationResult> {
  const { signal, onUpdate } = options;
  let job = await submitJob(form, signal);
  onUpdate?.(job);
  const started = Date.now();
  try {
    while (job.status === "queued" || job.status === "running") {
      // Poll quickly while a short job is likely to finish, then back off.
      const elapsed = Date.now() - started;
      await sleep(elapsed < 10_000 ? 700 : elapsed < 60_000 ? 1500 : 3000, signal);
      job = await getJob(job.jobId, signal);
      onUpdate?.(job);
    }
  } catch (err) {
    if (signal?.aborted) void cancelJob(job.jobId);
    throw err;
  }
  if (job.status === "succeeded" && job.result) return job.result;
  if (job.status === "cancelled") throw new ApiRequestError("The calculation was cancelled.", 499, "cancelled");
  const err = job.error;
  throw new ApiRequestError(err?.message ?? "The calculation failed.", err?.status ?? 500, err?.code, err?.field ?? null);
}
