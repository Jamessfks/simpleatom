"use client";

/**
 * "What will run" — the calculator's run ledger.
 *
 * SimpleAtom's results say what actually ran (the backend echoes effective
 * parameters, the loaded checkpoint and its licence). This states the same
 * things BEFORE the run, so the button press is an informed one: the
 * structure, the model and its licence, the precision and why, the
 * calculation's key settings with their units, and whether the job fits this
 * deployment's limits. Every value is derived from the form and the contract;
 * nothing here is a promise the backend does not make.
 */

import { useState } from "react";
import { findModel } from "@/lib/contract";
import type { Capabilities } from "@/lib/use-capabilities";
import type { ParsedStructure } from "@/lib/parse-structure";
import type { CalculationParams } from "@/types/mace";
import { Formula } from "@/components/ui/formula";

interface RunLedgerProps {
  params: CalculationParams;
  structure: ParsedStructure | null;
  filename?: string;
  customModelName?: string;
  caps: Capabilities;
  /**
   * Once a result is on screen the full ledger would push it below the fold,
   * so it folds to one summary line (expandable). The line still tracks the
   * form, so it always describes the run the button will start.
   */
  compact?: boolean;
  children: React.ReactNode;
}

const CALC_LABELS: Record<string, string> = {
  "single-point": "Single-point energy and forces",
  "geometry-opt": "Geometry optimisation (BFGS)",
  "molecular-dynamics": "Molecular dynamics",
};

/** The dtype the backend will pick when precision is left on Auto. */
function effectivePrecision(params: CalculationParams): { dtype: string; why: string } {
  if (params.precision) return { dtype: params.precision, why: "chosen explicitly" };
  if (params.modelType === "custom") return { dtype: "checkpoint's own", why: "a custom model keeps its saved dtype" };
  if (findModel(params.modelType)?.upstreamDefaultDtype === "float64") {
    return { dtype: "float64", why: "upstream default for this model" };
  }
  if (params.calculationType === "geometry-opt") {
    return { dtype: "float64", why: "upstream recommends it for optimisation" };
  }
  return { dtype: "float32", why: "upstream default; fastest" };
}

function settingsLine(params: CalculationParams): string | null {
  if (params.calculationType === "geometry-opt") {
    return `fmax ${params.forceThreshold ?? 0.05} eV/Å, at most ${params.maxOptSteps ?? 500} steps`;
  }
  if (params.calculationType === "molecular-dynamics") {
    const ensemble = params.mdEnsemble ?? "NVT";
    const pressure = ensemble === "NPT" ? `, ${params.pressure ?? 0} GPa` : "";
    return `${ensemble}, ${params.temperature ?? 300} K${pressure}, ${params.mdSteps ?? 100} steps of ${params.timeStep ?? 1} fs`;
  }
  return null;
}

/** A reason the backend will refuse this job on this deployment, if any. */
function limitProblem(params: CalculationParams, structure: ParsedStructure | null, caps: Capabilities): string | null {
  if (!structure) return null;
  const calc = params.calculationType as keyof Capabilities["limits"]["maxAtoms"];
  const maxAtoms = caps.limits.maxAtoms?.[calc];
  if (typeof maxAtoms === "number" && structure.atomCount > maxAtoms) {
    return `${structure.atomCount} atoms is over this deployment's limit of ${maxAtoms} for this calculation. Run SimpleAtom locally for larger systems.`;
  }
  const steps = params.calculationType === "molecular-dynamics" ? params.mdSteps : params.calculationType === "geometry-opt" ? params.maxOptSteps : undefined;
  const atomSteps = caps.limits.maxAtomSteps?.[calc as keyof Capabilities["limits"]["maxAtomSteps"]];
  if (typeof steps === "number" && typeof atomSteps === "number" && structure.atomCount * steps > atomSteps) {
    return `${structure.atomCount} atoms × ${steps} steps is over this deployment's limit of ${atomSteps.toLocaleString("en-US")} atom-steps. Reduce the steps, or run locally.`;
  }
  return null;
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-2.5 first:pt-0 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-x-4">
      <dt className="text-sm text-[var(--color-text-muted)]">{term}</dt>
      <dd className="min-w-0 text-sm text-[var(--color-text-primary)]">{children}</dd>
    </div>
  );
}

