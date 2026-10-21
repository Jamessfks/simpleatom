"use client";

/**
 * ParameterPanel — model and calculation configuration.
 *
 * Rebuilt on shadcn primitives (Select, RadioGroup, Switch, Input, Label,
 * Tooltip) and the warm light theme. Physical parameters are contextual to
 * the chosen calculation type. Every numeric control shows its unit and
 * valid range inline (Materials Project panel discipline — nothing bare).
 *
 * Guardrails enforced here (see CLAUDE.md "Scientific Accuracy Rules"):
 *  - D3 dispersion is disabled for MACE-OFF (already includes dispersion —
 *    double-counting) and for custom checkpoints (the backend never wires
 *    `dispersion` into a custom MACECalculator, so the toggle would be a no-op).
 *  - MACE-OFF's element coverage (H, C, N, O, F, P, S, Cl, Br, I) is surfaced,
 *    with a hard warning if the loaded structure is known to fall outside it.
 *  - MD timestep is capped and flagged outside the typical 0.5-2.0 fs band.
 *  - NPT is disabled when the loaded structure is known not to be periodic.
 * The element/periodicity checks are undefined-safe: they activate once a
 * parent passes `structureElements` / `isPeriodic`, and stay inert otherwise.
 */

import { useEffect, useState } from "react";
import { Info, Upload, X, FileText, AlertTriangle } from "lucide-react";
import type { CalculationParams } from "@/types/mace";
import { MACE_OFF_ELEMENTS } from "@/lib/model-domain";
import { MODELS, PARAMS, findModel, isMaceOffModel, licenseNotice, modelSizes } from "@/lib/contract";
import { useCapabilities } from "@/lib/use-capabilities";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ParameterPanelProps {
  params: CalculationParams;
  onChange: (params: CalculationParams) => void;
  customModelFile: File | null;
  onCustomModelChange: (file: File | null) => void;
  /**
   * Unique elements present in the currently loaded structure (e.g. ["C", "H", "O"]),
   * if known. Drives the MACE-OFF element-coverage warning below. Optional and
   * undefined-safe: the calculator page does not currently lift parsed-structure
   * state up to pass here, so this stays inactive until a parent wires it up —
   * it does not affect anything else in the meantime.
   */
  structureElements?: string[];
  /**
   * Whether the currently loaded structure has a periodic cell (lattice vectors),
   * if known. Drives the NPT guard below (NPT/barostat dynamics are only physically
   * meaningful for a periodic system). Optional: when undefined, periodicity cannot
   * be verified, so NPT is left selectable rather than guessed at.
   */
  isPeriodic?: boolean;
}

type CalcTypeOption = {
  value: CalculationParams["calculationType"];
  label: string;
  hint: string;
  disabled?: boolean;
};

const CALC_TYPES: CalcTypeOption[] = [
  {
    value: "single-point",
    label: "Single-point energy",
    hint: "Energy and forces at the current geometry",
  },
  {
    value: "geometry-opt",
    label: "Geometry optimization",
    hint: "Relax atomic positions to a local energy minimum",
  },
  {
    value: "molecular-dynamics",
    label: "Molecular dynamics",
    hint: "Propagate atomic motion over time",
  },
  {
    value: "phonon",
    label: "Phonon spectrum",
    hint: "Vibrational analysis — not yet supported by the backend",
    disabled: true,
  },
];

/**
 * Sentinel for the "let upstream decide" precision option. A Radix Select
 * needs a non-empty string value, but the wire format for this choice is the
 * ABSENCE of the `precision` key — that is what makes the backend fall back
 * to `upstream_default_precision()` (mace-api/calculate.py) instead of
 * honouring an explicit request. Never send this string.
 */
const PRECISION_AUTO = "auto";

const SIZE_LABELS: Record<string, string> = {
  small: "Small — fastest",
  medium: "Medium — balanced",
  large: "Large — most accurate",
};

