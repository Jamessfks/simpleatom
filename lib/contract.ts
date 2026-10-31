/**
 * The request contract and model registry, typed for the UI and the routes.
 *
 * Everything here is read from lib/generated/contract.ts, which is generated
 * from mace-api/contract.json — the same file mace-api/contract.py enforces.
 * The checks below are a fast, friendly mirror so a bad request is refused
 * before it costs an upload or a subprocess. They are NOT the security
 * boundary: the hosted API can be called directly, so the Python backend
 * validates everything again (docs/adr/0003, 0022).
 */

import { CONTRACT } from "@/lib/generated/contract";

export { CONTRACT };

export type ModelEntry = (typeof CONTRACT.models)[number];
export type ModelId = ModelEntry["id"];
export type ModelAlias = ModelEntry["aliases"][number];
export type ProfileName = keyof typeof CONTRACT.profiles;
export type Profile = (typeof CONTRACT.profiles)[ProfileName];
export type SupportedCalculationType = (typeof CONTRACT.calculationTypes)[number];
export type MdEnsemble = (typeof CONTRACT.mdEnsembles)[number];
export type NumericParam = keyof typeof CONTRACT.params;

export type Device = (typeof CONTRACT.devices)[number];

/** What a deployment can actually run on (ADR-0031): CPU always, CUDA only when usable. */
export interface DeviceReport {
  available: Device[];
  /** Why CUDA is not offered, or null when it is. */
  unavailableReason: string | null;
}

const CPU_ONLY_REASON = "This deployment is CPU-only: the public server runs on 2 shared vCPUs.";

/** The report a profile implies before any machine is asked: a CPU-only profile never offers CUDA. */
export function profileDeviceReport(name: ProfileName): DeviceReport {
  const offersCuda = (CONTRACT.profiles[name].devices as readonly string[]).includes("cuda");
  return {
    available: ["cpu"],
    unavailableReason: offersCuda ? "Checking whether this machine has a usable CUDA device…" : CPU_ONLY_REASON,
  };
}

/**
 * Read a device report from a backend payload, trusting nothing: unknown
 * devices are dropped, CPU is always present, and anything malformed falls
 * back to CPU-only with a reason, so the UI never offers a device the server
 * did not vouch for.
 */
export function deviceReportFrom(raw: unknown, fallbackReason: string): DeviceReport {
  const r = (raw ?? {}) as { available?: unknown; unavailableReason?: unknown };
  const listed = Array.isArray(r.available) ? r.available : [];
  if (!Array.isArray(r.available) || listed.some((d) => !(CONTRACT.devices as readonly unknown[]).includes(d))) {
    return { available: ["cpu"], unavailableReason: fallbackReason };
  }
  const available: Device[] = ["cpu", ...(listed.includes("cuda") ? (["cuda"] as Device[]) : [])];
  const reason = typeof r.unavailableReason === "string" ? r.unavailableReason : null;
  return {
    available,
    unavailableReason: available.includes("cuda") ? null : (reason ?? fallbackReason),
  };
}

export const APP_VERSION: string = CONTRACT.appVersion;
export const DEFAULT_MODEL_TYPE: ModelId = CONTRACT.defaultModelType;
export const MODELS: readonly ModelEntry[] = CONTRACT.models;
export const PARAMS = CONTRACT.params;

/** Registry entry for a model id or alias ("MACE-OFF23" → MACE-OFF). */
export function findModel(id: string | null | undefined): ModelEntry | undefined {
  if (!id) return undefined;
  return MODELS.find(
    (m) => m.id === id || (m.aliases as readonly string[]).includes(id),
  );
}

/** Canonical id for a model id or alias, or undefined if unknown. */
export function canonicalModelId(id: string | null | undefined): ModelId | undefined {
  return findModel(id)?.id;
}

/** True for models loaded through upstream's mace_off(). */
export function isMaceOffModel(id: string | null | undefined): boolean {
  return findModel(id)?.loader === "mace_off";
}

/** True for the materials (MACE-MP / MPA) family, whatever the member. */
export function isMaterialsModel(id: string | null | undefined): boolean {
  return findModel(id)?.domain === "materials";
}

/** Sizes the registry lists for a model, in display order. */
export function modelSizes(id: string | null | undefined): string[] {
  const model = findModel(id);
  return model ? Object.keys(model.sizes) : [];
}

