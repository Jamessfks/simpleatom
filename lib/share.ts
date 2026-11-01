/**
 * MACE Link — what both the browser and the server need to know about a
 * shared result: its id format, its embed path, how a stored payload is
 * normalised for display, and how the calculator publishes one.
 *
 * Storage lives server-side only (lib/server/share-store.ts, behind
 * POST /api/share and the /r/[id] pages). The browser used to insert rows
 * straight into Supabase with the public anon key, which let anyone list,
 * flood or forge the table (docs/adr/0024). This module no longer imports a
 * database client at all, so none ships to the browser.
 */

import { getSiteUrl } from "@/lib/site";
import { ApiRequestError, readError } from "@/lib/api-client";
import type { CalculationResult, SharedResult } from "@/types/mace";

/** Shared-result ids: nanoid(8) for older links, 12-char base64url now. */
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

/**
 * What the user is told before a result is published. Shown by the calculator's
 * confirmation step; the server stores exactly this much (coordinates, forces,
 * the file name and the results) and cannot delete it from the app.
 */
export const SHARE_DISCLOSURE =
  "Anyone with the link can see this structure's atomic coordinates, its file name and the full results. " +
  "The link is public and permanent: it cannot be deleted from the app.";

/**
 * Publish a calculation result and return its shareable URL.
 *
 * `consent` is the user's answer to SHARE_DISCLOSURE and has no default: the
 * request is not made without it (the server would refuse it too, ADR-0024).
 * The server validates the payload, stores it, and chooses the id. Only the
 * result's own `params` (what actually ran) are stored — never a second,
 * client-supplied copy that could disagree with it.
 */
export async function saveResult(
  result: CalculationResult,
  filename?: string,
  consent?: boolean,
): Promise<{ id: string; url: string }> {
  if (consent !== true) {
    throw new ApiRequestError("Confirm that you want to publish this result first.", 400, "consent_required", "consent");
  }
  const response = await fetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result, filename: filename ?? null, consent: true }),
  });
  if (!response.ok) throw await readError(response, "Could not create the share link");
  const { id } = (await response.json()) as { id?: string };
  if (!id || !SHARE_ID_PATTERN.test(id)) {
    throw new ApiRequestError("The share service returned no link.", 502, "share_failed");
  }
  return { id, url: `${getSiteUrl()}/r/${id}` };
}

/**
 * Path of the embeddable form of a shared result, relative to the site origin.
 *
 * A sub-route rather than a query parameter because response headers are
 * matched on the path: the framing exemption in `next.config.ts` can only be
 * scoped to this view if this view has a path of its own (see the header
 * comment in app/r/[id]/embed/page.tsx). Keep this in step with that route and
 * with the `headers()` sources in next.config.ts — the string is spelled out in
 * all three places because next.config cannot import from here (this module
 * pulls in more than plain constants).
 */
export function embedPath(id: string): string {
  return `/r/${id}/embed`;
}

/**
 * True when a nested object holds at least one value worth rendering.
 *
 * Recursive because the provenance manifest is a tree of optional groups whose
 * every leaf is nullable by design: the backend writes `null` for anything it
 * could not measure rather than inventing it (mace-api/provenance.py). A
 * manifest of nothing but nulls is therefore possible, and is not content.
 */
function hasRenderableLeaf(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(hasRenderableLeaf);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasRenderableLeaf);
  }
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

/**
 * A trajectory the player can draw: an object whose `energies`, `step` and
 * `positions` are lists with one entry per frame. The player indexes all three
 * together, so a missing `step` or lists of different lengths are not drawable (D159).
 */
function isTrajectory(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const { energies, step, positions } = value;
  return (
    Array.isArray(energies) &&
    Array.isArray(step) &&
    Array.isArray(positions) &&
    energies.length === positions.length &&
    step.length === positions.length
  );
}

/**
 * A trajectory the dashboard can draw without throwing: both lists it indexes,
 * every series it sums, plots or formats a list of numbers, and every frame one
 * finite 3-vector per atom (D164). Stricter than `isTrajectory` on purpose and
 * used only to read rows already stored. It checks types and shapes, never
 * sizes, so a long legitimate trajectory is kept whole. `atomCount` is the
 * length of the row's symbols, or undefined when it has none to compare with.
 */
