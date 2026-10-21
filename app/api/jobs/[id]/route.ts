import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/server/backend";
import { cancelJob, getJob } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Context {
  params: Promise<{ id: string }>;
}

/** GET /api/jobs/{id} — status, real progress, and the result once finished. */
export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { status, body } = await getJob((await params).id);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/jobs/{id} — cancel: a queued job is dropped, a running one stopped. */
export async function DELETE(_request: NextRequest, { params }: Context) {
  try {
    const { status, body } = await cancelJob((await params).id);
    return NextResponse.json(body, { status });
  } catch (error) {
    return errorResponse(error);
  }
}
