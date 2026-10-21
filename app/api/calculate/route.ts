import { NextRequest, NextResponse } from "next/server";
import {
  APP_VERSION,
  checkCalculationParams,
  customModelsAllowed,
  profile,
  serverProfileName,
} from "@/lib/contract";
import {
  ApiError,
  MACE_API_URL,
  calculate,
  errorResponse,
  parseParams,
} from "@/lib/server/backend";

export const runtime = "nodejs";
// Vercel's ceiling for this function. The backend's own time budget (240 s on
// the hosted profile) ends a long run with an honest partial result first.
export const maxDuration = 300;

/**
 * MACE Calculation API
 * POST /api/calculate
 *
 * Accepts multipart/form-data with:
 * - files: one structure file (.xyz, .extxyz, .cif, .poscar/.vasp/.contcar, .pdb)
 * - params: JSON object (CalculationParams)
 * - model: optional custom .model checkpoint (local / self-hosted only)
 *
 * Mode selection (docs/adr/0001):
 * 1. MACE_API_URL set → forward to the hosted backend (Hugging Face Space)
 * 2. MACE_API_URL not set → run MACE on this machine via calculate_local.py
 *
 * The checks here mirror mace-api/contract.py so a bad request fails before an
 * upload or a subprocess. They are not the security boundary — the backend
 * validates everything again, because it can be called directly.
 */
export async function POST(request: NextRequest) {
  try {
    const profileName = serverProfileName();
    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      throw new ApiError("No structure file provided.", 400, "no_files", "files");
    }
    const modelEntry = form.get("model");
    const model = modelEntry instanceof File ? modelEntry : null;
    const params = parseParams(form.get("params"));

    const violation = checkCalculationParams(params, profileName, model !== null);
    if (violation) {
      throw new ApiError(violation.message, violation.status, violation.code, violation.field);
    }

    const result = await calculate(
      { data: files[0], name: files[0].name },
      params,
      {
        profile: profileName,
        model: model ? { data: model, name: model.name } : null,
        // A closed tab stops the work: the abort reaches the fetch to the
        // backend, or kills the local Python child.
        signal: request.signal,
        timeoutMs: (maxDuration - 10) * 1000,
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * GET /api/calculate — what this deployment will compute.
 */
export async function GET() {
  const profileName = serverProfileName();
  const limits = Object.fromEntries(
    Object.entries(profile(profileName)).filter(([key]) => key !== "description"),
  );
  return NextResponse.json({
    name: "SimpleAtom MACE API",
    version: APP_VERSION,
    mode: MACE_API_URL ? "remote" : "local",
    profile: profileName,
    customModels: customModelsAllowed(profileName),
    limits,
  });
}
