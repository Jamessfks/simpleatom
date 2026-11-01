"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
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
import { parseStructureFile } from "@/lib/parse-structure";
import { parsedFor, type ParseResult } from "@/components/calculate/parse-state";
import { FileUploadSection } from "@/components/calculate/file-upload-section";
import { ParameterPanel } from "@/components/calculate/parameter-panel";
import { RunLedger } from "@/components/calculate/run-ledger";
import { useCapabilities } from "@/lib/use-capabilities";
import { ApiRequestError, isSmilesGenerated, runCalculationJob, type JobView } from "@/lib/api-client";
import { checkCalculationParams, DEFAULT_MODEL_TYPE } from "@/lib/contract";
import { MetricsDashboard } from "@/components/calculate/metrics-dashboard";
import { ModelComparison } from "@/components/calculate/model-comparison";
import { runOutcome, shareCaveats, type RunOutcome } from "@/components/calculate/run-outcome";
import {
  STAGES,
  completionAnnouncement,
  stageAnnouncement,
  stageIndex,
  stepSummary,
} from "@/components/calculate/job-stage";
import {
  foundationParamsFor,
  isCustomResult,
  snapshotRun,
  type RunSnapshot,
} from "@/components/calculate/run-snapshot";
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
import { SHARE_DISCLOSURE, saveResult } from "@/lib/share";
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
        <div className="flex items-center gap-3 text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-mono text-sm">Loading molecular editor…</span>
        </div>
      </div>
    ),
  },
);

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
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [params, setParams] = useState<CalculationParams>({
    modelSize: "medium",
    modelType: DEFAULT_MODEL_TYPE,
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
  /**
   * What the result on screen was computed from, captured when the run
   * started. The form stays editable, so the dashboard, Share and Compare read
   * this, never the live form (D58).
   */
  const [lastRun, setLastRun] = useState<RunSnapshot | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [job, setJob] = useState<JobView | null>(null);
  const caps = useCapabilities();
  const runAbort = useRef<AbortController | null>(null);
  const compareAbort = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [confirmShareOpen, setConfirmShareOpen] = useState(false);
  const keepPrivateRef = useRef<HTMLButtonElement>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareCopyFailed, setShareCopyFailed] = useState(false);
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
    if (!file) return;
    let cancelled = false;
    parseStructureFile(file)
      .then((s) => {
        if (!cancelled) setParsed({ file, structure: s });
      })
      .catch(() => {
        if (!cancelled) setParsed({ file, structure: null });
      });
    return () => {
      cancelled = true;
    };
  }, [uploadedFiles]);
  // The structure of the file that is current NOW. While a new file is still
  // being read there is none, and Run waits for it (D98).
  const { structure: parsedStructure, parsing: parsingStructure } = parsedFor(uploadedFiles[0], parsed);

  const handleFilesChange = useCallback(
    (files: File[]) => {
      setUploadedFiles(files);
      if (
        files.length > 0 &&
        isSmilesGenerated(files[0]) &&
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

  // On a single-column layout the result renders below the whole
  // configuration. When a run finishes and its result is not on screen, bring
  // it into view (instantly under reduced motion).
  useEffect(() => {
    if (!result || isCalculating) return;
    const el = resultsRef.current;
    if (!el) return;
    // The Run button was inactive during the run, so keyboard focus is on
    // <body> or still on that button. Hand it to the results, without
    // stealing it from a control the user has since moved to.
    const active = document.activeElement;
    if (!active || active === document.body || active.closest("[data-run-button]")) {
      el.focus({ preventScroll: true });
    }
    const { top } = el.getBoundingClientRect();
    if (top >= 0 && top < window.innerHeight * 0.6) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [result, isCalculating]);

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
      : parsingStructure
        ? "Reading the structure…"
        : isCustomModel && !customModelFile
        ? "Upload a MACE .model checkpoint to run a custom model — or switch to a foundation model (MACE-MPA-0, MACE-MP-0 or MACE-OFF). A foundation-model result labelled “custom” would attribute the numbers to a model that was never loaded."
        : params.calculationType === "phonon"
          ? "Phonon spectrum is not implemented. Choose single-point, geometry optimization, or molecular dynamics."
          : // The TypeScript mirror of the contract: anything the backend would
            // refuse (an invalid seed, an out-of-range number) blocks the run here.
            (checkCalculationParams(params as unknown as Record<string, unknown>, caps.profile, isCustomModel)?.message ?? null);

  const handleRunFoundation =
    useCallback(async (): Promise<CalculationResult | null> => {
      if (!lastRun || lastRun.files.length === 0) return null;

      // The structure and settings the shown result was computed from, with
      // the foundation model picked from its PARSED structure, never from the
      // uploaded FILENAME: a periodic crystal can be named "offcut.cif", and
      // matching that name against "off" used to send it to MACE-OFF, crossing
      // two incompatible energy conventions and printing a meaningless deltaE.
      const formData = new FormData();
      lastRun.files.forEach((file) => formData.append("files", file));
      formData.append("params", JSON.stringify(foundationParamsFor(lastRun)));

      const abort = new AbortController();
      compareAbort.current = abort;
      return runCalculationJob(formData, { signal: abort.signal });
    }, [lastRun]);

  // Leaving the page (route change, tab close, reload) stops the jobs it
  // started. The abort event itself sends the DELETE, with keepalive, so the
  // shared CPU is not left computing for a page nobody is looking at.
  useEffect(() => {
    const stop = () => {
      runAbort.current?.abort();
      compareAbort.current?.abort();
    };
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, []);

  const handleCalculate = async () => {
    if (isCalculating) return;
    // Same gate as the Run button, restated here so the check cannot be
    // bypassed by anything that calls this directly.
    if (runBlockedReason) {
      setError(runBlockedReason);
      return;
    }
    const run = snapshotRun({
      files: uploadedFiles,
      params,
      structure: parsedStructure,
      customModelName: params.customModelName || customModelFile?.name,
    });
    setIsCalculating(true);
    setError(null);
    setResult(null);
    setLastRun(run);
    setShareUrl(null);
    setJob(null);

    const startTime = Date.now();
    const abort = new AbortController();
    runAbort.current = abort;

    try {
      const formData = new FormData();
      run.files.forEach((file) => formData.append("files", file));
      formData.append("params", JSON.stringify(run.params));
      if (customModelFile && run.params.modelType === "custom") {
        formData.append("model", customModelFile);
      }

      const data: CalculationResult = await runCalculationJob(formData, {
        signal: abort.signal,
        onUpdate: setJob,
      });

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
        params: effectiveRunParams(run.params, data.params),
        clientRoundTrip,
      });

      // Record a compact summary in local (account-free) history.
      if (data.status === "success") {
        const entries = addHistory({
          filename: run.filename,
          modelType: run.params.modelType,
          modelSize: run.params.modelSize,
          calculationType: run.params.calculationType,
          energy: typeof data.energy === "number" ? data.energy : undefined,
          atoms: data.symbols?.length,
        });
        setLastHistoryId(entries[0]?.id ?? null);
      }
    } catch (err) {
      const cancelled =
        abort.signal.aborted || (err instanceof ApiRequestError && err.code === "cancelled");
      if (!cancelled) setError(err instanceof Error ? err.message : "Calculation failed");
    } finally {
      runAbort.current = null;
      setIsCalculating(false);
      setJob(null);
    }
  };

  const handleCancel = () => runAbort.current?.abort();

  // Called only from the confirmation sheet: the user has just been told the
  // link is public and permanent (SHARE_DISCLOSURE), and agreeing is the
  // consent the server requires.
  const handleShare = async () => {
    setConfirmShareOpen(false);
    if (!result || result.status !== "success") return;
    setIsSharing(true);
    try {
      // Share the effective params off the result, not the request — a shared
      // result should describe the run that happened.
      const { url } = await saveResult(result, lastRun?.filename, true);
      setShareUrl(url);
      if (lastHistoryId) updateHistoryShareUrl(lastHistoryId, url);
    } catch (err) {
      setError(err instanceof Error ? `Could not share: ${err.message}` : "Failed to share result. Please try again.");
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopyFailed(false);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure origin, permission denied): the link is
      // on screen, so say so rather than showing a "copied" tick that is false.
      setShareCopyFailed(true);
    }
  };

  const currentStage = stageIndex(job);
  const stepText = stepSummary(job);
  // One persistent, visually hidden status region. It says the stage while a
  // job runs (never the ticking timer) and how the run ended, so completion is
  // announced on a phone too, where the status pill is not displayed.
  const announcement = isCalculating
    ? stageAnnouncement(job)
    : result
      ? completionAnnouncement(runOutcome(result), result)
      : "";
  const stepPct =
    job?.progress.step != null && job.progress.totalSteps
      ? Math.min(100, Math.round((job.progress.step / job.progress.totalSteps) * 100))
      : null;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {/* Page sub-header */}
      <div className="border-b border-border-subtle bg-bg-primary/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-text-primary">
              Calculator
            </h1>
            <p className="mt-0.5 text-sm text-text-secondary">
              Run MACE on your structure — configure, compute, and explore.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill
              isCalculating={isCalculating}
              outcome={result ? runOutcome(result) : null}
            />
            <RecentCalculations />
          </div>
        </div>
      </div>

      {/* Main content */}
      <main id="main" className="mx-auto max-w-screen-2xl px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList aria-label="How to provide a structure">
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
                {/* The run ledger: sticky beside the configuration until a
                    result exists, then an ordinary card above it (a sticky
                    pane would otherwise sit on top of the results). */}
                <div className={result ? undefined : "lg:sticky lg:top-20"}>
                <RunLedger
                  params={params}
                  structure={parsedStructure}
                  filename={uploadedFiles[0]?.name}
                  customModelName={params.customModelName || customModelFile?.name}
                  caps={caps}
                  compact={result != null && !isCalculating}
                >
                  <Button
                    onClick={handleCalculate}
                    // Mid-run the button is aria-disabled, not disabled, so the
                    // keyboard focus that clicked it is not thrown to <body>.
                    disabled={!isCalculating && runBlockedReason != null}
                    aria-disabled={isCalculating || undefined}
                    data-run-button=""
                    size="lg"
                    className={`aria-disabled:pointer-events-none aria-disabled:opacity-50 ${result != null && !isCalculating ? "h-11 w-full rounded-full" : "h-12 w-full rounded-full text-base"}`}
                  >
                    {isCalculating ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Computing…
                      </>
                    ) : (
                      <>
                        <Zap className="h-5 w-5" />
                        Run calculation
                      </>
                    )}
                  </Button>

                  {runBlockedReason && !isCalculating && (
                    <p className="mt-3 text-center text-xs leading-relaxed text-text-muted">
                      {runBlockedReason}
                    </p>
                  )}

                  {/* Progress feedback — every value here is reported by the backend */}
                  {isCalculating && (
                    <div className="mt-5 space-y-4">
                      <ol className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        {STAGES.map((stage, i) => (
                          <li
                            key={stage.key}
                            className="flex items-center gap-1.5"
                            aria-current={i === currentStage ? "step" : undefined}
                          >
                            {i < currentStage ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                            ) : i === currentStage ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-strong motion-reduce:animate-none" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 text-text-muted" />
                            )}
                            <span
                              className={`text-xs ${
                                i === currentStage
                                  ? "font-semibold text-accent-strong"
                                  : "text-text-muted"
                              }`}
                            >
                              {stage.label}
                              {i < currentStage && <span className="sr-only"> (done)</span>}
                              {stage.key === "queued" && job?.queuePosition
                                ? ` (position ${job.queuePosition + 1})`
                                : ""}
                            </span>
                          </li>
                        ))}
                      </ol>

                      <div className="space-y-1.5">
                        <div
                          className="h-1.5 w-full overflow-hidden rounded-full bg-bg-secondary"
                          role="progressbar"
                          aria-label="Calculation progress"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={stepPct ?? undefined}
                        >
                          {stepPct != null ? (
                            <div
                              className="h-full rounded-full bg-accent-primary transition-all duration-500 motion-reduce:transition-none"
                              style={{ width: `${stepPct}%` }}
                            />
                          ) : (
                            <div
                              className="h-full w-1/3 rounded-full bg-accent-primary motion-reduce:w-full motion-reduce:opacity-40"
                              style={{ animation: "shimmer 1.5s ease-in-out infinite" }}
                            />
                          )}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-muted">
                          <span className="flex items-center gap-1.5 tabular-nums">
                            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                            Elapsed {elapsedSeconds} s
                          </span>
                          {stepText && <span>{stepText}</span>}
                          <button
                            type="button"
                            onClick={handleCancel}
                            className="inline-flex min-h-11 items-center rounded-full border border-border-emphasis px-4 text-sm font-medium text-text-secondary hover:border-error hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </RunLedger>
                </div>

                {/* Error */}
                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-3 rounded-xl border border-error/25 bg-error/5 p-4"
                  >
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-error" />
                    <div>
                      <p className="text-sm font-semibold text-error">
                        Calculation error
                      </p>
                      <p className="mt-1 font-mono text-xs text-error/80">
                        {error}
                      </p>
                    </div>
                  </div>
                )}

                {/* Skeleton */}
                {isCalculating && elapsedSeconds >= 1 && <ResultsSkeleton />}

                {/* Results */}
                {result && !isCalculating && (
                  <div
                    ref={resultsRef}
                    tabIndex={-1}
                    role="region"
                    aria-label="Calculation results"
                    className="animate-fade-in-up scroll-mt-20 space-y-6 outline-none"
                  >
                    <MetricsDashboard
                      result={result}
                      filename={lastRun?.filename}
                      actions={
                        !shareUrl ? (
                          <Button
                            onClick={() => setConfirmShareOpen(true)}
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
                          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-accent-primary/30 bg-accent-soft px-3 py-1.5 max-sm:col-span-2">
                            <Share2 className="h-3.5 w-3.5 text-accent-strong" />
                            <a
                              href={shareUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-w-0 truncate font-mono text-xs text-accent-strong hover:underline"
                            >
                              {shareUrl}
                            </a>
                            <button
                              type="button"
                              onClick={handleCopyShareUrl}
                              aria-label="Copy share link"
                              className="touch-target ml-1 rounded p-1 text-text-muted transition-colors hover:text-text-primary"
                            >
                              {shareCopied ? (
                                <Check className="h-3.5 w-3.5 text-success" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                            {shareCopyFailed && (
                              <span role="alert" className="shrink-0 text-xs text-error">
                                Could not copy; select the link instead.
                              </span>
                            )}
                          </div>
                        )
                      }
                    />

                    {isCustomResult(result) && (
                      <ModelComparison
                        customResult={result}
                        customModelName={lastRun?.customModelName || "Custom model"}
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

      <Sheet open={confirmShareOpen} onOpenChange={setConfirmShareOpen}>
        {/* A bottom sheet on a phone, a centred dialog from 768 px up. Publishing
            is public and permanent, so the safe choice gets focus. */}
        <SheetContent
          side="bottom" className="mx-auto w-full max-w-xl rounded-t-2xl md:top-0 md:my-auto md:h-fit md:rounded-2xl md:border"
          onOpenAutoFocus={(event) => { event.preventDefault(); keepPrivateRef.current?.focus(); }}
        >
          <SheetHeader>
            <SheetTitle className="font-serif text-xl">Publish this result?</SheetTitle>
            <SheetDescription>{SHARE_DISCLOSURE}</SheetDescription>
          </SheetHeader>
          {lastRun?.filename && (
            <p className="px-4 text-sm text-text-secondary">
              File name that will be published:{" "}
              <span className="font-mono text-text-primary">{lastRun.filename}</span>
            </p>
          )}
          {result && shareCaveats(result).length > 0 && (
            <div role="note" className="mx-4 space-y-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              <p className="font-semibold">Check before you publish</p>
              {shareCaveats(result).map((caveat) => (
                <p key={caveat}>{caveat}</p>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 p-4 sm:flex-row sm:justify-end">
            <Button ref={keepPrivateRef}
              variant="outline"
              className="min-h-11"
              onClick={() => setConfirmShareOpen(false)}
            >
              Keep private
            </Button>
            <Button className="min-h-11" onClick={handleShare}>
              Publish public link
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Demo guided overlay */}
      {demoStep != null && demoStep < DEMO_STEPS.length && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center p-6">
          <div className="elevate pointer-events-auto max-w-lg rounded-2xl border border-border-subtle bg-bg-elevated p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-xs text-accent-strong">
                Quick demo · Step {demoStep + 1}/{DEMO_STEPS.length}
              </span>
              <button
                type="button"
                onClick={() => setDemoStep(null)}
                aria-label="Close demo"
                className="touch-target rounded text-text-muted transition-colors hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-text-primary">
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
  outcome,
}: {
  isCalculating: boolean;
  outcome: RunOutcome | null;
}) {
  const state = isCalculating
    ? {
        label: "Computing",
        dot: "bg-warning",
        text: "text-warning",
      }
    : outcome
      ? outcome.tone === "success"
        ? { label: outcome.pill, dot: "bg-success", text: "text-success" }
        : { label: outcome.pill, dot: "bg-warning", text: "text-warning" }
      : {
          label: "Ready",
          dot: "bg-text-muted",
          text: "text-text-muted",
        };

  return (
    // Presentational: the persistent status region above announces state.
    <span className="hidden items-center gap-2 rounded-full border border-border-subtle bg-bg-elevated px-3 py-1.5 text-xs font-medium sm:inline-flex">
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
            <p className="py-10 text-center text-sm text-text-muted">
              No calculations yet. Your runs will appear here.
            </p>
          ) : (
            <ul className="space-y-2 py-2">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="rounded-lg border border-border-subtle bg-bg-elevated p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-text-primary">
                      {e.filename ?? "structure"}
                    </span>
                    <span className="shrink-0 text-xs text-text-muted">
                      {timeAgo(e.timestamp)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-secondary">
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
                    <p className="mt-1 font-mono text-xs text-text-muted">
                      E = {e.energy.toFixed(4)} eV
                    </p>
                  )}
                  {e.shareUrl && (
                    <a
                      href={e.shareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-accent-strong hover:underline"
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
          <div className="border-t border-border-subtle p-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEntries(clearHistory())}
              className="w-full text-text-secondary"
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
  'Click "Run calculation" to compute energies and forces. Results appear in a tabbed dashboard with interactive scientific visualizations.',
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
