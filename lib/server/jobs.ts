/**
 * Job operations in whichever mode this server is in (docs/adr/0023).
 *
 * Remote: a thin proxy to the hosted backend's /v1/jobs — job state lives in
 * the backend's single container, so any Vercel instance can answer a poll.
 * Local: lib/server/local-jobs.ts, an in-process queue around the Python CLI.
 * Both return the same JSON shape, so the browser never knows which it got.
 */

import type { NextRequest } from "next/server";
import { profile, type ProfileName } from "@/lib/contract";
import {
  ApiError,
  MACE_API_URL,
  backendHeaders,
  checkUploadSize,
  displayName,
  structureSuffix,
  type StructureInput,
} from "@/lib/server/backend";
import { cancelLocalJob, describeLocalJob, getLocalJob, submitLocalJob } from "@/lib/server/local-jobs";

/** Job ids are url-safe random tokens; anything else is not ours to forward. */
const JOB_ID = /^[A-Za-z0-9_-]{16,64}$/;

export function assertJobId(id: string): void {
  if (!JOB_ID.test(id)) throw new ApiError("No such job.", 404, "job_not_found");
}

/** The visitor's IP as Vercel reports it, forwarded so per-visitor limits work. */
export function clientIp(request: NextRequest): string | null {
  const xff = request.headers.get("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
}


async function readJson(response: Response): Promise<{ status: number; body: unknown }> {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    throw new ApiError(
      response.status === 503
        ? "The MACE backend is starting up. Try again in a minute."
        : `The MACE backend returned HTTP ${response.status} without a JSON body.`,
      502,
      "backend_error",
    );
  }
}

async function remote(path: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  try {
    return await readJson(await fetch(`${MACE_API_URL}${path}`, { ...init, signal: AbortSignal.timeout(25_000) }));
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("The MACE backend could not be reached. It may be starting up; try again shortly.", 502, "backend_unreachable");
  }
}

export async function submitJob(
  structure: StructureInput,
  params: Record<string, unknown>,
  options: { profile: ProfileName; model?: StructureInput | null; ip: string | null },
): Promise<{ status: number; body: unknown }> {
  const caps = profile(options.profile);
  const suffix = structureSuffix(structure.name);
  checkUploadSize(structure.data, structure.name, caps.maxUploadBytes);
  if (options.model) checkUploadSize(options.model.data, options.model.name, caps.maxModelUploadBytes, "model");

  if (MACE_API_URL) {
    const form = new FormData();
    form.append("files", structure.data, displayName(structure.name));
    form.append("params", JSON.stringify(params));
    if (options.model) form.append("model", options.model.data, displayName(options.model.name, "custom.model"));
    return remote("/v1/jobs", { method: "POST", body: form, headers: backendHeaders(options.ip) });
  }

  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const os = await import("node:os");
  const dir = await mkdtemp(join(os.tmpdir(), "mace-"));
  try {
    const structurePath = join(dir, `structure${suffix}`);
    await writeFile(structurePath, Buffer.from(await structure.data.arrayBuffer()));
    const args = [structurePath, JSON.stringify(params), "--display-name", displayName(structure.name)];
    if (options.model) {
      const modelPath = join(dir, "custom.model");
      await writeFile(modelPath, Buffer.from(await options.model.data.arrayBuffer()));
      args.push("--model-path", modelPath);
    }
    const job = submitLocalJob(args, dir, options.profile);
    return { status: 202, body: describeLocalJob(job) };
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}

function notFound(): never {
  throw new ApiError(
    "No such job. It may have expired (results are kept for 15 minutes) or the server restarted; submit the calculation again.",
    404,
    "job_not_found",
  );
}

export async function getJob(id: string): Promise<{ status: number; body: unknown }> {
  assertJobId(id);
  if (MACE_API_URL) return remote(`/v1/jobs/${id}`, { headers: backendHeaders(), cache: "no-store" });
  const job = getLocalJob(id);
  return job ? { status: 200, body: describeLocalJob(job) } : notFound();
}

export async function cancelJob(id: string): Promise<{ status: number; body: unknown }> {
  assertJobId(id);
  if (MACE_API_URL) return remote(`/v1/jobs/${id}`, { method: "DELETE", headers: backendHeaders() });
  const job = cancelLocalJob(id);
  return job ? { status: 200, body: describeLocalJob(job) } : notFound();
}