function isRenderableTrajectory(value: unknown, atomCount?: number): boolean {
  if (!isTrajectory(value)) return false;
  const seriesOk = SERIES.every((key) => {
    const series = value[key];
    return series === undefined || (Array.isArray(series) && series.every((x) => typeof x === "number"));
  });
  if (!seriesOk) return false;
  return (value.positions as unknown[]).every(
    (frame) => Array.isArray(frame) && (atomCount === undefined || frame.length === atomCount) && frame.every(isVec3),
  );
}

const has = (o: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** `obj` without `keys`; `obj` itself when it holds none of them. */
function omit(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  if (!keys.some((key) => has(obj, key))) return obj;
  return Object.fromEntries(Object.entries(obj).filter(([key]) => !keys.includes(key)));
}

/** `root` without the value at `path`, or null when there is nothing at that path to remove. */
function without(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> | null {
  const [head, ...rest] = path;
  if (head === undefined || !has(root, head)) return null;
  if (rest.length === 0) return omit(root, [head]);
  const child = root[head];
  if (!isObject(child)) return null;
  const inner = without(child, rest);
  return inner ? { ...root, [head]: inner } : null;
}

/**
 * Sections whose parts say nothing on their own: a validation block without its
 * issues is a clean verdict, and half a cell is no cell. A problem anywhere in
 * one drops all of it. Every other section loses only the field that failed.
 */
const WHOLE_SECTIONS: ReadonlySet<string> = new Set(["validation", "lattice", "stoppedEarly"]);

/**
 * Run the write path's section checks over a stored result and delete what
 * fails, one problem at a time, until nothing does. The trajectory is not in
 * `result` here: it has its own, size-blind check (isRenderableTrajectory).
 */
function dropFailingSections(result: Record<string, unknown>): Record<string, unknown> {
  let current = result;
  for (let i = 0; i < 100; i++) {
    const problem = checkSharedResultShape(current, 0);
    if (!problem) return current;
    const path = problem.field.split(".").slice(1); // "result.a.b" -> ["a", "b"]
    const target = path.length > 0 && WHOLE_SECTIONS.has(path[0]) ? path.slice(0, 1) : path;
    const next = without(current, target) ?? without(current, path.slice(0, 1));
    if (!next) return current; // not locatable; nothing more can be done here
    current = next;
  }
  return current;
}

/** The stored result with every section the page cannot draw safely removed (D164). */
function readableResult(stored: Record<string, unknown>): Record<string, unknown> {
  let r = stored;
  const drop = (...keys: string[]) => {
    r = omit(r, keys);
  };

  // What the write path demands of the core (validateResult in app/api/share/route.ts).
  if (r.status !== undefined && r.status !== "success" && r.status !== "error") drop("status");
  if (!absent(r.energy) && !isFinite_(r.energy)) drop("energy");
  if (r.params !== undefined && !isObject(r.params)) drop("params");

  if (r.symbols !== undefined && !isElementList(r.symbols)) drop("symbols", "positions", "forces", "trajectory");
  const atomCount = Array.isArray(r.symbols) ? r.symbols.length : undefined;
  for (const key of ["positions", "forces"] as const) {
    if (r[key] !== undefined && !isVec3List(r[key], atomCount)) drop(key);
  }

  const trajectory = r.trajectory;
  r = omit(r, ["trajectory"]);
  r = dropFailingSections(r);
  if (trajectory !== undefined && isRenderableTrajectory(trajectory, atomCount)) r = { ...r, trajectory };
  return sameKeys(r, stored) ? stored : r;
}

/** The row's `params` column, held to the same per-parameter checks as `result.params`. */
function readableParams(params: unknown): Record<string, unknown> {
  if (!isObject(params)) return {};
  const clean = dropFailingSections({ params }).params;
  return isObject(clean) ? clean : {};
}

/**
 * Make a stored payload safe for a reader that predates — or postdates — it.
 *
 * `result.provenance` and `result.validation` were added after MACE Link
 * shipped, so rows written earlier do not have them, and the UI must render
 * nothing at all rather than an empty section. Absent keys already do that.
 * What this guards is the middle case: a payload where the key EXISTS but says
 * nothing — a manifest of all-null leaves, or a validation object with no
 * `status`. Both would draw a headed, empty card, and the validation one would
 * additionally claim the validator was unavailable, which for a row that simply
 * predates validation is a false statement about a run nobody can re-inspect.
 *
 * It also holds every stored section to the checks the write path applies
 * (checkSharedResultShape), because before the database was locked down (D32)
 * any client could insert a row, and a value of the wrong type in any section
 * crashed the page for everyone who opened the link (D164). A section that
 * fails is dropped, and the rest of the row is read as it was stored. Sizes are
 * held to the write path's caps except for the trajectory, whose frames and
 * series are checked for type and shape only: rows stored before the cap may
 * hold a longer one.
 *
 * This only ever DELETES: a contentless key, a section the page cannot draw, or
 * a `result` that is not an object at all (replaced by a failed one). It never
 * adds a field, never fills a null, and never changes a number — a shared
 * result must keep saying exactly what it said when it was stored.
 *
 * Exported so it can be exercised directly against hand-built legacy payloads.
 */
export function normalizeSharedResult(shared: SharedResult): SharedResult {
  const stored = shared.result as unknown;
  let next: SharedResult = shared;

  if (shared.params !== undefined) {
    const params = readableParams(shared.params);
    if (!sameKeys(params, shared.params)) next = { ...next, params: params as SharedResult["params"] };
  }
  if (shared.filename !== undefined && shared.filename !== null && typeof shared.filename !== "string") {
    next = omit(next as unknown as Record<string, unknown>, ["filename"]) as unknown as SharedResult;
  }

  if (!isObject(stored)) return { ...next, result: { status: "error" } };

  const clean = readableResult(stored);
  const result = clean as unknown as CalculationResult;

  const dropProvenance =
    "provenance" in result &&
    !hasRenderableLeaf({
      // `schemaVersion` and `paramsRef` describe the manifest, not the run, so
      // a manifest carrying only those two is still empty on screen.
      ...result.provenance,
      schemaVersion: undefined,
      paramsRef: undefined,
    });

  const status = result.validation?.status;
  const dropValidation =
    "validation" in result && status !== "ran" && status !== "unavailable";

  if (clean === stored && !dropProvenance && !dropValidation) return next;

  const out: CalculationResult = { ...result };
  if (dropProvenance) delete out.provenance;
  if (dropValidation) delete out.validation;
  return { ...next, result: out };
}

/** True when `clean` is `original` itself, or holds the same keys with the same values. */
function sameKeys(clean: Record<string, unknown>, original: unknown): boolean {
  if (clean === original) return true;
  if (!isObject(original)) return false;
  const a = Object.keys(clean);
  return a.length === Object.keys(original).length && a.every((key) => clean[key] === original[key]);
}

// ---------------------------------------------------------------------------
// What a shared result may contain (D64)
// ---------------------------------------------------------------------------

/** A git commit as `git rev-parse` prints it. Anything else is never made a link. */
export const GIT_COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/** Most table rows a shared page draws; a larger result says how many it left out. */
export const MAX_RENDERED_ROWS = 200;

export function visibleRows<T>(rows: readonly T[], limit = MAX_RENDERED_ROWS): { shown: T[]; hidden: number } {
  return { shown: rows.slice(0, limit), hidden: Math.max(0, rows.length - limit) };
}

export interface ShapeProblem {
  field: string;
  message: string;
}

const MAX_TEXT = 2000;
const MAX_LIST = 200;
const MAX_SERIES = 2_000;

/** Most atoms a shared result may hold (POST /api/share refuses more). */
export const MAX_SHARED_ATOMS = 50_000;
/** One element symbol as the parsers and the backend write it. */
export const ELEMENT_SYMBOL = /^[A-Z][a-z]?$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFinite_ = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.length <= max;
const isTextList = (v: unknown): boolean =>
  Array.isArray(v) && v.length <= MAX_LIST && v.every((t) => isText(t));
const isVec3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(isFinite_);
/** A list of finite 3-vectors, of length `n` when `n` is given. */
const isVec3List = (v: unknown, n?: number): boolean =>
  Array.isArray(v) && v.length <= MAX_SHARED_ATOMS && (n === undefined || v.length === n) && v.every(isVec3);
const isElementList = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && v.length <= MAX_SHARED_ATOMS && v.every((s) => typeof s === "string" && ELEMENT_SYMBOL.test(s));
const absent = (v: unknown): boolean => v === undefined || v === null;

const PARAM_NUMBERS = [
  "temperature", "pressure", "timeStep", "friction", "mdSteps", "forceThreshold", "maxOptSteps", "seed",
  "optSteps", "finalFmax", "temperatureDegreesOfFreedom", "trajectoryStride", "nptThermostatTimeFs",
  "nptBarostatTimeFs", "nptBulkModulusGPa",
] as const;
const PARAM_TEXT = [
  "calculationType", "modelType", "modelSize", "precision", "device", "requestedDevice", "mdEnsemble",
  "customModelName", "upstreamModel", "license",
] as const;
const PARAM_FLAGS = ["dispersion", "converged", "comMomentumRemoved"] as const;
const PROVENANCE_TEXT: readonly (readonly string[])[] = [
  ["paramsRef"], ["model", "type"], ["model", "size"], ["model", "checkpoint", "filename"],
  ["model", "checkpoint", "resolvedBy"], ["input", "filename"], ["input", "format"], ["input", "formula"],
  ["input", "structureHashSpec"], ["runtime", "device"], ["runtime", "precision"], ["runtime", "python"],
  ["runtime", "platform"], ["runtime", "executable"],
];
const PROVENANCE_NUMBERS: readonly (readonly string[])[] = [
  ["schemaVersion"], ["model", "checkpoint", "sizeBytes"], ["input", "nAtoms"], ["runtime", "seed"],
];
const SERIES = ["energies", "potentialEnergies", "kineticEnergies", "totalEnergies", "temperatures", "step"] as const;

function bad(field: string, message: string): ShapeProblem {
  return { field, message };
}

/** Plain JSON tree of bounded depth and width whose leaves are renderable. */
function checkTree(value: unknown, field: string, depth: number): ShapeProblem | null {
  if (value === null || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : bad(field, "must be a finite number.");
  if (typeof value === "string") return value.length <= MAX_TEXT ? null : bad(field, "is too long.");
  if (Array.isArray(value)) {
    if (depth > 4 || value.length > MAX_LIST) return bad(field, "is too large.");
    for (const item of value) {
      const problem = checkTree(item, field, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (depth > 4 || keys.length > 60) return bad(field, "is too large.");
    for (const key of keys) {
      const problem = checkTree(value[key], `${field}.${key}`, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  return bad(field, "has an unsupported value.");
}

function checkProvenance(prov: unknown): ShapeProblem | null {
  const f = "result.provenance";
  if (!isObject(prov)) return bad(f, "must be an object.");
  const tree = checkTree(prov, f, 0);
  if (tree) return tree;
  if (!absent(prov.timestampUtc) && !(isText(prov.timestampUtc) && ISO_UTC_PATTERN.test(prov.timestampUtc))) {
    return bad(`${f}.timestampUtc`, "must be an ISO-8601 UTC timestamp.");
  }
  const sub = (o: unknown, key: string): Record<string, unknown> | undefined => {
    const v = isObject(o) ? o[key] : undefined;
    return isObject(v) ? v : undefined;
  };
  const model = sub(prov, "model");
  if (!absent(prov.model) && !model) return bad(`${f}.model`, "must be an object.");
  const checkpoint = sub(model, "checkpoint");
  if (model && !absent(model.checkpoint) && !checkpoint) return bad(`${f}.model.checkpoint`, "must be an object.");
  const hashes: [string, unknown][] = [
    [`${f}.model.checkpoint.sha256`, checkpoint?.sha256],
    [`${f}.input.fileSha256`, sub(prov, "input")?.fileSha256],
    [`${f}.input.structureSha256`, sub(prov, "input")?.structureSha256],
  ];
  for (const [field, hash] of hashes) {
    if (!absent(hash) && !(isText(hash) && SHA256_PATTERN.test(hash))) return bad(field, "must be a SHA-256 hex digest.");
  }
  const commit = sub(prov, "code")?.gitCommit;
  if (!absent(commit) && !(isText(commit) && GIT_COMMIT_PATTERN.test(commit))) {
    return bad(`${f}.code.gitCommit`, "must be a hexadecimal git commit.");
  }
  if (!absent(prov.notes) && !isTextList(prov.notes)) return bad(`${f}.notes`, "must be a list of short strings.");

  // Every leaf the Provenance card prints is text, a number or a flag, never a
  // group: an object there is not a React child, and it did not render (D164).
  for (const group of ["input", "runtime", "code", "packages"] as const) {
    if (!absent(prov[group]) && !isObject(prov[group])) return bad(`${f}.${group}`, "must be an object.");
  }
  const leaf = (path: readonly string[]): unknown => path.reduce<unknown>((o, key) => (isObject(o) ? o[key] : undefined), prov);
  for (const path of PROVENANCE_TEXT) {
    if (!absent(leaf(path)) && !isText(leaf(path))) return bad(`${f}.${path.join(".")}`, "must be short text.");
  }
  for (const path of PROVENANCE_NUMBERS) {
    if (!absent(leaf(path)) && !isFinite_(leaf(path))) return bad(`${f}.${path.join(".")}`, "must be a finite number.");
  }
  if (!absent(leaf(["code", "gitDirty"])) && typeof leaf(["code", "gitDirty"]) !== "boolean") {
    return bad(`${f}.code.gitDirty`, "must be true or false.");
  }
  if (isObject(prov.packages)) {
    for (const [name, version] of Object.entries(prov.packages)) {
      if (!absent(version) && !isText(version)) return bad(`${f}.packages.${name}`, "must be short text.");
    }
  }
  return null;
}

function checkValidation(v: unknown): ShapeProblem | null {
  const f = "result.validation";
  if (!isObject(v)) return bad(f, "must be an object.");
  if (v.status !== "ran" && v.status !== "unavailable") return bad(`${f}.status`, 'must be "ran" or "unavailable".');
  if (!absent(v.valid) && typeof v.valid !== "boolean") return bad(`${f}.valid`, "must be true or false.");
  for (const key of ["issues", "warnings", "info"] as const) {
    if (!absent(v[key]) && !isTextList(v[key])) return bad(`${f}.${key}`, "must be a list of short strings.");
  }
  for (const key of ["source", "policy", "unavailableReason"] as const) {
    if (!absent(v[key]) && !isText(v[key])) return bad(`${f}.${key}`, "must be short text.");
  }
  if (!absent(v.params)) {
    if (!isObject(v.params)) return bad(`${f}.params`, "must be an object.");
    if (!absent(v.params.valid) && typeof v.params.valid !== "boolean") return bad(`${f}.params.valid`, "must be true or false.");
    for (const key of ["issues", "warnings"] as const) {
      if (!absent(v.params[key]) && !isTextList(v.params[key])) return bad(`${f}.params.${key}`, "must be a list of short strings.");
    }
  }
  return null;
}

/**
 * Shape check for everything MACE Link renders that is not coordinates: text,
 * provenance, validation, parameters, properties and trajectory series. The
 * stored row is public and permanent and any client can post one, so the page
 * must not be able to be broken, or made to assert a hash, a commit link or a
 * validator verdict, by a value the backend never produces. Returns the first
 * problem, or null. `atomCount` is the length of `result.symbols`.
 */
export function checkSharedResultShape(r: Record<string, unknown>, atomCount: number): ShapeProblem | null {
  if (!absent(r.message) && !isText(r.message, 4000)) return bad("result.message", "must be short text.");
  if (!absent(r.licenseNotice) && !isText(r.licenseNotice)) return bad("result.licenseNotice", "must be short text.");
  if (!absent(r.warnings) && !isTextList(r.warnings)) return bad("result.warnings", "must be a list of short strings.");
  if (!absent(r.converged) && typeof r.converged !== "boolean") return bad("result.converged", "must be true or false.");
  for (const key of ["timeTaken", "referenceEnergy", "clientRoundTrip"] as const) {
    if (!absent(r[key]) && !isFinite_(r[key])) return bad(`result.${key}`, "must be a finite number.");
  }

  const stoppedOk = (v: unknown) =>
    absent(v) || (isObject(v) && isText(v.reason, 100) && isFinite_(v.atStep) && isFinite_(v.budgetSeconds));
  if (!stoppedOk(r.stoppedEarly)) return bad("result.stoppedEarly", "must name a reason, a step and a budget.");

  if (isObject(r.params)) {
    const p = r.params;
    for (const key of PARAM_NUMBERS) {
      if (!absent(p[key]) && !isFinite_(p[key])) return bad(`result.params.${key}`, "must be a finite number.");
    }
    for (const key of PARAM_TEXT) {
      if (!absent(p[key]) && !isText(p[key], 500)) return bad(`result.params.${key}`, "must be short text.");
    }
    for (const key of PARAM_FLAGS) {
      if (!absent(p[key]) && typeof p[key] !== "boolean") return bad(`result.params.${key}`, "must be true or false.");
    }
    if (!stoppedOk(p.stoppedEarly)) return bad("result.params.stoppedEarly", "must name a reason, a step and a budget.");
  }

  if (r.provenance !== undefined) {
    const problem = checkProvenance(r.provenance);
    if (problem) return problem;
  }
  if (r.validation !== undefined) {
    const problem = checkValidation(r.validation);
    if (problem) return problem;
  }

  if (!absent(r.lattice) && !(Array.isArray(r.lattice) && r.lattice.length === 3 && r.lattice.every(isVec3))) {
    return bad("result.lattice", "must be three finite 3-vectors.");
  }
  if (!absent(r.referenceForces) && !isVec3List(r.referenceForces)) {
    return bad("result.referenceForces", "must be a list of finite 3-vectors.");
  }
  if (r.properties !== undefined) {
    const p = r.properties;
    if (!isObject(p)) return bad("result.properties", "must be an object.");
    for (const key of ["volume", "pressure", "isolatedAtomsEnergy", "energyPerAtomVsIsolatedAtoms"] as const) {
      if (!absent(p[key]) && !isFinite_(p[key])) return bad(`result.properties.${key}`, "must be a finite number.");
    }
    if (!absent(p.stressIncludesKineticTerm) && typeof p.stressIncludesKineticTerm !== "boolean") {
      return bad("result.properties.stressIncludesKineticTerm", "must be true or false.");
    }
    if (!absent(p.stress) && !(Array.isArray(p.stress) && p.stress.length === 6 && p.stress.every(isFinite_))) {
      return bad("result.properties.stress", "must be six finite numbers.");
    }
  }

  // The page reads `trajectory.positions.length` and `.energies.length`, and the
  // player indexes `step` beside them, so a trajectory without all three lists,
  // or with lists of different lengths, is refused rather than stored (D64, D159):
  // null, {} and arrays used to be accepted and then crashed every render of the
  // link. The series are checked first so each names its own field.
  if (r.trajectory !== undefined) {
    const t = r.trajectory;
    const whole = "must hold the energies, step and positions lists of the run, one entry per frame in each.";
    if (!isObject(t)) return bad("result.trajectory", whole);
    for (const key of SERIES) {
      const series = t[key];
      if (series === undefined) continue;
      if (!Array.isArray(series) || series.length > MAX_SERIES || !series.every(isFinite_)) {
        return bad(`result.trajectory.${key}`, "must be a list of finite numbers.");
      }
    }
    if (t.positions !== undefined) {
      const frames = t.positions;
      if (
        !Array.isArray(frames) ||
        frames.length > MAX_SERIES ||
        !frames.every((frame) => Array.isArray(frame) && frame.length === atomCount && frame.every(isVec3))
      ) {
        return bad("result.trajectory.positions", "must hold one finite 3-vector per atom in every frame.");
      }
    }
    if (!isTrajectory(t)) return bad("result.trajectory", whole);
  }
  return null;
}
