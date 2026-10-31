import { NextRequest, NextResponse } from "next/server";
import { profile, serverProfileName } from "@/lib/contract";
import {
  ApiError,
  MACE_API_URL,
  errorResponse,
  runPythonJson,
} from "@/lib/server/backend";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * SMILES → XYZ Conversion API
 * POST /api/smiles-to-xyz
 *
 * Accepts JSON body: { smiles: string }
 * Returns JSON: { xyz, num_atoms, smiles_canonical, formula }
 *
 * Mode selection mirrors /api/calculate: forward to MACE_API_URL when set,
 * otherwise run mace-api/smiles_to_xyz.py locally.
 */
export async function POST(request: NextRequest) {
  try {
    const profileName = serverProfileName();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("Expected a JSON body { smiles: string }.", 400, "invalid_body");
    }
    const smiles = (body as { smiles?: unknown })?.smiles;
    if (typeof smiles !== "string" || !smiles.trim()) {
      throw new ApiError("Missing or empty 'smiles' field", 400, "invalid_smiles", "smiles");
    }
    const trimmed = smiles.trim();
    const maxLength = profile(profileName).maxSmilesLength;
    if (trimmed.length > maxLength) {
      throw new ApiError(
        `SMILES is ${trimmed.length} characters; this deployment accepts at most ${maxLength}.`,
        422,
        "limit_exceeded",
        "smiles",
      );
    }

    if (MACE_API_URL) {
      const token = process.env.MACE_API_TOKEN;
      let response: Response;
      try {
        response = await fetch(`${MACE_API_URL}/smiles-to-xyz`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "X-SimpleAtom-Proxy-Key": token } : {}),
          },
          body: JSON.stringify({ smiles: trimmed }),
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]),
        });
      } catch {
        throw new ApiError("The SMILES service could not be reached. Try again shortly.", 502, "backend_unreachable");
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.status === "error") {
        const message =
          data?.error?.message || data?.message || `SMILES conversion failed (HTTP ${response.status}).`;
        throw new ApiError(message, response.ok ? 400 : response.status, data?.error?.code || "smiles_failed", "smiles");
      }
      return NextResponse.json(data);
    }

    const data = await runPythonJson("smiles_to_xyz.py", [trimmed], {
      profile: profileName,
      signal: request.signal,
      timeoutMs: 55_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return NextResponse.json(data);
  } catch (error) {
    return errorResponse(error);
  }
}
