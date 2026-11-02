import { NextRequest, NextResponse } from "next/server";
import { checkCalculationParams, serverProfileName } from "@/lib/contract";
import {
  ApiError,
  assertLoopbackHost,
  assertSameOrigin,
  errorResponse,
  parseParams,
} from "@/lib/server/backend";
import { cancelJob, clientIp, submitJob } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/jobs — queue a calculation (docs/adr/0023).
 *
 * Same multipart body as POST /api/calculate (files, params, optional model).
 * Answers 202 at once with `{ jobId, status, queuePosition, progress }`; poll
 * GET /api/jobs/{id} for real progress and the result, DELETE it to cancel.
 * Refusals are immediate 4xx, never a failed job later.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const profileName = serverProfileName();
    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new ApiError("No structure file provided.", 400, "no_files", "files");
    const modelEntry = form.get("model");
    const model = modelEntry instanceof File ? modelEntry : null;
    const params = parseParams(form.get("params"));

    const violation = checkCalculationParams(params, profileName, model !== null);
    if (violation) throw new ApiError(violation.message, violation.status, violation.code, violation.field);
    if (model && profileName === "local") assertLoopbackHost(request);

    const { status, body } = await submitJob({ data: files[0], name: files[0].name }, params, {
      profile: profileName,
      model: model ? { data: model, name: model.name } : null,
      ip: clientIp(request),
    });
    // The browser learns the job id only from this answer. If its tab closed
    // while the job was being created, nobody can cancel it, so cancel it here
    // rather than let it hold the single worker for nothing (D143).
    const jobId = (body as { jobId?: unknown } | null)?.jobId;
    if (request.signal.aborted && typeof jobId === "string") {
      await cancelJob(jobId).catch(() => undefined);
    }
    return NextResponse.json(body, { status });
  } catch (error) {
    return errorResponse(error);
  }
}