export function ParameterPanel({
  params,
  onChange,
  customModelFile,
  onCustomModelChange,
  structureElements,
  isPeriodic,
}: ParameterPanelProps) {
  const updateParam = <K extends keyof CalculationParams>(
    key: K,
    value: CalculationParams[K],
  ) => onChange({ ...params, [key]: value });

  const caps = useCapabilities();
  const model = findModel(params.modelType);
  const isCustom = params.modelType === "custom";
  const isOFF = isMaceOffModel(params.modelType);
  const dispersionAllowed = model?.dispersion.allowed ?? false;
  const sizes = modelSizes(params.modelType);
  const notice = licenseNotice(params.modelType);
  // Step ceilings: the tighter of the physical bound and this deployment's cap.
  const maxOptSteps = Math.min(PARAMS.maxOptSteps.max, caps.limits.maxOptSteps);
  const maxMdSteps = Math.min(PARAMS.mdSteps.max, caps.limits.maxMdSteps);

  // Elements outside MACE-OFF's training domain, if the loaded structure is known.
  const unsupportedElements = isOFF
    ? (structureElements ?? []).filter((el) => !MACE_OFF_ELEMENTS.has(el))
    : [];
  const hasHydrogen = structureElements?.includes("H") ?? false;

  const timeStepValue = params.timeStep ?? 1.0;
  const timeStepWarning =
    timeStepValue > 2.0
      ? "Above the typical 0.5–2.0 fs range — energy conservation degrades quickly beyond this; results may be unusable."
      : hasHydrogen && timeStepValue > 1.0
        ? "Structure contains hydrogen — prefer 1.0 fs or smaller for stable integration."
        : undefined;

  // Custom models have no size choice. Dispersion must not be silently
  // dropped: get_mace_calculator() only wires `dispersion` into mace_mp() —
  // mace_off() never receives it (MACE-OFF already includes dispersion, so
  // adding D3 would double-count it) and get_custom_calculator() has no
  // dispersion parameter at all (mace-api/calculate.py). So neither MACE-OFF
  // nor a custom checkpoint should leave the toggle in an "on" state that the
  // backend will ignore.
  useEffect(() => {
    if (params.modelType !== "custom") onCustomModelChange(null);

    const next = { ...params };
    let changed = false;

    if (!findModel(params.modelType)?.dispersion.allowed && params.dispersion) {
      next.dispersion = false;
      changed = true;
    }

    // Sizes are per model (MACE-MPA-0 ships only "medium"): keep the current
    // one if the new model has it, otherwise take the model's default.
    const available = modelSizes(params.modelType);
    const fallback = findModel(params.modelType)?.defaultSize;
    if (available.length > 0 && !available.includes(params.modelSize) && fallback) {
      next.modelSize = fallback as CalculationParams["modelSize"];
      changed = true;
    }

    // A custom checkpoint keeps the dtype it was saved in:
    // get_custom_calculator() deliberately does not pass `default_dtype` to
    // MACECalculator, so upstream adopts the checkpoint's own dtype. Sending
    // an explicit precision would be requested, ignored, and reported back as
    // a warning — drop it rather than ask for something that cannot happen.
    if (params.modelType === "custom" && params.precision != null) {
      next.precision = undefined;
      changed = true;
    }

    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.modelType]);

  // NPT (barostat) dynamics are only meaningful for a periodic cell. If the
  // loaded structure is known not to be periodic, fall back to NVT rather
  // than let the request go out as a calculation that cannot work.
  useEffect(() => {
    if (isPeriodic === false && params.mdEnsemble === "NPT") {
      onChange({ ...params, mdEnsemble: "NVT" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPeriodic]);

  return (
    <div className="space-y-6">
      {/* ── Model ── */}
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Model</CardTitle>
          <CardDescription>
            Choose a MACE foundation model or upload a fine-tuned checkpoint.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field
            label="Model type"
            tooltip="MACE-MPA-0: materials & crystals, 89 elements — upstream's default. MACE-MP-0: the 2023 materials model, kept so earlier results can be reproduced. MACE-OFF: organic molecules only — H, C, N, O, F, P, S, Cl, Br, I. Custom: your own .model checkpoint (local or self-hosted only)."
          >
            <Select
              value={params.modelType}
              onValueChange={(v) =>
                updateParam("modelType", v as CalculationParams["modelType"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.filter((m) => m.loader !== "checkpoint" || caps.customModels).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.loader === "checkpoint"
                      ? "Custom — upload .model file"
                      : `${m.label} — ${m.domain === "materials" ? `materials, ${m.elementCount} elements` : "organic molecules"}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {isOFF && (
            <div className="space-y-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-accent-primary)]" />
                <span>
                  Trained only on organic elements:{" "}
                  <strong className="font-mono text-[var(--color-text-primary)]">
                    H, C, N, O, F, P, S, Cl, Br, I
                  </strong>
                  . Structures with other elements (metals, noble gases, etc.)
                  are outside its training domain.
                </span>
              </p>
              {notice && (
                <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                  <strong className="font-semibold text-[var(--color-text-primary)]">Licence:</strong>{" "}
                  {notice}
                </p>
              )}
              {unsupportedElements.length > 0 && (
                <p className="flex items-start gap-2 rounded border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 p-2 text-xs leading-relaxed text-[var(--color-error)]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    This structure contains{" "}
                    <strong>{unsupportedElements.join(", ")}</strong>, which
                    MACE-OFF does not support. Switch to MACE-MPA-0 for this
                    structure.
                  </span>
                </p>
              )}
            </div>
          )}

          {isCustom && (
            <div className="space-y-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-accent-primary)]" />
                <span>
                  Upload a MACE-compatible <code className="font-mono">.model</code>{" "}
                  checkpoint — a fine-tuned model from{" "}
                  <code className="font-mono">mace_run_train</code> or any MACE
                  architecture.
                </span>
              </p>

              {!customModelFile ? (
                <div className="relative cursor-pointer rounded-lg border-2 border-dashed border-[var(--color-border-emphasis)] bg-[var(--color-bg-elevated)] p-4 text-center transition-colors hover:border-[var(--color-accent-primary)] hover:bg-[var(--color-accent-soft)]">
                  <input
                    type="file"
                    accept=".model"
                    aria-label="Upload custom MACE model"
                    onChange={(e) => {
                      if (e.target.files?.[0])
                        onCustomModelChange(e.target.files[0]);
                    }}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                  <Upload className="mx-auto mb-1 h-5 w-5 text-[var(--color-text-muted)]" />
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Drop a .model file or click to browse
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2.5">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-[var(--color-accent-primary)]" />
                    <div>
                      <p className="font-mono text-xs text-[var(--color-text-primary)]">
                        {customModelFile.name}
                      </p>
                      <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
                        {(customModelFile.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCustomModelChange(null)}
                    aria-label="Remove custom model"
                    className="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-error)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              <Field label="Model label">
                <Input
                  type="text"
                  value={params.customModelName ?? ""}
                  onChange={(e) => updateParam("customModelName", e.target.value)}
                  placeholder="e.g. My fine-tuned MACE"
                />
              </Field>
            </div>
          )}

          <Field
            label="Model size"
            tooltip={
              isCustom
                ? "Custom models have a fixed architecture."
                : "Larger models are more accurate but slower."
            }
          >
            <Select
              value={params.modelSize}
              onValueChange={(v) =>
                updateParam("modelSize", v as CalculationParams["modelSize"])
              }
              disabled={isCustom || sizes.length <= 1}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((size) => (
                  <SelectItem key={size} value={size}>
                    {SIZE_LABELS[size] ?? size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isCustom && sizes.length === 1 && (
              <p className="text-xs text-[var(--color-text-muted)]">
                {model?.label} is published in one size.
              </p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Precision"
              tooltip={
                isCustom
                  ? "A custom checkpoint keeps the dtype it was saved in — MACE adopts the checkpoint's own dtype, so this is not selectable."
                  : "Upstream MACE prints, on every run: float32 is faster but less accurate, recommended for MD; use float64 for geometry optimization. Auto applies exactly that, plus mace_off()'s own float64 default for MACE-OFF."
              }
            >
              <Select
                value={params.precision ?? PRECISION_AUTO}
                disabled={isCustom}
                onValueChange={(v) =>
                  // "auto" means: send no `precision` key at all, so the
                  // backend derives upstream's default. JSON.stringify drops
                  // undefined keys, which is exactly the wire format wanted.
                  updateParam(
                    "precision",
                    v === PRECISION_AUTO
                      ? undefined
                      : (v as CalculationParams["precision"]),
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PRECISION_AUTO}>
                    Auto — match upstream MACE
                  </SelectItem>
                  <SelectItem value="float32">float32 — faster</SelectItem>
                  <SelectItem value="float64">float64 — precise</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                {isCustom
                  ? "Custom checkpoints run in the dtype they were saved in."
                  : "Auto follows upstream MACE: float64 for MACE-OFF and for geometry optimization, float32 otherwise. An explicit choice is always honoured — the result will say which dtype actually ran."}
              </p>
            </Field>

            <Field label="Device">
              <Select
                value={params.device}
                onValueChange={(v) =>
                  updateParam("device", v as CalculationParams["device"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpu">CPU</SelectItem>
                  <SelectItem value="cuda">CUDA (GPU)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* ── Calculation ── */}
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Calculation</CardTitle>
          <CardDescription>
            Pick what to compute; parameters below adapt to your choice.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <RadioGroup
            value={params.calculationType}
            onValueChange={(v) =>
              updateParam(
                "calculationType",
                v as CalculationParams["calculationType"],
              )
            }
            className="gap-2"
          >
            {CALC_TYPES.map((opt) => (
              <label
                key={opt.value}
                htmlFor={`ct-${opt.value}`}
                className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                  opt.disabled
                    ? "cursor-not-allowed border-[var(--color-border-subtle)] opacity-55"
                    : params.calculationType === opt.value
                      ? "cursor-pointer border-[var(--color-accent-primary)] bg-[var(--color-accent-soft)]"
                      : "cursor-pointer border-[var(--color-border-subtle)] hover:border-[var(--color-border-emphasis)] hover:bg-[var(--color-bg-secondary)]"
                }`}
              >
                <RadioGroupItem
                  value={opt.value}
                  id={`ct-${opt.value}`}
                  disabled={opt.disabled}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                    {opt.label}
                    {opt.disabled && (
                      <span className="ml-2 rounded-full bg-[var(--color-bg-secondary)] px-2 py-0.5 text-[10px] font-normal text-[var(--color-text-muted)]">
                        soon
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">
                    {opt.hint}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>

          <div className="border-t border-[var(--color-border-subtle)] pt-5">
            {/* D3 dispersion — meaningful only for the MACE-MP family */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="dispersion" className="text-sm">
                  D3 dispersion correction
                </Label>
                <InfoTip text="Grimme D3 correction. Only meaningful for the MACE-MP family (MPA-0, MP-0) — MACE-OFF already includes dispersion in training, so enabling this would double-count it." />
              </div>
              <Switch
                id="dispersion"
                checked={params.dispersion && dispersionAllowed}
                disabled={!dispersionAllowed}
                onCheckedChange={(c) => updateParam("dispersion", c)}
              />
            </div>
            {isOFF && (
              <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
                Disabled — MACE-OFF already includes dispersion; enabling D3
                would double-count it.
              </p>
            )}
            {isCustom && (
              <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
                Disabled — dispersion is not applied to custom model
                checkpoints; it depends on how the model was trained.
              </p>
            )}

            {/* Geometry optimization */}
            {params.calculationType === "geometry-opt" && (
              <div className="mt-5 space-y-4">
                <NumberField
                  label="Force threshold"
                  unit="eV/Å"
                  hint="Convergence: max force per atom (fmax). 0.05 for general use; tighten to 0.01 for production-quality geometries."
                  value={params.forceThreshold ?? 0.05}
                  onChange={(v) => updateParam("forceThreshold", v)}
                  min={PARAMS.forceThreshold.min}
                  max={PARAMS.forceThreshold.max}
                  step={0.01}
                />
                <NumberField
                  label="Max optimization steps"
                  hint="Upper bound on BFGS iterations; the run stops early once fmax is reached."
                  value={params.maxOptSteps ?? 500}
                  onChange={(v) => updateParam("maxOptSteps", v)}
                  min={PARAMS.maxOptSteps.min}
                  max={maxOptSteps}
                />
              </div>
            )}

            {/* Molecular dynamics */}
            {params.calculationType === "molecular-dynamics" && (
              <div className="mt-5 space-y-4">
                <Field
                  label="Ensemble"
                  tooltip="NVE: no thermostat. NVT: Langevin thermostat. NPT: thermostat + barostat (needs a periodic cell)."
                >
                  <Select
                    value={params.mdEnsemble ?? "NVT"}
                    onValueChange={(v) =>
                      updateParam("mdEnsemble", v as "NVE" | "NVT" | "NPT")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NVE">NVE — microcanonical</SelectItem>
                      <SelectItem value="NVT">NVT — canonical</SelectItem>
                      <SelectItem
                        value="NPT"
                        disabled={isPeriodic === false}
                      >
                        NPT — constant P, T
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {isPeriodic === false && (
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      NPT is unavailable — this structure has no periodic
                      cell (not a crystal/bulk structure). Only NVE/NVT apply.
                    </p>
                  )}
                </Field>

                <NumberField
                  label="Temperature"
                  unit="K"
                  hint={
                    (params.mdEnsemble ?? "NVT") === "NVE"
                      ? "NVE has no thermostat — this sets only the initial velocity draw; temperature will drift, not stay fixed."
                      : undefined
                  }
                  value={params.temperature ?? 300}
                  onChange={(v) => updateParam("temperature", v)}
                  min={PARAMS.temperature.min}
                  max={PARAMS.temperature.max}
                />

                {(params.mdEnsemble ?? "NVT") === "NVT" && (
                  <NumberField
                    label="Friction"
                    unit="1/fs"
                    hint="Langevin thermostat coupling strength"
                    value={params.friction ?? 0.005}
                    onChange={(v) => updateParam("friction", v)}
                    min={PARAMS.friction.min}
                    max={PARAMS.friction.max}
                    step={0.001}
                  />
                )}

                {(params.mdEnsemble ?? "NVT") === "NPT" && (
                  <NumberField
                    label="Pressure"
                    unit="GPa"
                    value={params.pressure ?? 0}
                    onChange={(v) => updateParam("pressure", v)}
                    min={PARAMS.pressure.min}
                    max={PARAMS.pressure.max}
                  />
                )}

                <div className="grid grid-cols-2 gap-4">
                  <NumberField
                    label="Time step"
                    unit="fs"
                    hint="Typical: 0.5–2.0 fs. Use smaller steps for light elements like hydrogen."
                    warning={timeStepWarning}
                    value={timeStepValue}
                    onChange={(v) => updateParam("timeStep", v)}
                    min={PARAMS.timeStep.min}
                    max={PARAMS.timeStep.max}
                    step={0.1}
                  />
                  <NumberField
                    label="MD steps"
                    value={params.mdSteps ?? 100}
                    onChange={(v) => updateParam("mdSteps", v)}
                    min={PARAMS.mdSteps.min}
                    max={maxMdSteps}
                  />
                </div>
              </div>
            )}

            {params.calculationType === "single-point" && (
              <p className="mt-4 text-xs text-[var(--color-text-muted)]">
                No additional parameters required for a single-point evaluation.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Local helpers ── */

function Field({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label className="text-xs font-medium text-[var(--color-text-secondary)]">
          {label}
        </Label>
        {tooltip && <InfoTip text={tooltip} />}
      </div>
      {children}
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-accent-primary)]"
          aria-label="More information"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

function NumberField({
  label,
  unit,
  hint,
  warning,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  /** Physical unit shown inline next to the label and in the range caption
   * (e.g. "eV/Å", "K", "fs") — every numeric control here carries one unless
   * the quantity is genuinely dimensionless (e.g. a step count). */
  unit?: string;
  hint?: string;
  /** Dynamic caution shown when the current value is valid but scientifically
   * risky (e.g. an MD timestep above the typical range). Rendered distinctly
   * from `hint`, which is static guidance shown regardless of the value. */
  warning?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [localValue, setLocalValue] = useState<string>(String(value));
  const [isFocused, setIsFocused] = useState(false);
  const displayValue = isFocused ? localValue : String(value);
  const rangeText =
    min != null && max != null
      ? `Range: ${min}–${max}${unit ? ` ${unit}` : ""}`
      : undefined;

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-[var(--color-text-secondary)]">
        {label}
        {unit && (
          <span className="ml-1 font-normal text-[var(--color-text-muted)]">
            ({unit})
          </span>
        )}
      </Label>
      <Input
        type="number"
        className="no-spinner font-mono"
        value={displayValue}
        onFocus={() => {
          setLocalValue(String(value));
          setIsFocused(true);
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setLocalValue(raw);
          const parsed = parseFloat(raw);
          if (!isNaN(parsed)) onChange(parsed);
        }}
        onBlur={() => {
          setIsFocused(false);
          const parsed = parseFloat(localValue);
          if (isNaN(parsed)) {
            setLocalValue(String(value));
          } else {
            const clamped =
              min != null && max != null
                ? Math.min(max, Math.max(min, parsed))
                : min != null
                  ? Math.max(min, parsed)
                  : max != null
                    ? Math.min(max, parsed)
                    : parsed;
            onChange(clamped);
            setLocalValue(String(clamped));
          }
        }}
        min={min}
        max={max}
        step={step ?? 1}
      />
      {hint && (
        <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
          {hint}
        </p>
      )}
      {rangeText && (
        <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
          {rangeText}
        </p>
      )}
      {warning && (
        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-[var(--color-warning)]">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{warning}</span>
        </p>
      )}
    </div>
  );
}
