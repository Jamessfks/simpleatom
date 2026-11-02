/**
 * Which parameters describe a finished run, and which of the form's values a
 * result may borrow.
 *
 * Kept out of app/calculate/page.tsx: a Next.js page may export nothing but its
 * default component, so a function in the page cannot be imported by a test.
 */

import type { CalculationParams, CalculationType } from "@/types/mace";

/**
 * Parameters that describe EVERY run, whatever its type.
 *
 * `customModelName` is here because a custom checkpoint is part of the model
 * identity regardless of what was computed with it.
 */
export const COMMON_PARAM_KEYS = [
  "calculationType",
  "modelType",
  "modelSize",
  "precision",
  "device",
  "dispersion",
  "customModelName",
] as const satisfies readonly (keyof CalculationParams)[];

/**
 * Parameters that only mean something for a given calculation type.
 *
 * A single-point has no timestep, no thermostat and no convergence criterion —
 * the backend never reads those keys on that path, so printing them describes
 * a run that did not happen. This table is what stops the client form state
 * (which always holds every field, defaults included) from leaking into the
 * displayed configuration.
 *
 * Kept deliberately in step with what `mace-api/calculate.py` puts into
 * `effective_params`: `_run_geometry_opt` adds forceThreshold/maxOptSteps and
 * the convergence outcome; `_run_md` adds temperature/timeStep/mdSteps/
 * mdEnsemble/seed and comMomentumRemoved, and friction for NVT only. `pressure` is the one MD
 * input the backend does not echo (it is read straight into the NPT
 * integrator), so the client copy is the only record of it.
 */
export const PARAM_KEYS_BY_CALC_TYPE: Record<
  CalculationType,
  readonly (keyof CalculationParams)[]
> = {
  "single-point": [],
  "geometry-opt": ["forceThreshold", "maxOptSteps", "converged", "optSteps", "finalFmax"],
  "molecular-dynamics": [
    "temperature",
    "pressure",
    "timeStep",
    "friction",
    "mdSteps",
    "mdEnsemble",
    "seed",
    "comMomentumRemoved",
  ],
  // No backend implementation — a phonon request is rejected, never run, so
  // there is no configuration to describe. See CLAUDE.md.
  phonon: [],
};

/**
 * The configuration to DISPLAY for a finished run.
 *
 * The backend echo (`result.params`) is the source of truth: it is a small
 * allow-list of the parameters that were actually effective, with defaults
 * resolved, the CUDA→CPU fallback applied, `dispersion` true only if a D3
 * calculator was really built, and `precision` read back off the loaded model.
 * It wins on every key it carries.
 *
 * Client form state is only consulted for keys the backend does not echo, and
 * only after filtering to the calculation type that actually ran — so a
 * single-point can no longer render a temperature, a timestep, a friction
 * coefficient, an ensemble or an fmax target. When the echo is missing
 * entirely (an older backend, or a remote API that predates it) the filtered
 * request is all there is, and it is at least type-consistent.
 */
export function effectiveRunParams(
  requested: CalculationParams,
  echoed: Partial<CalculationParams> | undefined,
): Partial<CalculationParams> {
  const ranType = echoed?.calculationType ?? requested.calculationType;
  const allowed = new Set<keyof CalculationParams>([
    ...COMMON_PARAM_KEYS,
    ...(PARAM_KEYS_BY_CALC_TYPE[ranType] ?? []),
  ]);

  // Pressure is an input to the NPT integrator alone. On NVT/NVE nothing reads
  // it, so "0 GPa" would state a constraint that was never imposed.
  const ensemble = echoed?.mdEnsemble ?? requested.mdEnsemble;
  if (ensemble !== "NPT") allowed.delete("pressure");
  // Friction is read by the Langevin thermostat alone, which only NVT builds
  // (D55). The form's default 0.005 must not be merged back in for NVE or NPT.
  if (ensemble !== "NVT") allowed.delete("friction");

  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = requested[key];
    if (value !== undefined) filtered[key] = value;
  }

  const merged: Partial<CalculationParams> = { ...(filtered as Partial<CalculationParams>), ...(echoed ?? {}) };
  // An echo from a backend that predates D55 carries friction for every MD
  // ensemble; for NVE and NPT it describes a thermostat that was never built.
  if (ensemble !== "NVT") delete merged.friction;
  return merged;
}
