"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Clock,
  AlertCircle,
  Zap,
  X,
  Share2,
  Copy,
  Check,
  PenTool,
  Calculator as CalculatorIcon,
  History as HistoryIcon,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import {
  parseStructureFile,
  type ParsedStructure,
} from "@/lib/parse-structure";
import { FileUploadSection } from "@/components/calculate/file-upload-section";
import { ParameterPanel } from "@/components/calculate/parameter-panel";
import { foundationModelFor } from "@/lib/model-domain";
import { MetricsDashboard } from "@/components/calculate/metrics-dashboard";
import { ModelComparison } from "@/components/calculate/model-comparison";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type {
  CalculationParams,
  CalculationResult,
  CalculationType,
} from "@/types/mace";
import { saveResult } from "@/lib/share";
import {
  addHistory,
  clearHistory,
  getHistory,
  updateHistoryShareUrl,
  type HistoryEntry,
} from "@/lib/history";

const KetcherEditor = dynamic(
  () =>
    import("@/components/calculate/ketcher-editor").then(
      (mod) => mod.KetcherEditorInner,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[700px] items-center justify-center">
        <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-mono text-sm">Loading molecular editor…</span>
        </div>
      </div>
    ),
  },
);

// ---------------------------------------------------------------------------
// Progress phase definitions per calculation type
// ---------------------------------------------------------------------------

const PHASE_MAP: Record<string, string[]> = {
  "single-point": [
    "Parsing structure",
    "Loading MACE model",
    "Computing energy & forces",
    "Formatting results",
  ],
  "geometry-opt": [
    "Parsing structure",
    "Loading MACE model",
    "Optimizing geometry",
    "Formatting results",
  ],
  "molecular-dynamics": [
    "Parsing structure",
    "Loading MACE model",
    "Running MD simulation",
    "Collecting trajectory",
  ],
};

/** Rough estimated total time (seconds) by calculation type. */
function getEstimatedTime(calcType: string, mdSteps?: number): number {
  switch (calcType) {
    case "single-point":
      return 12;
    case "geometry-opt":
      return 50;
    case "molecular-dynamics":
      return Math.max(30, (mdSteps || 100) * 0.3);
    default:
      return 15;
  }
}

/** Estimate which phase (0-indexed) based on elapsed time ratio. */
function estimatePhase(elapsed: number, estimated: number): number {
  const ratio = elapsed / estimated;
  if (ratio < 0.08) return 0;
  if (ratio < 0.3) return 1;
  if (ratio < 0.85) return 2;
  return 3;
}

// ---------------------------------------------------------------------------
// Effective run parameters
// ---------------------------------------------------------------------------

/**
 * Parameters that describe EVERY run, whatever its type.
 *
 * `customModelName` is here because a custom checkpoint is part of the model
 * identity regardless of what was computed with it.
 */
