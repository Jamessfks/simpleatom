import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { SharingUnavailableError } from "@/lib/supabase";
import { insertSharedResult } from "@/lib/server/share-store";
import { ELEMENT_SYMBOL, MAX_SHARED_ATOMS, checkSharedResultShape } from "@/lib/share";
import { ApiError, assertSameOrigin, displayName, errorResponse } from "@/lib/server/backend";
import { clientIp } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Largest result accepted for sharing. The calculator's own JSON stays well under this. */
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const MAX_FRAMES = 2_000;

/**
 * Per-visitor write limit, per server instance. Best effort on serverless —
 * each instance keeps its own window — and backed by the per-client limit
 * in supabase/migrations/0002 once that function is in use.
 */
const WINDOW_MS = 60 * 60 * 1000;
const PER_WINDOW = 20;
const recent = new Map<string, number[]>();

function rateLimit(key: string) {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= PER_WINDOW) {
    throw new ApiError("Too many share links from this connection. Try again later.", 429, "rate_limited");
  }
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 10_000) recent.clear();
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isVec3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(finite);

/**
 * Accept only what the calculator produces: a successful result whose atoms,
 * positions and forces agree, with finite numbers and bounded sizes. Rows
 * used to be inserted straight from the browser, so the table could hold
 * anything — including a structure crafted to break a viewer.
 */
function validateResult(result: unknown): Record<string, unknown> {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new ApiError("result must be an object.", 400, "invalid_result", "result");
  }
  const r = result as Record<string, unknown>;
  if (r.status !== "success") {
    throw new ApiError("Only completed calculations can be shared.", 400, "invalid_result", "result.status");
  }
  const symbols = r.symbols;
  if (!Array.isArray(symbols) || symbols.length === 0 || symbols.length > MAX_SHARED_ATOMS ||
      !symbols.every((s) => typeof s === "string" && ELEMENT_SYMBOL.test(s))) {
    throw new ApiError("result.symbols must be element symbols.", 400, "invalid_result", "result.symbols");
  }
  for (const key of ["positions", "forces"] as const) {
    const arr = r[key];
    if (!Array.isArray(arr) || arr.length !== symbols.length || !arr.every(isVec3)) {
      throw new ApiError(`result.${key} must hold one finite 3-vector per atom.`, 400, "invalid_result", `result.${key}`);
    }
  }
  if (!finite(r.energy)) throw new ApiError("result.energy must be a finite number.", 400, "invalid_result", "result.energy");
  // Size first (413); anything that is not a trajectory the page can draw is
  // refused by checkSharedResultShape below (400), including null and {}.
  const traj = r.trajectory;
  if (
    typeof traj === "object" && traj !== null && !Array.isArray(traj) &&
    Array.isArray((traj as { positions?: unknown[] }).positions) &&
    (traj as { positions: unknown[] }).positions.length > MAX_FRAMES
  ) {
    throw new ApiError(`Trajectories longer than ${MAX_FRAMES} frames cannot be shared.`, 413, "too_large", "result.trajectory");
  }
  if (r.params !== undefined && (typeof r.params !== "object" || r.params === null)) {
    throw new ApiError("result.params must be an object.", 400, "invalid_result", "result.params");
  }
  // Everything the shared page renders besides coordinates: text, provenance,
  // validation, parameters, properties and trajectory series (D64). The row is
  // public and permanent, so a value the backend never produces is refused
  // here rather than rendered as fact later.
  const shape = checkSharedResultShape(r, symbols.length);
  if (shape) throw new ApiError(`${shape.field} ${shape.message}`, 400, "invalid_result", shape.field);
  return r;
}

/**
 * POST /api/share — publish a result as a MACE Link (docs/adr/0024).
 *
 * Body: `{ result, filename, consent: true }`. The server validates the
 * result, chooses the id and stores it; the link is permanent and public.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) throw new ApiError("This result is too large to share.", 413, "too_large");
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) throw new ApiError("This result is too large to share.", 413, "too_large");

    let body: { result?: unknown; filename?: unknown; consent?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError("Expected a JSON body.", 400, "invalid_body");
    }
    if (body.consent !== true) {
      throw new ApiError("Sharing publishes this result permanently; consent is required.", 400, "consent_required", "consent");
    }
    const result = validateResult(body.result);
    rateLimit(clientIp(request) ?? "unknown");

    const id = randomBytes(9).toString("base64url");
    await insertSharedResult({
      id,
      result,
      // What ran, from the result itself — never a separate client copy.
      params: (result.params as object | undefined) ?? {},
      filename: typeof body.filename === "string" ? displayName(body.filename) : null,
      size_bytes: text.length,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof SharingUnavailableError) {
      return errorResponse(new ApiError(error.message, 503, "sharing_unavailable"));
    }
    return errorResponse(error);
  }
}