export function RunLedger({ params, structure, filename, customModelName, caps, compact = false, children }: RunLedgerProps) {
  const [expanded, setExpanded] = useState(false);
  const model = findModel(params.modelType);
  const precision = effectivePrecision(params);
  const settings = settingsLine(params);
  const problem = limitProblem(params, structure, caps);

  if (compact && structure && !expanded) {
    const modelText = params.modelType === "custom"
      ? customModelName || "custom checkpoint"
      : `${model?.label ?? params.modelType} ${params.modelSize}`;
    const calc = (CALC_LABELS[params.calculationType] ?? params.calculationType).toLowerCase();
    return (
      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Next run</h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
              <Formula text={structure.empiricalFormula} /> ({structure.atomCount} atoms), {modelText}, {calc},{" "}
              <span className="font-mono">{precision.dtype}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 sm:w-72">
            <div className="min-w-0 flex-1">{children}</div>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="min-h-11 shrink-0 rounded-full px-3 text-sm font-medium text-[var(--color-accent-strong)] hover:bg-[var(--color-accent-soft)]"
            >
              Details
            </button>
          </div>
        </div>
        {problem && (
          <p role="status" className="mt-3 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-sm text-[var(--color-text-primary)]">
            {problem}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="ledger rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-xl font-semibold text-[var(--color-text-primary)]">What will run</h2>
        {compact && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="min-h-11 rounded-full px-3 text-sm font-medium text-[var(--color-accent-strong)] hover:bg-[var(--color-accent-soft)]"
          >
            Hide details
          </button>
        )}
      </div>

      {structure ? (
        <dl className="mt-4 divide-y divide-[var(--color-border-subtle)]">
          <Row term="Structure">
            <span className="font-medium"><Formula text={structure.empiricalFormula} /></span>
            <span className="text-[var(--color-text-secondary)]">
              , {structure.atomCount} atoms, {structure.isPeriodic ? "periodic cell" : "isolated molecule"}
            </span>
            {filename && <span className="block truncate text-xs text-[var(--color-text-muted)]">{filename}</span>}
          </Row>
          <Row term="Model">
            {params.modelType === "custom" ? (
              <span>{customModelName || "Custom checkpoint"}</span>
            ) : (
              <>
                <span className="font-medium">{model?.label ?? params.modelType}</span>
                <span className="text-[var(--color-text-secondary)]">, {params.modelSize}</span>
                {model?.levelOfTheory && (
                  <span className="block text-xs text-[var(--color-text-muted)]">Trained on {model.levelOfTheory}</span>
                )}
                {model?.license.notice && (
                  <span className="mt-1 block text-xs text-[var(--color-warning)]">
                    {model.license.id}: non-commercial use only.
                  </span>
                )}
              </>
            )}
          </Row>
          <Row term="Calculation">
            {CALC_LABELS[params.calculationType] ?? params.calculationType}
            {settings && <span className="block font-mono text-xs text-[var(--color-text-secondary)]">{settings}</span>}
          </Row>
          <Row term="Precision">
            <span className="font-mono">{precision.dtype}</span>
            <span className="text-[var(--color-text-secondary)]"> ({precision.why})</span>
          </Row>
        </dl>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Choose a structure to begin: upload a file, pick one from the catalog, or type a SMILES
          string. This panel then shows exactly what will be computed before you run it.
        </p>
      )}

      {problem && (
        <p role="status" className="mt-4 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-sm text-[var(--color-text-primary)]">
          {problem}
        </p>
      )}

      <div className="mt-5">{children}</div>
    </div>
  );
}
