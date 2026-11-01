/**
 * result-context.ts — what a stored MACE result says about itself.
 *
 * Both surfaces of a MACE Link read from this one module: the full page
 * (`shared-result-view.tsx`) and the embed (`embed/page.tsx`). A shared
 * calculation therefore cannot describe itself one way on a page and another
 * way inside someone else's iframe.
 *
 * RULES THIS MODULE FOLLOWS
 *
 *  1. Nothing is invented. Every string is built from a key that is actually
 *     present in the stored payload. A missing key yields `null` and the caller
 *     renders nothing — never a placeholder, a guess, or a default dressed up
 *     as a measurement. Results shared before a field existed simply lack it.
 *
 *  2. Every number carries its unit inline (eV, eV/atom, eV/Å, K, fs), at the
 *     same precision the results dashboard uses, because the same result is
 *     read in both places and two spellings of one number is a bug report.
 *
 *  3. Dates are formatted in UTC, by hand. These strings are produced during a
 *     server render and again during client hydration; `toLocaleDateString`
 *     resolves the host timezone, and the server's is UTC while the reader's is
 *     not — so the two passes disagree about the day near midnight. Hand
 *     formatting from `getUTC*` is identical on both sides, and the "UTC" label
 *     means the timestamp is checkable against the manifest below it.
 *
 *  4. Effective parameters beat requested ones. `result.params` is what the
 *     backend actually ran (defaults resolved, CUDA→CPU fallback applied, MD
 *     seed recorded — CLAUDE.md, "Results must be self-describing").
 *     `SharedResult.params` is only what the browser asked for.
 */

import { findModel } from "@/lib/contract";
import { stopCause } from "@/components/calculate/run-outcome";
import type {
  CalculationParams,
  CalculationResult,
  SharedResult,
} from "@/types/mace";

// ---------------------------------------------------------------------------
// Display precision — mirrors components/calculate/metrics-dashboard.tsx
// ---------------------------------------------------------------------------

/** eV — total energy. */
const EV_DECIMALS = 4;
/** eV/atom. */
const EV_PER_ATOM_DECIMALS = 4;
/** eV/Å — force thresholds and residual max force. */
const FORCE_DECIMALS = 4;

/**
 * The DFT (or DFT-like) reference each foundation model was fit to.
 *
 * DUPLICATED, knowingly: the canonical table is `ENERGY_CONVENTIONS` in
 * components/calculate/metrics-dashboard.tsx, which does not export it and
 * which this piece is not allowed to edit. The wording is kept character-for-
 * character identical so the two never contradict each other on screen. If one
 * changes, change both.
 *
 * Why it belongs on a shared page at all: a MACE-MP-0 total energy and a
 * MACE-OFF total energy are not comparable numbers (CLAUDE.md, "Energy
 * Reference Conventions"), and someone arriving from a link has no way to know
 * which convention they are looking at unless it is stated.
 */
const CONVENTION_LABELS: Record<string, string> = {
  mp: "PBE(+U) DFT reference",
  off: "ωB97M-D3BJ reference",
};

function conventionLabel(modelType: string): string | null {
  const model = findModel(modelType);
  return model ? (CONVENTION_LABELS[model.energyConvention] ?? null) : null;
}

