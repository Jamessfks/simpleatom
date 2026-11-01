/**
 * Server-side access to the MACE backend, shared by every API route.
 *
 * Two modes (docs/adr/0001): with MACE_API_URL set, requests are forwarded to
 * the hosted FastAPI backend; without it, Python runs on this machine via
 * mace-api/calculate_local.py. Both report refusals with the same envelope,
 * `{status:"error", message, error:{code, message, field}}`, and this module
 * passes their HTTP status through instead of turning every failure into 500.
 *
 * Uploads are written to disk under names chosen here, never under the
 * client's filename: a multipart filename like `../../x` used to be joined
 * straight into the temp path, which wrote outside the temp directory.
 */

import { NextResponse } from "next/server";
import {
  CONTRACT,
  type DeviceReport,
  deviceReportFrom,
  type ProfileName,
  profile,
  profileDeviceReport,
} from "@/lib/contract";

/** The hosted backend's base URL, or undefined in local mode. */
export const MACE_API_URL: string | undefined = (() => {
  const url = process.env.MACE_API_URL?.trim().replace(/\/+$/, "");
  if (!url) return undefined;
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
})();

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly code = "server_error",
    readonly field: string | null = null,
  ) {
    super(message);
  }
}

/** One error shape for every route. */
export function errorResponse(error: unknown): NextResponse {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(error instanceof Error ? error.message : "Request failed");
  if (apiError.status >= 500) console.error("[api]", apiError.message);
  return NextResponse.json(
    {
      status: "error",
      message: apiError.message,
      error: { code: apiError.code, message: apiError.message, field: apiError.field },
    },
    { status: apiError.status },
  );
}

type WithHeaders = { headers: Headers };

function requestHost(request: WithHeaders): string | null {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host");
}

/**
 * Refuse a POST that another site's page sent (D40). A browser always attaches
 * Origin to a cross-origin POST, and a multipart form is a "simple" request, so
 * without this check any page the developer visits could start work on their
 * local server — including unpickling an uploaded checkpoint. A request with
 * no Origin is not a browser page and passes; LAN reach is closed separately
 * by binding the dev server to loopback.
 */
export function assertSameOrigin(request: WithHeaders): void {
  const origin = request.headers.get("origin");
  if (origin === null) return;
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // "null" (sandboxed iframes, file://) and malformed values are not this site.
  }
  if (!originHost || originHost !== requestHost(request)) {
    throw new ApiError("Cross-origin requests are not accepted.", 403, "cross_origin");
  }
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOOPBACK_ADDRESS = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;

/**
 * Accept a checkpoint upload in local mode only when the page was loaded from
 * a loopback name. A DNS-rebinding page is same-origin with itself, so its
 * Origin check passes; only its host name gives it away.
 *
 * Headers vouch for nothing here (D94). The Host header is read directly, never
 * X-Forwarded-Host, which a client sets freely when no proxy is in front; a
 * forwarded host that is not loopback is refused. Next fills X-Forwarded-For
 * from the socket when the client sent none, so a LAN peer appears there and
 * is refused too. A client can still preset both, so binding the server to
 * 127.0.0.1 (npm run dev / start) remains the boundary; route handlers expose
 * no socket address to check instead.
 */
export function assertLoopbackHost(request: WithHeaders): void {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const clients = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const loopback =
    LOOPBACK_HOST.test(request.headers.get("host") ?? "") &&
    (forwardedHost === null || LOOPBACK_HOST.test(forwardedHost)) &&
    clients.every((ip) => LOOPBACK_ADDRESS.test(ip));
  if (!loopback) {
    throw new ApiError(
      "Custom checkpoints are accepted only from this machine (open SimpleAtom at localhost).",
      403,
      "custom_models_local_only",
      "model",
    );
  }
}

