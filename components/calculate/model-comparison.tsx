"use client";

/**
 * ModelComparison — Side-by-side comparison of custom vs. foundation model.
 *
 * When a user runs a calculation with a custom model, this component offers
 * a "Compare with Foundation Model" button. It displays:
 *   - Side-by-side energy/force metrics, naming the foundation model that ran
 *   - The RMS difference between the two models' forces
 *   - An energy difference only when both energies share a reference convention
 *   - Radar chart comparison (if reference data is present)
 *
 * The comparison runs the same structure through the foundation model
 * and compares results (see ./comparison for what may be compared).
 */

import { useState } from "react";
import {
  GitCompareArrows,
  Loader2,
} from "lucide-react";
import { computeRmsForce } from "@/lib/utils";
import { summariseComparison } from "./comparison";
import { referenceAccuracy } from "./reference-accuracy";
import { RadarComparison, type ModelMetrics } from "./charts/radar-comparison";
import { Button } from "@/components/ui/button";
import type { CalculationResult } from "@/types/mace";

interface ModelComparisonProps {
  /** Results from the custom model calculation. */
  customResult: CalculationResult;
  /** Label for the custom model. */
  customModelName: string;
  /** Callback to request a foundation model calculation on the same structure. */
  onRunFoundation: () => Promise<CalculationResult | null>;
}

export function ModelComparison({
  customResult,
  customModelName,
  onRunFoundation,
}: ModelComparisonProps) {
  const [foundationResult, setFoundationResult] = useState<CalculationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCompare = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await onRunFoundation();
      if (result) {
        setFoundationResult(result);
      } else {
        setError("Foundation model calculation failed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setLoading(false);
    }
  };

  if (!foundationResult) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-secondary p-5">
        <div className="flex items-center gap-3 mb-3">
          <GitCompareArrows className="h-5 w-5 text-accent-strong" strokeWidth={1.75} />
          <h3 className="font-sans text-sm font-bold text-text-primary">
            Model Comparison
          </h3>
        </div>
        <p className="mb-4 text-xs text-text-muted">
          Compare your custom model ({customModelName}) against the MACE
          foundation model on the same structure.
        </p>
        {error && (
          <p className="mb-3 text-xs text-error">{error}</p>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={handleCompare}
          disabled={loading}
          className="gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
              Running foundation model...
            </>
          ) : (
            <>
              <GitCompareArrows className="h-4 w-4" strokeWidth={1.75} />
              Compare with Foundation Model
            </>
          )}
        </Button>
      </div>
    );
  }

  const customRms = computeRmsForce(customResult.forces);
  const foundationRms = computeRmsForce(foundationResult.forces);

  const summary = summariseComparison(customResult, foundationResult);
  const { foundationLabel } = summary;

  const radarA = buildRadarMetrics(customModelName, customResult);
  const radarB = buildRadarMetrics(foundationLabel, foundationResult);
  const hasReference =
    !!customResult.referenceForces?.length && customResult.referenceEnergy != null;

  return (
    <div className="space-y-4">
      {/* Comparison header */}
      <div
        className="rounded-lg border border-border-subtle bg-bg-secondary p-5"
        style={{
          borderLeftWidth: "4px",
          borderImage:
            "linear-gradient(to bottom, var(--color-data-blue), var(--color-data-purple)) 1",
        }}
      >
        <h3 className="mb-4 font-sans text-sm font-bold text-text-primary">
          Model Comparison: {customModelName} vs. {foundationLabel}
        </h3>

        {/* Side-by-side metrics */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Custom model */}
          <div className="rounded border border-data-blue/30 bg-data-blue/5 p-4">
            <h4 className="mb-2 font-mono text-xs font-bold text-data-blue">
              {customModelName}
            </h4>
            <div className="space-y-1 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-text-muted">Energy</span>
                <span className="text-text-primary">
                  {customResult.energy?.toFixed(6) ?? "N/A"} eV
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">RMS Force</span>
                <span className="text-text-primary">
                  {customRms?.toFixed(4) ?? "N/A"} eV/A
                </span>
              </div>
            </div>
          </div>

          {/* Foundation model */}
          <div className="rounded border border-data-purple/30 bg-data-purple/5 p-4">
            <h4 className="mb-2 font-mono text-xs font-bold text-data-purple">
              {foundationLabel}
            </h4>
            <div className="space-y-1 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-text-muted">Energy</span>
                <span className="text-text-primary">
                  {foundationResult.energy?.toFixed(6) ?? "N/A"} eV
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">RMS Force</span>
                <span className="text-text-primary">
                  {foundationRms?.toFixed(4) ?? "N/A"} eV/A
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* What can be compared. Forces have no offset, so their difference is
            always shown; an energy difference only when both energies share a
            reference convention — otherwise the reason is stated. */}
        <div className="mt-3 space-y-1 font-mono text-xs">
          {summary.forceRmsd != null && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-text-muted">RMS force difference =</span>
              <span className="font-bold text-text-primary">
                {summary.forceRmsd.toFixed(4)} eV/Å
              </span>
            </div>
          )}
          {summary.deltaEnergyPerAtom != null && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-text-muted">&Delta;E per atom =</span>
              <span className="font-bold text-text-primary">
                {(summary.deltaEnergyPerAtom * 1000).toFixed(1)} meV/atom
              </span>
              <span className="text-text-muted">
                (
                {summary.deltaEnergyPerAtom > 0
                  ? "custom higher"
                  : summary.deltaEnergyPerAtom < 0
                    ? "foundation higher"
                    : "equal"}
                )
              </span>
            </div>
          )}
          {summary.energyNote && (
            <p className="font-sans text-xs leading-relaxed text-text-secondary">
              {summary.energyNote}
            </p>
          )}
        </div>
      </div>

      {/* Radar chart (single point with reference data) */}
      {radarA && radarB && (
        <div className="rounded-lg border border-border-subtle bg-bg-secondary p-4">
          <RadarComparison
            modelA={radarA}
            modelB={radarB}
            title="Multi-Metric Comparison"
          />
        </div>
      )}
      {hasReference && !(radarA && radarB) && (
        <p className="text-xs leading-relaxed text-text-secondary">
          The uploaded reference data describes the input geometry, and this run ended at a
          different one, so neither model is scored against it. Run a single point to compare
          each model with the reference.
        </p>
      )}
    </div>
  );
}

/**
 * Radar metrics against the uploaded reference data. Only a single point is
 * scored: the reference describes the input geometry, and an optimisation or MD
 * run ends somewhere else (D90), so this returns null for those and the radar
 * is not drawn.
 */
function buildRadarMetrics(
  label: string,
  result: CalculationResult
): ModelMetrics | null {
  const acc = referenceAccuracy(result);
  if (acc.basis !== "final-geometry" || acc.forceMAE == null) return null;
  return {
    label,
    energyMAE: acc.energyMAE ?? 0,
    forceMAE: acc.forceMAE,
    forceRMSE: acc.forceRMSE ?? 0,
    maxForceError: acc.maxForceError ?? 0,
  };
}