/** Licence notice to show next to a model (null for MIT models). */
export function licenseNotice(id: string | null | undefined): string | null {
  return findModel(id)?.license.notice ?? null;
}

/** Elements a model was trained on, or null when it covers the periodic table range it lists. */
export function modelElements(id: string | null | undefined): ReadonlySet<string> | null {
  const elements = findModel(id)?.elements;
  return elements ? new Set<string>(elements) : null;
}

/** The enforced energy band (eV/atom) for a model's reference convention. */
export function energyBounds(
  id: string | null | undefined,
): { minEvPerAtom: number; maxEvPerAtom: number } | null {
  const model = findModel(id);
  if (!model) return null;
  return CONTRACT.energyConventions[model.energyConvention].enforced ?? null;
}

export function profile(name: ProfileName): Profile {
  return CONTRACT.profiles[name];
}

/**
 * The profile a Next.js server is fronting: "hosted" when it proxies to a
 * remote backend (MACE_API_URL set), "local" when it spawns Python itself.
 * SIMPLEATOM_PROFILE overrides either, exactly as it does in Python.
 */
export function serverProfileName(): ProfileName {
  const explicit = process.env.SIMPLEATOM_PROFILE?.trim().toLowerCase();
  if (explicit === "hosted" || explicit === "local") return explicit;
  return process.env.MACE_API_URL?.trim() ? "hosted" : "local";
}

/** Mirrors contract.custom_models_allowed() in Python. */
export function customModelsAllowed(name: ProfileName): boolean {
  const raw = process.env.ALLOW_CUSTOM_MODELS?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return CONTRACT.profiles[name].customModels;
}

export interface ContractViolation {
  code: string;
  message: string;
  field: string | null;
  status: number;
}

function violation(code: string, message: string, field: string | null, status = 400): ContractViolation {
  return { code, message, field, status };
}

function checkNumber(params: Record<string, unknown>, field: NumericParam): ContractViolation | null {
  const raw = params[field];
  if (raw === undefined || raw === null || raw === "") return null;
  const spec = PARAMS[field];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (typeof raw === "boolean" || !Number.isFinite(value)) {
    return violation("invalid_number", `Invalid ${field}: expected a finite number.`, field);
  }
  if (spec.type === "integer" && !Number.isInteger(value)) {
    return violation("invalid_number", `Invalid ${field}: expected a whole number.`, field);
  }
  if (value < spec.min || value > spec.max) {
    const unit = spec.unit ? ` ${spec.unit}` : "";
    return violation(
      "out_of_range",
      `${field} = ${value}${unit} is outside the supported range ${spec.min}–${spec.max}${unit}.`,
      field,
    );
  }
  return null;
}

/**
 * The first reason the contract would refuse these params, or null.
 *
 * Mirrors the request-level checks in mace-api/contract.py and calculate.py.
 * Structure-dependent checks (atom caps, NPT periodicity) need the parsed
 * structure and are left to the backend.
 */
