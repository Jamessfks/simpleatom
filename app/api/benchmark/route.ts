/**
 * Benchmark API — batch MACE calculation endpoint.
 *
 * Accepts 2–3 models and a set of structure IDs (from the ml-peg catalog and
 * the Materials Project reference set) plus optional uploaded structure files.
 * Runs every (model, structure) pair sequentially and returns a unified
 * BenchmarkResult. Individual failures are recorded as status "error" without
 * aborting the batch.
 *
 * Dual-mode through lib/server/backend.ts, exactly like /api/calculate: the
 * same upload handling, the same caps, the same error envelope.
 */

import { NextRequest, NextResponse } from "next/server";
import { getBenchmarkStructuresByIds } from "@/lib/benchmark-structures";
import {
  checkCalculationParams,
  findModel,
  profile,
  serverProfileName,
  type ProfileName,
} from "@/lib/contract";
import {
  ApiError,
  assertLoopbackHost,
  assertSameOrigin,
  calculate,
  checkUploadSize,
  displayName,
  errorResponse,
  structureSuffix,
} from "@/lib/server/backend";
import { computeRmsForce } from "@/lib/utils";
import type {
  BenchmarkModelResult,
  BenchmarkResult,
  BenchmarkStructureResult,
  CalculationResult,
  ModelSize,
  ModelType,
} from "@/types/mace";

export const runtime = "nodejs";
export const maxDuration = 300;

interface BenchmarkRequestModel {
  type: ModelType;
  size: ModelSize;
}

interface BenchmarkRequestBody {
  models: BenchmarkRequestModel[];
  structureIds?: string[];
  calculationType?: string;
}

interface RunnableStructure {
  id: string;
  name: string;
  category: string;
  formula: string;
  atomCount: number;
  data: Blob;
  filename: string;
  expectsPeriodic: boolean;
  reference?: BenchmarkStructureResult["reference"];
}

function modelLabel(m: BenchmarkRequestModel): string {
  if (m.type === "custom") return "Custom checkpoint";
  return `${findModel(m.type)?.label ?? m.type} (${m.size})`;
}

function computeMaxForce(forces: number[][] | undefined): number | undefined {
  if (!forces || forces.length === 0) return undefined;
  let max = 0;
  for (const f of forces) max = Math.max(max, Math.hypot(f[0], f[1], f[2]));
  return max;
}

async function readRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return { body: (await request.json()) as BenchmarkRequestBody, model: null, uploads: [] as File[] };
  }
  const form = await request.formData();
  const json = form.get("json");
  if (typeof json !== "string") throw new ApiError("Missing 'json' field.", 400, "invalid_body");
  const modelEntry = form.get("model");
  return {
    body: JSON.parse(json) as BenchmarkRequestBody,
    model: modelEntry instanceof File ? modelEntry : null,
    uploads: form.getAll("structures").filter((f): f is File => f instanceof File),
  };
}

function validate(
  body: BenchmarkRequestBody,
  uploads: File[],
  model: File | null,
  profileName: ProfileName,
) {
  const caps = profile(profileName);
  const { models, structureIds = [], calculationType = "single-point" } = body;
  if (!Array.isArray(models) || models.length < 2 || models.length > 3) {
    throw new ApiError("Provide 2 or 3 models to benchmark.", 400, "invalid_models", "models");
  }
  if (structureIds.length + uploads.length === 0) {
    throw new ApiError("Provide at least one structure (catalog selection or file upload).", 400, "no_structures");
  }
  if (structureIds.length > caps.maxBenchmarkStructures) {
    throw new ApiError(
      `${structureIds.length} structures requested; this deployment benchmarks at most ${caps.maxBenchmarkStructures}.`,
      422, "limit_exceeded", "structureIds",
    );
  }
  if (uploads.length > caps.maxBenchmarkUploads) {
    throw new ApiError(
      `${uploads.length} files uploaded; this deployment accepts at most ${caps.maxBenchmarkUploads}.`,
      422, "limit_exceeded", "structures",
    );
  }
  for (const upload of uploads) {
    structureSuffix(upload.name);
    checkUploadSize(upload, upload.name, caps.maxUploadBytes, "structures");
  }
  for (const m of models) {
    const violation = checkCalculationParams(
      { modelType: m.type, modelSize: m.type === "custom" ? undefined : m.size, calculationType },
      profileName,
      m.type === "custom" && model !== null,
    );
    if (violation) throw new ApiError(violation.message, violation.status, violation.code, violation.field);
  }
  return { models, structureIds, calculationType };
}