/** Read the backend's error envelope (FastAPI or CLI) into an ApiError. */
function apiErrorFrom(body: unknown, fallbackStatus: number): ApiError {
  const b = (body ?? {}) as {
    message?: string;
    error?: { code?: string; message?: string; field?: string | null; status?: number } | string;
    detail?: unknown;
  };
  if (b.error && typeof b.error === "object") {
    return new ApiError(
      b.error.message || b.message || "The backend refused the request",
      b.error.status ?? fallbackStatus,
      b.error.code || "backend_error",
      b.error.field ?? null,
    );
  }
  const message =
    b.message ||
    (typeof b.error === "string" ? b.error : undefined) ||
    (typeof b.detail === "string" ? b.detail : undefined) ||
    "The backend returned an error";
  return new ApiError(message, fallbackStatus, "backend_error");
}

/** Bare, printable basename for display (messages, manifest). Never a path. */
export function displayName(name: string | undefined | null, fallback = "structure"): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  // The same set Python's str.isprintable() keeps (calculate._display_name):
  // letters, marks, numbers, punctuation, symbols and the ASCII space. Format
  // controls such as U+202E used to survive, so a MACE Link name could display
  // reversed (D100).
  const printable = Array.from(base).filter((ch) => PRINTABLE.test(ch)).join("").trim();
  return printable.slice(0, 120) || fallback;
}

const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]$/u;

/** Benchmark ids for uploaded files: `user-<stem>`, made distinct when stems collide (D99). */
export function uniqueUploadIds(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = `user-${displayName(name).replace(/\.[^.]+$/, "")}`;
    // Count up past every id already given, so "a-2.xyz" after a second "a" stays distinct.
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  });
}

/**
 * Refuse a set of uploads whose total exceeds `cap` (D96): the hosted profile's
 * per-file caps allowed 10 MB of benchmark uploads, past Vercel's 4.5 MB
 * request-body limit, which answers with an HTML 413 the page cannot parse.
 */
export function checkUploadTotal(files: Blob[], cap: number): void {
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > cap) {
    throw new ApiError(
      `These uploads total ${(total / 1e6).toFixed(1)} MB; this deployment accepts at most ` +
        `${(cap / 1e6).toFixed(1)} MB per benchmark. Upload fewer or smaller files.`,
      413,
      "too_large",
      "structures",
    );
  }
}

/**
 * The format suffix an upload is stored under, from the contract's allow-list.
 * Bare `POSCAR`/`CONTCAR` (VASP's own convention) map to `.poscar`/`.contcar`.
 */
export function structureSuffix(name: string): string {
  const base = displayName(name);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : "";
  if ((CONTRACT.structureExtensions as readonly string[]).includes(ext)) return ext;
  const bare = (CONTRACT.bareStructureNames as Record<string, string>)[base.toUpperCase()];
  if (bare) return bare;
  throw new ApiError(
    `Unsupported structure file '${base}'. Supported: ${CONTRACT.structureExtensions.join(", ")} (or a bare POSCAR/CONTCAR).`,
    400,
    "unsupported_format",
    "files",
  );
}

export function checkUploadSize(file: Blob, name: string, limit: number, field = "files"): void {
  if (file.size > limit) {
    throw new ApiError(
      `'${displayName(name)}' is ${(file.size / 1e6).toFixed(1)} MB; this deployment accepts at most ${(limit / 1e6).toFixed(1)} MB.`,
      413,
      "upload_too_large",
      field,
    );
  }
}

/**
 * Headers for a request to the hosted backend: the proxy key, and the visitor's
 * IP so the backend's per-visitor limits see visitors rather than this server
 * (D41: the synchronous path once sent no IP, so every visitor shared a slot).
 * The backend trusts the IP only when the proxy key authenticated it (D43).
 */
export function backendHeaders(ip: string | null = null): Record<string, string> {
  const token = process.env.MACE_API_TOKEN;
  return {
    ...(token ? { "X-SimpleAtom-Proxy-Key": token } : {}),
    ...(ip ? { "X-SimpleAtom-Client-IP": ip } : {}),
  };
}

export interface StructureInput {
  data: Blob;
  /** The client's filename — used only for display and the format suffix. */
  name: string;
}

export interface CalculateOptions {
  profile: ProfileName;
  model?: StructureInput | null;
  signal?: AbortSignal;
  /** Wall-clock limit for this request, in milliseconds. */
  timeoutMs: number;
  /** The visitor's IP, forwarded to the hosted backend for its per-visitor limits. */
  ip?: string | null;
}