const CALCULATION_LABELS: Record<string, string> = {
  "single-point": "Single-point energy",
  "geometry-opt": "Geometry optimization",
  "molecular-dynamics": "Molecular dynamics",
  // Rejected by the backend, so no stored result should carry it. Mapped anyway
  // so a payload that somehow does is labelled rather than left blank.
  phonon: "Phonon calculation",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// ---------------------------------------------------------------------------
// Formatting primitives
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "10 Aug 2026 UTC", or null when the input is not a parseable timestamp. */
export function formatUtcDay(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "10 Aug 2026 14:08 UTC", or null when the input is not parseable. */
export function formatUtcMinute(iso?: string | null): string | null {
  const day = formatUtcDay(iso);
  if (!day || !iso) return null;
  const d = new Date(iso);
  return `${day} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/**
 * Hill notation from the element list: C first, then H, then the rest
 * alphabetically. Returns null when the result carries no symbols (nothing to
 * name), so callers fall back rather than printing an empty formula.
 */
export function formulaFromSymbols(symbols?: string[]): string | null {
  if (!symbols?.length) return null;

  const counts = new Map<string, number>();
  for (const raw of symbols) {
    const el = String(raw).trim();
    if (!el) continue;
    counts.set(el, (counts.get(el) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const rest = [...counts.keys()]
    .filter((el) => el !== "C" && el !== "H")
    .sort();
  const order = counts.has("C") ? ["C", "H", ...rest] : ["H", ...rest].sort();

  return order
    .filter((el) => counts.has(el))
    .map((el) => {
      const n = counts.get(el)!;
      return n > 1 ? `${el}${n}` : el;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/**
 * The parameters the run actually used, with the request as a fallback for
 * anything the backend of the day did not echo back.
 */
export function effectiveParams(
  shared: SharedResult,
): Partial<CalculationParams> {
  return { ...(shared.params ?? {}), ...(shared.result?.params ?? {}) };
}

/**
 * Physical settings worth stating on a page with no other context, each with
 * its unit. Only keys present in the payload appear.
 */
function settingChips(params: Partial<CalculationParams>): string[] {
  const chips: string[] = [];

  if (params.mdEnsemble) chips.push(params.mdEnsemble);
  if (params.temperature != null) chips.push(`${params.temperature} K`);
  if (params.pressure != null) chips.push(`${params.pressure} GPa`);
  if (params.timeStep != null) chips.push(`Δt ${params.timeStep} fs`);
  if (params.mdSteps != null) chips.push(`${params.mdSteps} MD steps`);
  if (params.friction != null) chips.push(`friction ${params.friction} /fs`);
  if (params.seed != null) chips.push(`seed ${params.seed}`);
  if (params.forceThreshold != null) {
    chips.push(`fmax ${params.forceThreshold} eV/Å`);
  }
  if (params.maxOptSteps != null) chips.push(`max ${params.maxOptSteps} steps`);
  if (params.precision) chips.push(params.precision);
  if (params.device) chips.push(params.device);
  if (params.dispersion) chips.push("D3 dispersion");

  return chips;
}

/**
 * Whether a geometry optimization reached its force threshold — and, when it
 * did not, the residual force that proves it did not.
 *
 * A run that exhausted `maxOptSteps` is not a relaxed minimum (CLAUDE.md,
 * "Geometry Optimization"), and a shared link is exactly where that gets
 * forgotten. Null for every other calculation type and for results stored
 * before the backend reported convergence.
 */
function convergenceNote(
  result: CalculationResult,
  params: Partial<CalculationParams>,
): string | null {
  if (params.calculationType !== "geometry-opt") return null;

  const converged = result.converged ?? params.converged;
  if (converged == null) return null;

  const fmax =
    params.finalFmax != null
      ? `${params.finalFmax.toFixed(FORCE_DECIMALS)} eV/Å`
      : null;
  const steps = params.optSteps != null ? `${params.optSteps} BFGS steps` : null;
  const detail = [steps, fmax ? `max force ${fmax}` : null]
    .filter(Boolean)
    .join(", ");

  const head = converged
    ? "Converged to the force threshold"
    : stopCause(result) === "time-budget"
      ? "Stopped at the deployment's time budget without reaching the force threshold — not a relaxed minimum"
      : "Stopped at the step ceiling without reaching the force threshold — not a relaxed minimum";

  return detail ? `${head} (${detail})` : head;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface ResultSummary {
  /** "Single-point energy — C2H6O", degrading to whatever is known. */
  headline: string;
  /** Chemical formula in Hill notation, or the stored filename, or null. */
  subject: string | null;
  /** Human label for `calculationType`, or null when it was not stored. */
  calculation: string | null;
  atomCount: number | null;
  /** "-4204.7891 eV" — total energy with its unit. */
  energy: string | null;
  /** "-467.1988 eV/atom". */
  energyPerAtom: string | null;
  /** "MACE-OFF (small)". */
  model: string | null;
  /** "ωB97M-D3BJ reference" — null for custom or unrecognised models. */
  convention: string | null;
  /** When the numbers were produced, from the provenance manifest. */
  computedUtc: string | null;
  /** When the link was created, from the database row. Always present. */
  sharedUtc: string | null;
  /** Physical settings, each carrying its unit. */
  settings: string[];
  /** Geometry-opt convergence statement, or null. */
  convergence: string | null;
  status: CalculationResult["status"] | null;
  /** SHA-256 of the checkpoint that was actually loaded, when recorded. */
  checkpointSha: string | null;
  /** True when a reproducibility manifest is attached to this result. */
  hasProvenance: boolean;
  /** True when validator findings are attached to this result. */
  hasValidation: boolean;
}

/**
 * Everything a reader arriving from a bare link needs in order to know what
 * they are looking at, derived only from what was stored.
 */
export function summarizeShared(shared: SharedResult): ResultSummary {
  const result = shared.result ?? ({} as CalculationResult);
  const params = effectiveParams(shared);
  const provenance = result.provenance;

  const formula =
    formulaFromSymbols(result.symbols) ?? provenance?.input?.formula ?? null;
  const subject = formula ?? shared.filename ?? null;

  const calculation = params.calculationType
    ? (CALCULATION_LABELS[params.calculationType] ?? params.calculationType)
    : null;

  const atomCount =
    result.symbols?.length ?? provenance?.input?.nAtoms ?? null;

  const energy =
    result.energy != null ? `${result.energy.toFixed(EV_DECIMALS)} eV` : null;
  const energyPerAtom =
    result.energy != null && atomCount != null && atomCount > 0
      ? `${(result.energy / atomCount).toFixed(EV_PER_ATOM_DECIMALS)} eV/atom`
      : null;

  const model = params.modelType
    ? params.modelSize
      ? `${params.modelType} (${params.modelSize})`
      : params.modelType
    : null;
  const convention = params.modelType
    ? conventionLabel(params.modelType)
    : null;

  const headline = calculation
    ? subject
      ? `${calculation} — ${subject}`
      : calculation
    : (subject ?? "Shared MACE result");

  return {
    headline,
    subject,
    calculation,
    atomCount,
    energy,
    energyPerAtom,
    model,
    convention,
    computedUtc: formatUtcMinute(provenance?.timestampUtc),
    sharedUtc: formatUtcDay(shared.created_at),
    settings: settingChips(params),
    convergence: convergenceNote(result, params),
    status: result.status ?? null,
    checkpointSha: provenance?.model?.checkpoint?.sha256 ?? null,
    hasProvenance: !!provenance,
    hasValidation: !!result.validation,
  };
}

/** True when the payload has the coordinates the 3D viewer needs. */
export function hasStructure(result?: CalculationResult): boolean {
  return !!result?.positions?.length && !!result?.symbols?.length;
}