const COMMON_PARAM_KEYS = [
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
 * the convergence outcome; `_run_md` adds temperature/timeStep/friction/
 * mdSteps/mdEnsemble/seed and comMomentumRemoved. `pressure` is the one MD
 * input the backend does not echo (it is read straight into the NPT
 * integrator), so the client copy is the only record of it.
 */
const PARAM_KEYS_BY_CALC_TYPE: Record<
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
function effectiveRunParams(
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

  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = requested[key];
    if (value !== undefined) filtered[key] = value;
  }

  return { ...(filtered as Partial<CalculationParams>), ...(echoed ?? {}) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function CalculatePage() {
  return (
    <Suspense>
      <CalculatePageInner />
    </Suspense>
  );
}

function CalculatePageInner() {
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  /**
   * Parsed form of the first uploaded structure. Feeds the parameter panel's
   * scientific guardrails — the MACE-OFF element check and the NPT
   * periodicity gate — which stay inert while this is null, so nothing warns
   * before a structure is loaded.
   */
  const [parsedStructure, setParsedStructure] =
    useState<ParsedStructure | null>(null);
  const [params, setParams] = useState<CalculationParams>({
    modelSize: "medium",
    modelType: "MACE-MP-0",
    // `precision` is deliberately absent, not "float32". Omitting the key is
    // what makes the backend take upstream MACE's own default for the chosen
    // model and calculation — float64 for MACE-OFF (mace_off() has defaulted
    // to float64 since v0.3.6) and for geometry optimization (upstream prints
    // "Use float64 for geometry optimization" on every run), float32
    // otherwise. Sending "float32" unconditionally, as this used to, silently
    // overrode both. The user can still pin a dtype in the parameter panel.
    device: "cpu",
    calculationType: "single-point",
    dispersion: false,
    temperature: 300,
    pressure: 0,
    timeStep: 1.0,
    friction: 0.005,
    mdSteps: 100,
    mdEnsemble: "NVT",
    forceThreshold: 0.05,
    maxOptSteps: 500,
  });
  const [customModelFile, setCustomModelFile] = useState<File | null>(null);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [lastHistoryId, setLastHistoryId] = useState<string | null>(null);

  // Top-level tab: "calculator" or "draw"
  const [activeTab, setActiveTab] = useState("calculator");

  // Demo mode — guided overlay steps
  const [demoStep, setDemoStep] = useState<number | null>(null);
  const searchParams = useSearchParams();

  // Keep the parsed structure in step with the uploaded file. Parse failures
  // clear it rather than surfacing here — the upload/preview components already
  // report malformed structures, and a guardrail that fires on a parse error
  // would be worse than one that stays quiet.
  useEffect(() => {
    const file = uploadedFiles[0];
    if (!file) {
      setParsedStructure(null);
      return;
    }
    let cancelled = false;
    parseStructureFile(file)
      .then((s) => {
        if (!cancelled) setParsedStructure(s);
      })
      .catch(() => {
        if (!cancelled) setParsedStructure(null);
      });
    return () => {
      cancelled = true;
    };
  }, [uploadedFiles]);

  const handleFilesChange = useCallback(
    (files: File[]) => {
      setUploadedFiles(files);
      if (
        files.length > 0 &&
        files[0].name.startsWith("smiles_") &&
        params.modelType !== "custom"
      ) {
        setParams((prev) => ({
          ...prev,
          modelType: "MACE-OFF",
          dispersion: false,
        }));
      }
    },
    [params.modelType],
  );

  const handleStructureFromEditor = useCallback(
    (files: File[]) => {
      handleFilesChange(files);
      setActiveTab("calculator");
    },
    [handleFilesChange],
  );

  const loadDemoStructure = useCallback(async () => {
    try {
      const res = await fetch("/demo/ethanol.xyz");
      const text = await res.text();
      const file = new File([text], "ethanol.xyz", { type: "text/plain" });
      setUploadedFiles([file]);
      setDemoStep(0);
    } catch {
      // silently fail if demo file not available
    }
  }, []);

  useEffect(() => {
    if (searchParams.get("demo") === "true" && uploadedFiles.length === 0) {
      loadDemoStructure();
    }
  }, [searchParams, loadDemoStructure, uploadedFiles.length]);

  useEffect(() => {
    if (!isCalculating) {
      setElapsedSeconds(0);
      return;
    }
    const start = Date.now();
    const tick = () =>
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isCalculating]);

  const isCustomModel = params.modelType === "custom";

  /**
   * Why the Run button is disabled, or null when it is not.
   *
   * "custom" with no uploaded checkpoint is a hard backend error now
   * (`validate_model_type()` in mace-api/calculate.py rejects it rather than
   * quietly loading MACE-MP-0 medium and labelling the numbers "custom"), so
   * this is no longer dangerous — but letting the user press Run to discover
   * it is a wasted round trip and an error where a sentence would do.
   */
  const runBlockedReason: string | null =
    uploadedFiles.length === 0
      ? "Choose or upload a structure to enable the run button."
      : isCustomModel && !customModelFile
        ? "Upload a MACE .model checkpoint to run a custom model — or switch to MACE-MP-0 or MACE-OFF. A foundation-model result labelled “custom” would attribute the numbers to a model that was never loaded."
        : params.calculationType === "phonon"
          ? "Phonon spectrum is not implemented. Choose single-point, geometry optimization, or molecular dynamics."
          : null;

  const handleRunFoundation =
    useCallback(async (): Promise<CalculationResult | null> => {
      if (uploadedFiles.length === 0) return null;

      // Picked from the parsed structure, never from the uploaded FILENAME:
      // a periodic crystal can be named "offcut.cif", and matching that name
      // against "off" used to send it to MACE-OFF, crossing two incompatible
      // energy conventions and printing a meaningless deltaE.
      const foundationParams: CalculationParams = {
        ...params,
        modelType: foundationModelFor(parsedStructure),
      };

      const formData = new FormData();
      uploadedFiles.forEach((file) => formData.append("files", file));
      formData.append("params", JSON.stringify(foundationParams));

      const response = await fetch("/api/calculate", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Foundation model calculation failed");
      }

      return response.json();
    }, [uploadedFiles, params, parsedStructure]);

  const handleCalculate = async () => {
    // Same gate as the Run button, restated here so the check cannot be
    // bypassed by anything that calls this directly.
    if (runBlockedReason) {
      setError(runBlockedReason);
      return;
    }
    setIsCalculating(true);
    setError(null);
    setResult(null);
    setShareUrl(null);

    const startTime = Date.now();

    try {
      const formData = new FormData();
      uploadedFiles.forEach((file) => formData.append("files", file));
      formData.append("params", JSON.stringify(params));
      if (customModelFile && params.modelType === "custom") {
        formData.append("model", customModelFile);
      }

      const response = await fetch("/api/calculate", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Calculation failed");
      }

      const data: CalculationResult = await response.json();

      // Browser wall-clock: HTTP both ways, any model download, and the
      // compute. It is NOT the compute time — `data.timeTaken` is, measured by
      // the backend around the calculation itself — so it is kept in its own
      // field and left at its native millisecond resolution. This used to be
      // rounded to whole seconds and written over `data.timeTaken`, after
      // which the dashboard rendered it with `.toFixed(1)` and invented a
      // tenth of a second that no measurement supported.
      const clientRoundTrip = (Date.now() - startTime) / 1000;

      // The backend's echo describes the run; the form describes the request.
      // Only the former belongs in a result. See effectiveRunParams().
      setResult({
        ...data,
        params: effectiveRunParams(params, data.params),
        clientRoundTrip,
      });

      // Record a compact summary in local (account-free) history.
      if (data.status === "success") {
        const entries = addHistory({
          filename: uploadedFiles[0]?.name,
          modelType: params.modelType,
          modelSize: params.modelSize,
          calculationType: params.calculationType,
          energy: typeof data.energy === "number" ? data.energy : undefined,
          atoms: data.symbols?.length,
        });
        setLastHistoryId(entries[0]?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calculation failed");
    } finally {
      setIsCalculating(false);
    }
  };

  const handleShare = async () => {
    if (!result || result.status !== "success") return;
    setIsSharing(true);
    try {
      // Share the effective params off the result, not the request — a shared
      // result should describe the run that happened.
      const { url } = await saveResult(
        result,
        result.params ?? params,
        uploadedFiles[0]?.name,
      );
      setShareUrl(url);
      if (lastHistoryId) updateHistoryShareUrl(lastHistoryId, url);
    } catch {
      setError("Failed to share result. Please try again.");
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyShareUrl = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const phases = PHASE_MAP[params.calculationType] || PHASE_MAP["single-point"];
  const estimatedTotal = getEstimatedTime(
    params.calculationType,
    params.mdSteps,
  );
  const currentPhase = estimatePhase(elapsedSeconds, estimatedTotal);
  const progressPct = Math.min(
    95,
    Math.round((elapsedSeconds / estimatedTotal) * 100),
  );
  const estRemaining = Math.max(0, estimatedTotal - elapsedSeconds);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Page sub-header */}
      <div className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)]/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
              Calculator
            </h1>
            <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
              Run MACE on your structure — configure, compute, and explore.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill isCalculating={isCalculating} hasResult={!!result} />
            <RecentCalculations />
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="mx-auto max-w-screen-2xl px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="calculator" className="gap-1.5">
              <CalculatorIcon className="h-4 w-4" />
              Calculator
            </TabsTrigger>
            <TabsTrigger value="draw" className="gap-1.5">
              <PenTool className="h-4 w-4" />
              Draw structure
            </TabsTrigger>
          </TabsList>

          {/* Calculator */}
          <TabsContent value="calculator" className="mt-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Config */}
              <aside className="min-w-0 space-y-6 lg:col-span-5">
                <FileUploadSection
                  files={uploadedFiles}
                  onFilesChange={handleFilesChange}
                />
                <ParameterPanel
                  params={params}
                  onChange={setParams}
                  customModelFile={customModelFile}
                  onCustomModelChange={setCustomModelFile}
                  structureElements={parsedStructure?.elements}
                  isPeriodic={parsedStructure?.isPeriodic}
                />
              </aside>

              {/* Run + results */}
              <section className="min-w-0 space-y-6 lg:col-span-7">
                {/* Run card */}
                <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-5">
                  <Button
                    onClick={handleCalculate}
                    disabled={isCalculating || runBlockedReason != null}
                    size="lg"
                    className="w-full text-base"
                  >
                    {isCalculating ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Computing…
                      </>
                    ) : (
                      <>
                        <Zap className="h-5 w-5" />
                        Run MACE calculation
                      </>
                    )}
                  </Button>

                  {runBlockedReason && !isCalculating && (
                    <p className="mt-3 text-center text-xs leading-relaxed text-[var(--color-text-muted)]">
                      {runBlockedReason}
                    </p>
                  )}

                  {/* Progress feedback */}
                  {isCalculating && (
                    <div className="mt-5 space-y-4">
                      {elapsedSeconds >= 3 && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          {phases.map((phase, i) => (
                            <div key={phase} className="flex items-center gap-1.5">
                              {i < currentPhase ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-success)]" />
                              ) : i === currentPhase ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-accent-primary)]" />
                              ) : (
                                <Circle className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                              )}
                              <span
                                className={`font-mono text-xs ${
                                  i < currentPhase
                                    ? "text-[var(--color-text-muted)] line-through"
                                    : i === currentPhase
                                      ? "font-semibold text-[var(--color-accent-strong)]"
                                      : "text-[var(--color-text-muted)]"
                                }`}
                              >
                                {phase}
                              </span>
                              {i < phases.length - 1 && (
                                <span className="text-[var(--color-text-muted)]">
                                  →
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-secondary)]">
                          {elapsedSeconds >= 10 ? (
                            <div
                              className="h-full rounded-full bg-[var(--color-accent-primary)] transition-all duration-700"
                              style={{ width: `${progressPct}%` }}
                            />
                          ) : (
                            <div
                              className="h-full w-1/3 rounded-full bg-[var(--color-accent-primary)]"
                              style={{ animation: "shimmer 1.5s ease-in-out infinite" }}
                            />
                          )}
                        </div>
                        <div className="flex items-center justify-between font-mono text-xs text-[var(--color-text-muted)]">
                          <span className="flex items-center gap-1.5">
                            <Clock className="h-3 w-3" />
                            Elapsed: {elapsedSeconds}s
                          </span>
                          {elapsedSeconds >= 10 && (
                            <span>
                              ~{estRemaining}s remaining · {progressPct}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Error */}
                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-3 rounded-xl border border-[var(--color-error)]/25 bg-[var(--color-error)]/5 p-4"
                  >
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-error)]" />
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-error)]">
                        Calculation error
                      </p>
                      <p className="mt-1 font-mono text-xs text-[var(--color-error)]/80">
                        {error}
                      </p>
                    </div>
                  </div>
                )}

                {/* Skeleton */}
                {isCalculating && elapsedSeconds >= 1 && <ResultsSkeleton />}

                {/* Results */}
                {result && !isCalculating && (
                  <div className="animate-fade-in-up space-y-6">
                    {/* Share bar */}
                    <div className="flex flex-wrap items-center gap-3">
                      {!shareUrl ? (
                        <Button
                          onClick={handleShare}
                          disabled={isSharing || result.status !== "success"}
                          variant="outline"
                          size="sm"
                        >
                          {isSharing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Share2 className="h-3.5 w-3.5" />
                          )}
                          {isSharing ? "Sharing…" : "Share result"}
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-accent-primary)]/30 bg-[var(--color-accent-soft)] px-3 py-1.5">
                          <Share2 className="h-3.5 w-3.5 text-[var(--color-accent-strong)]" />
                          <a
                            href={shareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-[var(--color-accent-strong)] hover:underline"
                          >
                            {shareUrl}
                          </a>
                          <button
                            type="button"
                            onClick={handleCopyShareUrl}
                            aria-label="Copy share link"
                            className="ml-1 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                          >
                            {shareCopied ? (
                              <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    <MetricsDashboard
                      result={result}
                      filename={uploadedFiles[0]?.name}
                    />

                    {isCustomModel && (
                      <ModelComparison
                        customResult={result}
                        customModelName={
                          params.customModelName ||
                          customModelFile?.name ||
                          "Custom model"
                        }
                        onRunFoundation={handleRunFoundation}
                      />
                    )}
                  </div>
                )}
              </section>
            </div>
          </TabsContent>

          {/* Draw structure */}
          <TabsContent value="draw" className="mt-6">
            <KetcherEditor onStructureReady={handleStructureFromEditor} />
          </TabsContent>
        </Tabs>
      </main>

      {/* Demo guided overlay */}
      {demoStep != null && demoStep < DEMO_STEPS.length && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center p-6">
          <div className="elevate pointer-events-auto max-w-lg rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[11px] text-[var(--color-accent-strong)]">
                Quick demo · Step {demoStep + 1}/{DEMO_STEPS.length}
              </span>
              <button
                type="button"
                onClick={() => setDemoStep(null)}
                aria-label="Close demo"
                className="text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-[var(--color-text-primary)]">
              {DEMO_STEPS[demoStep]}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              {demoStep > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDemoStep(demoStep - 1)}
                >
                  Back
                </Button>
              )}
              <Button
                size="sm"
                onClick={() =>
                  setDemoStep(
                    demoStep + 1 < DEMO_STEPS.length ? demoStep + 1 : null,
                  )
                }
              >
                {demoStep + 1 < DEMO_STEPS.length ? "Next" : "Got it"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Status pill — conveys state with text + icon (not color alone)
// ═══════════════════════════════════════════════════════════════════════════

function StatusPill({
  isCalculating,
  hasResult,
}: {
  isCalculating: boolean;
  hasResult: boolean;
}) {
  const state = isCalculating
    ? {
        label: "Computing",
        dot: "bg-[var(--color-warning)]",
        text: "text-[var(--color-warning)]",
      }
    : hasResult
      ? {
          label: "Complete",
          dot: "bg-[var(--color-success)]",
          text: "text-[var(--color-success)]",
        }
      : {
          label: "Ready",
          dot: "bg-[var(--color-text-muted)]",
          text: "text-[var(--color-text-muted)]",
        };

  return (
    <span
      className="hidden items-center gap-2 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-xs font-medium sm:inline-flex"
      role="status"
      aria-live="polite"
    >
      <span className={`h-2 w-2 rounded-full ${state.dot}`} aria-hidden />
      <span className={state.text}>{state.label}</span>
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Recent calculations — account-free local history in a slide-over
// ═══════════════════════════════════════════════════════════════════════════

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const CALC_LABEL: Record<string, string> = {
  "single-point": "Single-point",
  "geometry-opt": "Geometry opt.",
  "molecular-dynamics": "Mol. dynamics",
  phonon: "Phonon",
};

function RecentCalculations() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setEntries(getHistory());
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <HistoryIcon className="h-4 w-4" />
          Recent
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-serif text-xl">
            Recent calculations
          </SheetTitle>
          <SheetDescription>
            Stored locally in this browser — never uploaded.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4">
          {entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">
              No calculations yet. Your runs will appear here.
            </p>
          ) : (
            <ul className="space-y-2 py-2">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-[var(--color-text-primary)]">
                      {e.filename ?? "structure"}
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
                      {timeAgo(e.timestamp)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-text-secondary)]">
                    <span>{e.modelType}</span>
                    <span aria-hidden>·</span>
                    <span>{CALC_LABEL[e.calculationType] ?? e.calculationType}</span>
                    {typeof e.atoms === "number" && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{e.atoms} atoms</span>
                      </>
                    )}
                  </div>
                  {typeof e.energy === "number" && (
                    <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
                      E = {e.energy.toFixed(4)} eV
                    </p>
                  )}
                  {e.shareUrl && (
                    <a
                      href={e.shareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--color-accent-strong)] hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open shared result
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {entries.length > 0 && (
          <div className="border-t border-[var(--color-border-subtle)] p-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEntries(clearHistory())}
              className="w-full text-[var(--color-text-secondary)]"
            >
              <Trash2 className="h-4 w-4" />
              Clear history
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Demo guided tour steps
const DEMO_STEPS = [
  "Your structure is loaded (an ethanol molecule). You can also upload your own .xyz, .cif, .poscar, or .pdb file, browse the ml-peg catalog, or enter a SMILES string to generate a 3D structure.",
  "Choose your model and calculation type on the left. Try molecular dynamics for a trajectory animation, or geometry optimization to relax the structure.",
  'Click "Run MACE calculation" to compute energies and forces. Results appear in a tabbed dashboard with interactive scientific visualizations.',
];

// ═══════════════════════════════════════════════════════════════════════════
// Skeleton placeholder — matches the results layout
// ═══════════════════════════════════════════════════════════════════════════

function ResultsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-14 rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <Skeleton className="h-[420px] rounded-xl" />
      <Skeleton className="h-52 rounded-xl" />
    </div>
  );
}