export function checkCalculationParams(
  params: Record<string, unknown>,
  profileName: ProfileName,
  hasModelFile = false,
): ContractViolation | null {
  const calcType = params.calculationType;
  if (calcType !== undefined && calcType !== null && calcType !== "") {
    const supported = CONTRACT.calculationTypes as readonly string[];
    if (typeof calcType !== "string" || !supported.includes(calcType.trim())) {
      const hint =
        typeof calcType === "string"
          ? (CONTRACT.refusedCalculationTypes as Record<string, string>)[calcType.trim().toLowerCase()]
          : undefined;
      return violation(
        "unsupported_calculation",
        `Unsupported calculationType '${String(calcType)}'. Supported types: ${supported.join(", ")}.` +
          (hint ? ` ${hint}` : ""),
        "calculationType",
      );
    }
  }

  if (hasModelFile && !customModelsAllowed(profileName)) {
    return violation(
      "custom_models_disabled",
      "Custom model checkpoints are disabled on this deployment: loading a MACE .model file " +
        "executes code from the file. " +
        (profileName === "local"
          ? "Restart with ALLOW_CUSTOM_MODELS=1 to load your own checkpoint."
          : "Run SimpleAtom locally with ALLOW_CUSTOM_MODELS=1 to use your own checkpoint."),
      "model",
      403,
    );
  }

  const modelRaw = params.modelType;
  const model =
    modelRaw === undefined || modelRaw === null || modelRaw === ""
      ? findModel(hasModelFile ? "custom" : DEFAULT_MODEL_TYPE)
      : typeof modelRaw === "string"
        ? findModel(modelRaw.trim())
        : undefined;
  if (!model) {
    return violation(
      "unsupported_model",
      `Unsupported modelType '${String(modelRaw)}'.`,
      "modelType",
    );
  }
  if (model.loader === "checkpoint" && !hasModelFile) {
    return violation(
      "custom_model_missing",
      "modelType 'custom' requires an uploaded MACE .model checkpoint.",
      "modelType",
    );
  }
  const size = params.modelSize;
  if (
    !hasModelFile &&
    model.loader !== "checkpoint" &&
    size !== undefined &&
    size !== null &&
    size !== "" &&
    !(typeof size === "string" && Object.keys(model.sizes).includes(size))
  ) {
    return violation(
      "unsupported_model_size",
      `Unsupported modelSize '${String(size)}' for ${model.id}. Available sizes: ${Object.keys(model.sizes).join(", ")}.`,
      "modelSize",
    );
  }

  for (const [field, choices] of [
    ["precision", CONTRACT.precisions],
    ["device", CONTRACT.devices],
  ] as const) {
    const raw = params[field];
    if (raw !== undefined && raw !== null && raw !== "" && !(choices as readonly unknown[]).includes(raw)) {
      return violation(`unsupported_${field}`, `Unsupported ${field} '${String(raw)}'.`, field);
    }
  }
  // ADR-0031: a device the contract knows but this profile cannot provide is
  // refused, not silently replaced (the public server is CPU-only).
  const device = params.device;
  if (typeof device === "string" && device && !(CONTRACT.profiles[profileName].devices as readonly string[]).includes(device)) {
    return violation(
      "device_unavailable",
      `Device '${device}' is not available on this deployment, which runs on: ` +
        `${CONTRACT.profiles[profileName].devices.join(", ")}. Nothing was computed.`,
      "device",
    );
  }
  // Same rule as contract.resolve_bool(): a real boolean, or the strings
  // "true"/"false"; anything else is refused.
  const dispersion = params.dispersion;
  const dispersionText = typeof dispersion === "string" ? dispersion.trim().toLowerCase() : null;
  if (
    dispersion !== undefined &&
    dispersion !== null &&
    typeof dispersion !== "boolean" &&
    dispersionText !== "true" &&
    dispersionText !== "false"
  ) {
    return violation("invalid_boolean", "Invalid dispersion: expected true or false.", "dispersion");
  }

  // Only the fields this calculation type reads are checked — exactly what
  // calculate._resolve_run_params() resolves — so a stray mdSteps on a
  // single-point is ignored here just as it is by the backend.
  const calc = typeof calcType === "string" && calcType.trim() ? calcType.trim() : "single-point";
  const ensemble = params.mdEnsemble;
  if (calc === "molecular-dynamics" && ensemble !== undefined && ensemble !== null && ensemble !== "" &&
      !(CONTRACT.mdEnsembles as readonly unknown[]).includes(ensemble)) {
    return violation("unsupported_mdEnsemble", `Unsupported mdEnsemble '${String(ensemble)}'.`, "mdEnsemble");
  }
  const fields: NumericParam[] = ["seed"];
  if (calc === "geometry-opt") fields.push("forceThreshold", "maxOptSteps");
  if (calc === "molecular-dynamics") {
    fields.push("temperature", "timeStep", "friction", "mdSteps");
    if (ensemble === "NPT") fields.push("pressure");
  }
  for (const field of fields) {
    const problem = checkNumber(params, field);
    if (problem) return problem;
  }

  const caps = profile(profileName);
  const opt = Number(params.maxOptSteps);
  if (params.calculationType === "geometry-opt" && Number.isFinite(opt) && opt > caps.maxOptSteps) {
    return violation(
      "limit_exceeded",
      `maxOptSteps = ${opt} exceeds this deployment's limit of ${caps.maxOptSteps}.`,
      "maxOptSteps",
      422,
    );
  }
  const md = Number(params.mdSteps);
  if (params.calculationType === "molecular-dynamics" && Number.isFinite(md) && md > caps.maxMdSteps) {
    return violation(
      "limit_exceeded",
      `mdSteps = ${md} exceeds this deployment's limit of ${caps.maxMdSteps}.`,
      "mdSteps",
      422,
    );
  }
  return null;
}
