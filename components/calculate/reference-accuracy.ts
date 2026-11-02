import type { CalculationResult } from "@/types/mace";

/**
 * "Model accuracy": the model's prediction against the reference energy and
 * forces an uploaded file carries (REF_energy, REF_forces, or the `energy` and
 * `forces` an ASE-written file has).
 *
 * That reference data describes the INPUT geometry. A single point is computed
 * there, so its energy and forces are comparable. A geometry optimisation or an
 * MD run returns the forces of the FINAL geometry, and comparing them with the
 * input's reference scored the geometry change as model error (D90): a model
 * identical to its reference showed a force MAE of 1715.8 meV/Å after an
 * optimisation. So for those runs
 *   - forces are never compared (the result keeps no forces at the input), and
 *   - the energy is compared with the model's energy at step 0, which the
 *     trajectory records and which IS the input geometry.
 * `note` says so in a sentence the card shows.
 */
export type ReferenceBasis = "final-geometry" | "input-geometry";

export interface ReferenceAccuracy {
  /** Which geometry the prediction is for: the run's own result, or only its input (step 0). */
  basis: ReferenceBasis;
  /** meV/Å */
  forceMAE: number | null;
  forceRMSE: number | null;
  maxForceError: number | null;
  /** meV/atom */
  energyMAE: number | null;
  /** Predicted − reference, eV. */
  energyError: number | null;
  /** Predicted − reference, eV/atom. */
  energyErrorPerAtom: number | null;
  /** The energy that was compared with the reference (eV); null when none could be. */
  predictedEnergy: number | null;
  /** Why the comparison is limited, when it is; null for an ordinary single-point comparison. */
  note: string | null;
}

const INPUT_GEOMETRY_NOTE =
  "The reference data describes the input geometry, not the structure this run ended at.";

/**
 * Whether `result` is a single point. Results shared before v2.2 carry no
 * `params`; one with a trajectory can only have come from an optimisation or MD
 * run, one without is read as a single point.
 */
function isSinglePoint(result: CalculationResult): boolean {
  const type = result.params?.calculationType;
  if (type !== undefined) return type === "single-point";
  return !result.trajectory;
}

export function referenceAccuracy(result: CalculationResult): ReferenceAccuracy {
  const out: ReferenceAccuracy = {
    basis: "final-geometry",
    forceMAE: null,
    forceRMSE: null,
    maxForceError: null,
    energyMAE: null,
    energyError: null,
    energyErrorPerAtom: null,
    predictedEnergy: null,
    note: null,
  };

  const hasReference = !!result.referenceForces?.length || result.referenceEnergy != null;
  const atomCount = result.symbols?.length ?? 0;

  let predictedEnergy: number | null = result.energy ?? null;
  if (!isSinglePoint(result)) {
    out.basis = "input-geometry";
    // Frame 0 of a trajectory is the input geometry (the optimiser's first
    // observer call, MD's step 0). A trajectory that starts later is not.
    const traj = result.trajectory;
    predictedEnergy =
      traj && traj.step?.[0] === 0 && Array.isArray(traj.energies) && traj.energies.length > 0
        ? traj.energies[0]
        : null;
    if (hasReference) {
      out.note =
        predictedEnergy != null && result.referenceEnergy != null
          ? `${INPUT_GEOMETRY_NOTE} The energy is compared with the model's energy at step 0, the input structure. ` +
            "Forces are not recorded at the input geometry, so no force error is shown; run a single point to compare forces."
          : `${INPUT_GEOMETRY_NOTE} Run a single point to compare the model with it.`;
    }
  } else {
    const ref = result.referenceForces;
    const pred = result.forces;
    if (ref && pred && ref.length === pred.length) {
      let sumAbs = 0;
      let sumSq = 0;
      let maxAbs = 0;
      let count = 0;
      for (let i = 0; i < ref.length; i++) {
        for (let c = 0; c < 3; c++) {
          const err = pred[i][c] - ref[i][c];
          sumAbs += Math.abs(err);
          sumSq += err * err;
          maxAbs = Math.max(maxAbs, Math.abs(err));
          count++;
        }
      }
      if (count > 0) {
        out.forceMAE = (sumAbs / count) * 1000;
        out.forceRMSE = Math.sqrt(sumSq / count) * 1000;
        out.maxForceError = maxAbs * 1000;
      }
    }
  }

  // CalculationResult carries one (predicted, reference) energy pair, so no R²
  // is defined; the signed error is reported instead.
  if (predictedEnergy != null && result.referenceEnergy != null) {
    out.predictedEnergy = predictedEnergy;
    const error = predictedEnergy - result.referenceEnergy;
    out.energyError = error;
    if (atomCount > 0) {
      out.energyMAE = (Math.abs(error) / atomCount) * 1000;
      out.energyErrorPerAtom = error / atomCount;
    }
  }
  return out;
}
