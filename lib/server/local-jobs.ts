/**
 * Local-mode job queue: the same submit / poll / cancel contract as the hosted
 * backend's /v1/jobs (mace-api/jobs.py), for `npm run dev` with no
 * MACE_API_URL. Each job is one `python3 mace-api/calculate_local.py
 * --progress` child; progress arrives as `@@progress {json}` lines on stderr
 * and the result as the single JSON document on stdout.
 *
 * One child at a time, for the same reason the hosted backend has one worker:
 * a second MACE process competes for the same cores and halves both. Jobs
 * live on globalThis so they survive dev-server hot reloads, and expire 15
 * minutes after finishing.
 */

import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { ApiError, pythonExecutable } from "@/lib/server/backend";
import type { ProfileName } from "@/lib/contract";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

interface LocalJob {
  id: string;
  status: JobStatus;
  progress: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; field: string | null; status: number };
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  args: string[];
  dir: string;
  profile: ProfileName;
  child?: ChildProcess;
  cancelRequested: boolean;
}

interface Store {
  jobs: Map<string, LocalJob>;
  order: string[];
}

const TTL_MS = 15 * 60 * 1000;
const MAX_QUEUED = 6;
const MAX_STDOUT = 64 * 1024 * 1024;
const TERMINAL: JobStatus[] = ["succeeded", "failed", "cancelled"];

const globalStore = globalThis as unknown as { __simpleatomLocalJobs?: Store };
const store: Store = (globalStore.__simpleatomLocalJobs ??= { jobs: new Map(), order: [] });

async function removeDir(dir: string) {
  const { rm } = await import("node:fs/promises");
  await rm(dir, { recursive: true, force: true });
}

function finish(job: LocalJob, status: JobStatus) {
  job.status = status;
  job.finishedAt = Date.now();
  job.child = undefined;
  void removeDir(job.dir);
}

function reap() {
  const now = Date.now();
  for (const id of [...store.order]) {
    const job = store.jobs.get(id);
    if (!job || (job.finishedAt && now - job.finishedAt > TTL_MS)) {
      store.jobs.delete(id);
      store.order.splice(store.order.indexOf(id), 1);
    }
  }
}

async function start(job: LocalJob) {
  const { spawn } = await import("node:child_process");
  const { join } = await import("node:path");

  job.status = "running";
  job.startedAt = Date.now();
  const child = spawn(pythonExecutable(), [join(process.cwd(), "mace-api", "calculate_local.py"), ...job.args, "--progress"], {
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      KMP_DUPLICATE_LIB_OK: "TRUE",
      SIMPLEATOM_PROFILE: job.profile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.child = child;

  let stdout = "";
  let stderrTail = "";
  let pending = "";
  child.stdout.on("data", (chunk: Buffer) => {
    if (stdout.length < MAX_STDOUT) stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("@@progress ")) {
        try {
          job.progress = JSON.parse(line.slice("@@progress ".length));
        } catch {
          // a malformed progress line is not worth failing a calculation over
        }
      } else if (line.trim()) {
        stderrTail = line;
      }
    }
  });

  child.on("close", () => {
    if (job.cancelRequested) {
      finish(job, "cancelled");
    } else {
      const startIdx = stdout.indexOf("{");
      let body: Record<string, unknown> | null = null;
      try {
        body = startIdx === -1 ? null : JSON.parse(stdout.slice(startIdx));
      } catch {
        body = null;
      }
      if (body && body.status !== "error") {
        job.result = body;
        finish(job, "succeeded");
      } else {
        const err = (body?.error ?? {}) as Partial<NonNullable<LocalJob["error"]>>;
        job.error = {
          code: err.code ?? "calculation_failed",
          message: err.message ?? (body?.message as string | undefined) ?? (stderrTail || "The Python backend exited without a result."),
          field: err.field ?? null,
          status: err.status ?? 500,
        };
        finish(job, "failed");
      }
    }
    void pump();
  });
}

async function pump() {
  if ([...store.jobs.values()].some((j) => j.status === "running")) return;
  const next = store.order.map((id) => store.jobs.get(id)).find((j) => j?.status === "queued");
  if (next) await start(next);
}

/** Queue a calculation whose inputs are already staged in `dir`. */
export function submitLocalJob(args: string[], dir: string, profile: ProfileName): LocalJob {
  reap();
  const queued = [...store.jobs.values()].filter((j) => j.status === "queued").length;
  if (queued >= MAX_QUEUED) {
    void removeDir(dir);
    throw new ApiError("The local calculation queue is full. Wait for a run to finish.", 429, "busy");
  }
  const job: LocalJob = {
    id: randomBytes(16).toString("base64url"),
    status: "queued",
    progress: {},
    createdAt: Date.now(),
    args,
    dir,
    profile,
    cancelRequested: false,
  };
  store.jobs.set(job.id, job);
  store.order.push(job.id);
  void pump();
  return job;
}

export function getLocalJob(id: string): LocalJob | undefined {
  reap();
  return store.jobs.get(id);
}

/** Idempotent. A queued job is dropped; a running child gets SIGTERM, then SIGKILL. */
export function cancelLocalJob(id: string): LocalJob | undefined {
  const job = store.jobs.get(id);
  if (!job || TERMINAL.includes(job.status)) return job;
  job.cancelRequested = true;
  if (job.status === "queued") {
    finish(job, "cancelled");
  } else if (job.child) {
    const child = job.child;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 5000).unref();
  }
  return job;
}

/** Public view: same shape as the hosted backend's describe(). */
export function describeLocalJob(job: LocalJob) {
  const ahead = store.order
    .map((id) => store.jobs.get(id))
    .filter((j): j is LocalJob => !!j && (j.status === "queued" || j.status === "running"));
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    queuePosition: job.status === "queued" ? ahead.indexOf(job) : null,
    createdAt: job.createdAt / 1000,
    startedAt: job.startedAt ? job.startedAt / 1000 : null,
    finishedAt: job.finishedAt ? job.finishedAt / 1000 : null,
    ...(job.status === "succeeded" ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}