/** Run one calculation in whichever mode this server is in. */
export async function calculate(
  structure: StructureInput,
  params: Record<string, unknown>,
  options: CalculateOptions,
): Promise<Record<string, unknown>> {
  const caps = profile(options.profile);
  structureSuffix(structure.name); // refuse unsupported formats before any work
  checkUploadSize(structure.data, structure.name, caps.maxUploadBytes);
  if (options.model) checkUploadSize(options.model.data, options.model.name, caps.maxModelUploadBytes, "model");
  return MACE_API_URL
    ? calculateRemote(structure, params, options)
    : calculateLocal(structure, params, options);
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function calculateRemote(
  structure: StructureInput,
  params: Record<string, unknown>,
  options: CalculateOptions,
): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append("files", structure.data, displayName(structure.name));
  form.append("params", JSON.stringify(params));
  if (options.model) form.append("model", options.model.data, displayName(options.model.name, "custom.model"));

  let response: Response;
  try {
    response = await fetch(`${MACE_API_URL}/calculate`, {
      method: "POST",
      body: form,
      headers: backendHeaders(options.ip ?? null),
      signal: withTimeout(options.signal, options.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ApiError(
        "The calculation did not finish within this deployment's time limit. Nothing was returned; " +
          "try fewer steps or a smaller structure, or run SimpleAtom locally.",
        504,
        "timeout",
      );
    }
    throw new ApiError("The MACE backend could not be reached. It may be starting up; try again shortly.", 502, "backend_unreachable");
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // A platform error page (e.g. the Space waking up) — not our envelope.
  }
  if (!response.ok) {
    if (body) throw apiErrorFrom(body, response.status);
    throw new ApiError(
      response.status === 503
        ? "The MACE backend is starting up. Try again in a minute."
        : `The MACE backend returned HTTP ${response.status}.`,
      response.status >= 500 ? 502 : response.status,
      "backend_error",
    );
  }
  const result = body as Record<string, unknown> | null;
  if (!result) throw new ApiError("The MACE backend returned a response that was not JSON.", 502, "backend_error");
  if (result.status === "error") throw apiErrorFrom(result, 400);
  return result;
}

/**
 * Run mace-api/<script> with Python and parse the single JSON document it
 * prints. A {status:"error"} document becomes an ApiError with the status the
 * script reported, so refusals keep their 4xx.
 */
/**
 * The Python that local mode runs: SIMPLEATOM_PYTHON when set (an environment
 * built from mace-api/requirements.lock.txt), else `python3` on PATH. Bare
 * `python3` used to be the only choice, and it is often not the pinned stack;
 * calculate_local.py now warns in the result when it is not.
 */
export function pythonExecutable(): string {
  return process.env.SIMPLEATOM_PYTHON?.trim() || "python3";
}

/** execFile error codes that mean the interpreter itself could not be started. */
const CANNOT_START = new Set(["ENOENT", "EACCES", "EPERM", "ENOEXEC"]);

export async function runPythonJson(
  script: string,
  args: string[],
  options: { profile: ProfileName; signal?: AbortSignal; timeoutMs: number; maxBuffer?: number },
): Promise<Record<string, unknown>> {
  const { execFile } = await import("node:child_process");
  const { join } = await import("node:path");

  const scriptPath = join(process.cwd(), "mace-api", script);
  const { stdout, stderr, failed, spawnError } = await new Promise<{
    stdout: string;
    stderr: string;
    failed: boolean;
    spawnError: Error | null;
  }>(
    (resolve) => {
      execFile(
        pythonExecutable(),
        [scriptPath, ...args],
        {
          timeout: options.timeoutMs,
          maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
          signal: options.signal,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: "1",
            // torch and its dependencies can each link a copy of libomp on
            // macOS; without this the child aborts with OMP Error #15.
            KMP_DUPLICATE_LIB_OK: "TRUE",
            SIMPLEATOM_PROFILE: options.profile,
          },
        },
        (error, out, err) =>
          resolve({
            stdout: String(out ?? ""),
            stderr: String(err ?? ""),
            failed: !!error,
            spawnError: error && CANNOT_START.has(String((error as { code?: unknown }).code)) ? error : null,
          }),
      );
    },
  );

  if (options.signal?.aborted) throw new ApiError("The request was cancelled.", 499, "cancelled");
  // A Python that cannot be started (ENOENT, EACCES) is the deployment's fault,
  // not the request's: the same 503 the jobs path gives (D95, D147).
  if (spawnError) {
    throw new ApiError(
      `Could not start the local Python (${pythonExecutable()}): ${spawnError.message}. ` +
        "Set SIMPLEATOM_PYTHON to an environment built from mace-api/requirements.lock.txt. Nothing was computed.",
      503,
      "python_unavailable",
    );
  }
  if (stderr) console.warn(`[${script} stderr]`, stderr.slice(-800));

  const start = stdout.indexOf("{");
  let body: Record<string, unknown> | null = null;
  if (start !== -1) {
    try {
      body = JSON.parse(stdout.slice(start));
    } catch {
      body = null;
    }
  }
  if (body && body.status === "error") throw apiErrorFrom(body, 400);
  if (body && !failed) return body;

  const tail = stderr.trim().split("\n").pop() ?? "";
  throw new ApiError(tail || "The Python backend exited without a result.", 500, "calculation_failed");
}

async function calculateLocal(
  structure: StructureInput,
  params: Record<string, unknown>,
  options: CalculateOptions,
): Promise<Record<string, unknown>> {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const os = await import("node:os");

  const dir = await mkdtemp(join(os.tmpdir(), "mace-"));
  try {
    // Names chosen here; the client's filename only rides along for display.
    const structurePath = join(dir, `structure${structureSuffix(structure.name)}`);
    await writeFile(structurePath, Buffer.from(await structure.data.arrayBuffer()));
    // Always a JSON object string beginning with "{": it can never be mistaken
    // for one of the CLI's --flags.
    const args = [structurePath, JSON.stringify(params), "--display-name", displayName(structure.name)];
    if (options.model) {
      const modelPath = join(dir, "custom.model");
      await writeFile(modelPath, Buffer.from(await options.model.data.arrayBuffer()));
      args.push("--model-path", modelPath);
    }
    return await runPythonJson("calculate_local.py", args, options);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Parse a params form field into an object, refusing anything else. */
export function parseParams(raw: FormDataEntryValue | null): Record<string, unknown> {
  if (raw === null || raw === "") return {};
  if (typeof raw !== "string") throw new ApiError("params must be a JSON string.", 400, "invalid_params", "params");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError("Invalid params: expected a JSON object.", 400, "invalid_params", "params");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ApiError("Invalid params: expected a JSON object.", 400, "invalid_params", "params");
  }
  return parsed as Record<string, unknown>;
}

let deviceReport: Promise<DeviceReport> | null = null;

/**
 * The devices this deployment can run on (ADR-0031), asked once per server
 * process: of the hosted backend's /capabilities in remote mode, of the local
 * Python (`calculate_local.py --capabilities`) otherwise. A failure is not
 * cached and reports CPU only, with the reason, so the UI never offers CUDA
 * on the strength of a question nobody answered.
 */
export function deploymentDevices(name: ProfileName): Promise<DeviceReport> {
  const fallback = profileDeviceReport(name);
  if (!(CONTRACT.profiles[name].devices as readonly string[]).includes("cuda")) return Promise.resolve(fallback);
  deviceReport ??= (
    MACE_API_URL
      ? fetch(`${MACE_API_URL}/capabilities`, { headers: backendHeaders(), cache: "no-store" }).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
        )
      : runPythonJson("calculate_local.py", ["--capabilities"], { profile: name, timeoutMs: 60_000 })
  )
    .then((body: { devices?: unknown }) => deviceReportFrom(body.devices, "The backend did not report its devices."))
    .catch((error: unknown) => {
      deviceReport = null;
      return {
        available: ["cpu"],
        unavailableReason: `Could not ask the backend which devices it can use (${error instanceof Error ? error.message : "unknown error"}).`,
      } satisfies DeviceReport;
    });
  return deviceReport;
}