/**
 * POST /api/benchmark
 *
 * Runs multiple MACE models across multiple structures in a batch,
 * collecting energy, forces, and timing for each (model, structure) pair.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const profileName = serverProfileName();
    const { body, model, uploads } = await readRequest(request);
    const { models, structureIds, calculationType } = validate(body, uploads, model, profileName);
    if (model && profileName === "local") assertLoopbackHost(request);

    const structures: RunnableStructure[] = [
      ...getBenchmarkStructuresByIds(structureIds).map((entry) => ({
        id: entry.id,
        name: entry.name,
        category: entry.category,
        formula: entry.formula,
        atomCount: entry.atomCount,
        data: new Blob([entry.structureData]),
        filename: entry.filename,
        expectsPeriodic: entry.expectsPeriodic,
        reference: entry.reference,
      })),
      ...uploads.map((file) => {
        const name = displayName(file.name);
        return {
          id: `user-${name.replace(/\.[^.]+$/, "")}`,
          name,
          category: "uploaded",
          formula: name,
          atomCount: 0,
          data: file,
          filename: name,
          expectsPeriodic: false,
        };
      }),
    ];
    if (structures.length === 0) {
      throw new ApiError("No valid structures found.", 400, "no_structures");
    }

    const results: BenchmarkStructureResult[] = [];
    let successCount = 0;
    let errorCount = 0;
    const batchStart = Date.now();
    const deadline = batchStart + (maxDuration - 15) * 1000;

    for (const structure of structures) {
      const modelResults: BenchmarkModelResult[] = [];
      for (const m of models) {
        const calcStart = Date.now();
        const base = { modelLabel: modelLabel(m), modelType: m.type, modelSize: m.size };
        const fail = (error: string) => {
          errorCount++;
          modelResults.push({ ...base, status: "error", error, timeTaken: (Date.now() - calcStart) / 1000 });
        };
        const remaining = deadline - Date.now();
        if (remaining < 5_000) {
          fail("Not run: the batch reached this deployment's time limit. Benchmark fewer structures at once.");
          continue;
        }
        try {
          const result = (await calculate(
            { data: structure.data, name: structure.filename },
            {
              modelType: m.type,
              ...(m.type === "custom" ? {} : { modelSize: m.size }),
              calculationType,
              // One precision for every model, so differences are the models'.
              precision: "float64",
              device: "cpu",
              dispersion: false,
            },
            {
              profile: profileName,
              model: m.type === "custom" && model ? { data: model, name: model.name } : null,
              signal: request.signal,
              timeoutMs: remaining,
            },
          )) as unknown as CalculationResult;

          // A structure with a defined cell must come back periodic. A null
          // lattice means the cell was lost on the way in and the energy is a
          // gas-phase cluster energy — off by whole eV per atom. That is the
          // same class of error as reporting a calculation that never ran.
          if (structure.expectsPeriodic && result.lattice == null) {
            fail(
              `${structure.name} has a defined unit cell, but the backend returned no lattice — the ` +
                "periodicity was lost while parsing, so the energy would be a cluster energy, not a " +
                "crystal energy. Rejected rather than reported.",
            );
            continue;
          }

          const atomCount = result.symbols?.length ?? structure.atomCount;
          successCount++;
          modelResults.push({
            ...base,
            status: "success",
            energy: result.energy,
            energyPerAtom: result.energy != null && atomCount > 0 ? result.energy / atomCount : undefined,
            forces: result.forces,
            symbols: result.symbols,
            rmsForce: computeRmsForce(result.forces) ?? undefined,
            maxForce: computeMaxForce(result.forces),
            timeTaken: result.timeTaken ?? (Date.now() - calcStart) / 1000,
          });
          if (!structure.atomCount) structure.atomCount = atomCount;
        } catch (err) {
          let message = err instanceof Error ? err.message : "Unknown error";
          if (/element|not supported|species|atomic number/i.test(message)) {
            const elements = findModel(m.type)?.elements;
            if (elements) message += ` (${findModel(m.type)?.label} covers only ${elements.join(", ")}.)`;
          }
          fail(message);
        }
      }

      results.push({
        structureId: structure.id,
        structureName: structure.name,
        category: structure.category,
        formula: structure.formula,
        atomCount: structure.atomCount,
        reference: structure.reference,
        models: modelResults,
      });
    }

    const totalCalculations = models.length * structures.length;
    const benchmarkResult: BenchmarkResult = {
      status: errorCount === 0 ? "success" : errorCount === totalCalculations ? "error" : "partial",
      results,
      summary: {
        totalStructures: structures.length,
        totalModels: models.length,
        totalCalculations,
        successCount,
        errorCount,
        totalTime: (Date.now() - batchStart) / 1000,
      },
    };
    return NextResponse.json(benchmarkResult);
  } catch (error) {
    return errorResponse(error);
  }
}
