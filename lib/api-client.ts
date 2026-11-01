/**
 * Browser client for SimpleAtom's API routes.
 *
 * One error type for every call. The calculator, benchmark, SMILES box and
 * molecule editor each used to parse failures their own way, and one of them
 * printed the raw JSON envelope at the user. Every route now answers errors as
 * `{status:"error", message, error:{code, message, field}}` (lib/server/backend.ts).
 */

import type { CalculationResult, SmilesToXyzResponse } from "@/types/mace";

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

/** Make a SMILES string safe to put in a file name. */
function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-()[\]=#+.@]/g, "_").slice(0, 60);
}

/** Files made by smilesToFile(). Marked by identity, never guessed from a name. */
const smilesFiles = new WeakSet<File>();

/** True only for a file smilesToFile() produced, whatever a user names theirs. */
export function isSmilesGenerated(file: File): boolean {
  return smilesFiles.has(file);
}

/**
 * Convert a SMILES string to a 3D structure through /api/smiles-to-xyz.
 *
 * The SMILES box and the molecule editor both end here, so a rejected string
 * reads the same in both: the server's own message, never the raw envelope.
 */
export async function smilesToFile(smiles: string, signal?: AbortSignal): Promise<File> {
  const trimmed = smiles.trim();
  // Untrusted JSON: every field optional, checked before use.
  const data = await postJson<Partial<SmilesToXyzResponse> & { status?: string; message?: string }>(
    "/api/smiles-to-xyz",
    { smiles: trimmed },
    signal,
  );
  if (data.status === "error" || typeof data.xyz !== "string") {
    throw new ApiRequestError(data.message || "Conversion failed", 502, "conversion_failed");
  }
  const file = new File([data.xyz], `smiles_${sanitizeFilename(data.smiles_canonical || trimmed)}.xyz`, {
    type: "text/plain",
  });
  smilesFiles.add(file);
  return file;
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
  // keepalive lets the request outlive a page that is being closed or left.
  await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", keepalive: true }).catch(
    () => undefined,
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Failed polls tolerated in a row before the job is given up on. */
const POLL_RETRIES = 3;

/** A poll that failed for a reason a later attempt can fix: network, 5xx, 429. */
function isTransient(err: unknown): boolean {
  if (err instanceof ApiRequestError) return err.status >= 500 || err.status === 429;
  return err instanceof TypeError;
}

/**
 * Submit a calculation and wait for its result, reporting real progress.
 *
 * Aborting `signal` cancels the job on the server too, at once: the DELETE is
 * sent from the abort event itself, so pressing Cancel, leaving the page or
 * closing the tab stops the computation instead of leaving it running. A poll
 * that fails for a transient reason is retried; when retries run out the job
 * is cancelled and the error names it.
 */
export async function runCalculationJob(
  form: FormData,
  options: { signal?: AbortSignal; onUpdate?: (job: JobView) => void } = {},
): Promise<CalculationResult> {
  const { signal, onUpdate } = options;
  // The submit is deliberately not tied to `signal`. The server may create the
  // job before the answer reaches us, and an aborted fetch would leave us
  // without the id we need to cancel it. A Cancel pressed meanwhile is carried
  // out as soon as the id arrives.
  let job = await submitJob(form);
  const cancelNow = () => void cancelJob(job.jobId);
  if (signal?.aborted) {
    cancelNow();
    throw new ApiRequestError("The calculation was cancelled.", 499, "cancelled");
  }
  signal?.addEventListener("abort", cancelNow, { once: true });
  onUpdate?.(job);
  const started = Date.now();
  let failures = 0;
  try {
    while (job.status === "queued" || job.status === "running") {
      // Poll quickly while a short job is likely to finish, then back off; wait
      // longer still after a failed poll.
      const elapsed = Date.now() - started;
      const interval = elapsed < 10_000 ? 700 : elapsed < 60_000 ? 1500 : 3000;
      await sleep(interval + failures * 1000, signal);
      try {
        job = await getJob(job.jobId, signal);
        failures = 0;
      } catch (err) {
        if (signal?.aborted || !isTransient(err) || ++failures > POLL_RETRIES) throw err;
        continue;
      }
      onUpdate?.(job);
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    cancelNow();
    const reason = err instanceof Error ? err.message : "Lost track of the calculation";
    throw new ApiRequestError(
      `${reason} A cancel request was sent for job ${job.jobId} so it does not keep using the server.`,
      err instanceof ApiRequestError ? err.status : 502,
      err instanceof ApiRequestError ? err.code : "poll_failed",
    );
  } finally {
    signal?.removeEventListener("abort", cancelNow);
  }
  if (job.status === "succeeded" && job.result) return job.result;
  if (job.status === "cancelled") throw new ApiRequestError("The calculation was cancelled.", 499, "cancelled");
  const err = job.error;
  throw new ApiRequestError(err?.message ?? "The calculation failed.", err?.status ?? 500, err?.code, err?.field ?? null);
}
