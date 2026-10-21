"use client";

/**
 * BenchmarkConfig — Model and structure selection panel.
 *
 * Lets users pick 2–3 MACE models (MP-0 or OFF, each in small/medium/large)
 * and any combination of ml-peg catalog structures or user-uploaded files.
 *
 * Element compatibility: MACE-OFF only supports H, C, N, O, F, P, S, Cl,
 * Br, I (organic elements). When any OFF model is selected, structures
 * containing unsupported elements (Si, Cu, Fe, Na, etc.) are automatically
 * excluded and grayed out. This prevents runtime crashes in the backend.
 *
 * A second family of structures is offered alongside the ml-peg catalog: the
 * Materials Project reference set, which feeds the "vs Materials Project" tab.
 * It comes in two halves that must be run together — compounds, and the
 * elemental reference phases their formation energies are built from. Selecting
 * a compound without its references produces no formation energy at all, so the
 * panel says so rather than guessing, and this page warns before the run.
 */

import { MODELS, isMaceOffModel, isMaterialsModel } from "@/lib/contract";
import { MACE_OFF_ELEMENTS } from "@/lib/model-domain";
import { useState, useMemo, useCallback, useEffect } from "react";
import { Play, AlertTriangle, Info, Upload, X, File as FileIcon } from "lucide-react";
import { MLPEG_CATALOG, type CatalogCategory, type CatalogEntry } from "@/lib/mlpeg-catalog";
import {
  MP_REFERENCE_ENTRIES,
  MP_REFERENCE_PROVENANCE,
  type MpReferenceEntry,
} from "@/lib/mp-reference";
import { MP_CATEGORY_ID } from "@/lib/benchmark-structures";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ModelType, ModelSize } from "@/types/mace";
import { Formula } from "@/components/ui/formula";

export interface SelectedModel {
  type: ModelType;
  size: ModelSize;
  label: string;
}

interface BenchmarkConfigProps {
  onRun: (
    models: SelectedModel[],
    structureIds: string[],
    customModelFile?: File,
    userStructureFiles?: File[]
  ) => void;
  isRunning: boolean;
}

const ACCEPTED_STRUCTURE_FORMATS = [".xyz", ".cif", ".poscar", ".contcar", ".pdb"];

interface ModelOption {
  type: ModelType;
  size: ModelSize;
  label: string;
  family: string;
}

/** Every foundation model × size the registry lists (mace-api/contract.json). */
const MODEL_OPTIONS: ModelOption[] = MODELS.filter((m) => m.loader !== "checkpoint").flatMap((m) =>
  Object.keys(m.sizes).map((size) => ({
    type: m.id,
    size: size as ModelSize,
    label: `${m.label} (${size})`,
    family: m.id,
  })),
);

/** Model groups in registry order, with the heading each group shows. */
const MODEL_GROUPS = MODELS.filter((m) => m.loader !== "checkpoint").map((m) => ({
  id: m.id,
  heading: `${m.label} — ${m.summary}`,
  notice: m.license.notice,
}));

/** One-line description for an MP entry, with its published value inline. */
function mpEntryDescription(e: MpReferenceEntry): string {
  if (e.role === "element-reference") {
    return (
      `MP's reference phase for ${e.element} (${e.mpId}). Formation energy is ` +
      "0 eV/atom by definition; supplies e_ref for the compounds above."
    );
  }
  return (
    `MP published formation energy ${e.mpFormationEnergyPerAtom >= 0 ? "+" : ""}` +
    `${e.mpFormationEnergyPerAtom.toFixed(4)} eV/atom (${MP_REFERENCE_PROVENANCE.datasetKey}), ` +
    "hull ground state. MP's PBE-relaxed cell."
  );
}

/**
 * The MP reference set presented as a catalog category, so it flows through the
 * same selection, compatibility and counting logic as the ml-peg entries.
 * Deliberately NOT added to MLPEG_CATALOG: the calculator page reads that
 * catalog directly and its structure picker is unchanged by this feature.
 */
const MP_CATEGORY: CatalogCategory = {
  id: MP_CATEGORY_ID,
  name: "Materials Project reference set",
  description:
    "MP's own PBE-relaxed cells with published formation energies. Compounds plus the " +
    "elemental reference phases they need — both halves are required.",
  mlpegPath: MP_REFERENCE_PROVENANCE.endpoint,
  entries: MP_REFERENCE_ENTRIES.map((e) => ({
    id: e.id,
    name: e.name,
    description: mpEntryDescription(e),
    formula: e.formula,
    atomCount: e.atomCount,
    elements: e.elements,
    recommendedModel: "MACE-MPA-0" as const,
    xyzData: e.xyzData,
  })),
};

/** Everything selectable on this page. */
const ALL_CATEGORIES: CatalogCategory[] = [...MLPEG_CATALOG, MP_CATEGORY];

/** MP compound ids and the elements each needs, for the pre-run check. */
const MP_COMPOUND_ELEMENTS = MP_REFERENCE_ENTRIES.filter(
  (e) => e.role === "compound",
).map((e) => ({ id: e.id, formula: e.formula, elements: e.elements }));

/** element -> the structure id of MP's reference phase for it. */
const MP_REFERENCE_ID_BY_ELEMENT = new Map(
  MP_REFERENCE_ENTRIES.filter((e) => e.role === "element-reference").map((e) => [
    e.element as string,
    e.id,
  ]),
);

function modelKey(m: ModelOption | SelectedModel): string {
  return `${m.type}-${m.size}`;
}

function isStructureCompatibleWithOFF(entry: CatalogEntry): boolean {
  return entry.elements.every((el) => MACE_OFF_ELEMENTS.has(el));
}

export function BenchmarkConfig({ onRun, isRunning }: BenchmarkConfigProps) {
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    // The new materials default against the model it replaced.
    new Set(["MACE-MPA-0-medium", "MACE-MP-0-medium"])
  );
  const [selectedStructures, setSelectedStructures] = useState<Set<string>>(
    new Set(ALL_CATEGORIES.flatMap((c) => c.entries.map((e) => e.id)))
  );
  const [customModel, setCustomModel] = useState<File | null>(null);
  const [userStructures, setUserStructures] = useState<File[]>([]);

  const handleStructureDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      ACCEPTED_STRUCTURE_FORMATS.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    if (dropped.length > 0) {
      setUserStructures((prev) => {
        const existing = new Set(prev.map((f) => f.name));
        return [...prev, ...dropped.filter((f) => !existing.has(f.name))];
      });
    }
  }, []);

  const handleStructureFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setUserStructures((prev) => {
        const existing = new Set(prev.map((f) => f.name));
        return [...prev, ...files.filter((f) => !existing.has(f.name))];
      });
    }
    e.target.value = "";
  }, []);

  const removeUserStructure = (name: string) => {
    setUserStructures((prev) => prev.filter((f) => f.name !== name));
  };

  const toggleModel = (key: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleStructure = (id: string) => {
    setSelectedStructures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategory = (cat: CatalogCategory) => {
    setSelectedStructures((prev) => {
      const next = new Set(prev);
      const catIds = cat.entries
        .filter((e) => !incompatibleIds.has(e.id))
        .map((e) => e.id);
      const allSelected = catIds.every((id) => next.has(id));
      if (allSelected) {
        catIds.forEach((id) => next.delete(id));
      } else {
        catIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const hasAnyOFF = useMemo(() => {
    return MODEL_OPTIONS.some(
      (m) => isMaceOffModel(m.type) && selectedModels.has(modelKey(m))
    );
  }, [selectedModels]);

  const hasAnyMP0 = useMemo(() => {
    return MODEL_OPTIONS.some(
      (m) => isMaterialsModel(m.type) && selectedModels.has(modelKey(m))
    );
  }, [selectedModels]);

  const onlyOFF = hasAnyOFF && !hasAnyMP0;

  const incompatibleIds = useMemo(() => {
    if (!hasAnyOFF) return new Set<string>();
    const ids = new Set<string>();
    for (const cat of ALL_CATEGORIES) {
      for (const e of cat.entries) {
        if (!isStructureCompatibleWithOFF(e)) {
          ids.add(e.id);
        }
      }
    }
    return ids;
  }, [hasAnyOFF]);

  const incompatibleNames = useMemo(() => {
    if (incompatibleIds.size === 0) return [];
    const all = ALL_CATEGORIES.flatMap((c) => c.entries);
    return all.filter((e) => incompatibleIds.has(e.id)).map((e) => e.name);
  }, [incompatibleIds]);

  const unsupportedElements = useMemo(() => {
    if (incompatibleIds.size === 0) return [];
    const elems = new Set<string>();
    const all = ALL_CATEGORIES.flatMap((c) => c.entries);
    for (const e of all) {
      if (incompatibleIds.has(e.id)) {
        for (const el of e.elements) {
          if (!MACE_OFF_ELEMENTS.has(el)) elems.add(el);
        }
      }
    }
    return Array.from(elems).sort();
  }, [incompatibleIds]);

  useEffect(() => {
    if (incompatibleIds.size === 0) return;
    setSelectedStructures((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of incompatibleIds) {
        if (next.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [incompatibleIds]);

  const selectAll = () => {
    setSelectedStructures(
      new Set(
        ALL_CATEGORIES.flatMap((c) =>
          c.entries
            .filter((e) => !incompatibleIds.has(e.id))
            .map((e) => e.id)
        )
      )
    );
  };

  const clearAll = () => setSelectedStructures(new Set());

  /** Select exactly the MP reference set: compounds plus every reference phase. */
  const selectMpSet = () => {
    setSelectedStructures((prev) => {
      const next = new Set(prev);
      for (const e of MP_CATEGORY.entries) {
        if (!incompatibleIds.has(e.id)) next.add(e.id);
      }
      return next;
    });
  };

  /**
   * MP compounds selected whose elemental reference phase is not.
   *
   * Without the reference, the formation energy cannot be formed at all — and
   * substituting MP's own elemental energy would smuggle the VASP-to-MACE offset
   * into the answer. So it is worth catching before the run rather than
   * explaining after it.
   */
  const mpMissingReferences = useMemo(() => {
    const needed = new Set<string>();
    for (const c of MP_COMPOUND_ELEMENTS) {
      if (!selectedStructures.has(c.id)) continue;
      for (const el of c.elements) needed.add(el);
    }
    const missing: { element: string; id: string }[] = [];
    for (const el of [...needed].sort()) {
      const refId = MP_REFERENCE_ID_BY_ELEMENT.get(el);
      if (refId && !selectedStructures.has(refId)) missing.push({ element: el, id: refId });
    }
    return missing;
  }, [selectedStructures]);

  const addMissingMpReferences = () => {
    setSelectedStructures((prev) => {
      const next = new Set(prev);
      for (const m of mpMissingReferences) next.add(m.id);
      return next;
    });
  };

  const totalModels = selectedModels.size + (customModel ? 1 : 0);
  const totalStructures = selectedStructures.size + userStructures.length;
  const totalCalcs = totalModels * totalStructures;
  const canRun = totalModels >= 2 && totalModels <= 3 && totalStructures >= 1;

  const resolvedModels = useMemo(() => {
    const models: SelectedModel[] = MODEL_OPTIONS
      .filter((m) => selectedModels.has(modelKey(m)))
      .map((m) => ({ type: m.type, size: m.size, label: m.label }));
    if (customModel) {
      models.push({
        type: "custom" as ModelType,
        size: "medium" as ModelSize,
        label: `Custom (${customModel.name})`,
      });
    }
    return models;
  }, [selectedModels, customModel]);

  const handleRun = () => {
    if (!canRun) return;
    onRun(
      resolvedModels,
      Array.from(selectedStructures),
      customModel ?? undefined,
      userStructures.length > 0 ? userStructures : undefined
    );
  };

  return (
    <Card className="gap-0 rounded-xl bg-bg-secondary p-6">
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Model Selection */}
        <div className="flex-1">
          <h3 className="mb-3 text-base font-semibold text-text-primary">
            Models
            <span className="ml-2 text-sm font-normal text-text-muted">
              pick 2–3
            </span>
          </h3>

          {MODEL_GROUPS.map((group) => (
            <div key={group.id} className="mb-3">
              <p className="mb-1.5 text-sm text-text-secondary">
                {group.heading}
              </p>
              <div className="flex flex-wrap gap-2">
                {MODEL_OPTIONS.filter((m) => m.family === group.id).map((m) => {
                  const key = modelKey(m);
                  const checked = selectedModels.has(key);
                  return (
                    <button
                      key={key}
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={`Select ${m.label}`}
                      onClick={() => toggleModel(key)}
                      className={`min-h-9 rounded-full border px-3.5 text-sm transition-colors max-sm:min-h-11 pointer-coarse:min-h-11 ${
                        checked
                          ? "border-accent-primary bg-accent-primary/15 text-accent-strong"
                          : "border-border-subtle bg-bg-elevated text-text-muted hover:border-border-emphasis hover:text-text-secondary"
                      }`}
                    >
                      {checked ? "✓ " : ""}{m.size}
                    </button>
                  );
                })}
              </div>
              {group.notice && (
                <p className="mt-1.5 text-xs text-text-secondary">{group.notice}</p>
              )}
            </div>
          ))}

          {/* Custom model upload */}
          <div className="mb-3">
            <p className="mb-1.5 text-sm text-text-secondary">
              Custom model
            </p>
            {customModel ? (
              <div className="flex items-center gap-2 rounded-lg border border-accent-primary/50 bg-accent-primary/10 px-3 py-1.5">
                <Upload className="h-3 w-3 text-accent-strong" />
                <span className="min-w-0 truncate font-mono text-xs text-accent-strong">
                  {customModel.name}
                </span>
                <Button
                  onClick={() => setCustomModel(null)}
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto text-text-muted hover:text-text-primary"
                  aria-label="Remove custom model"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border-emphasis px-3 text-sm text-text-secondary transition-colors hover:border-border-emphasis hover:text-text-secondary">
                <Upload className="h-3 w-3" />
                Upload .model file
                <input
                  type="file"
                  accept=".model"
                  className="hidden"
                  onChange={(e) => setCustomModel(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>

          {totalModels > 3 && (
            <div role="status" className="mt-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              Max 3 models. Deselect one to proceed.
            </div>
          )}

          {/* MACE-OFF incompatibility warning */}
          {hasAnyOFF && incompatibleNames.length > 0 && (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
              <div className="flex items-start gap-2 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <div>
                  <p>
                    MACE-OFF does not support {unsupportedElements.join(", ")}.
                    {onlyOFF ? " These structures are excluded:" : " These structures will only run on MACE-MP-0:"}
                  </p>
                  <p className="mt-1 text-text-secondary">
                    {incompatibleNames.join(", ")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Precision note */}
          <div className="mt-4 flex items-start gap-1.5 text-sm text-text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            All calculations run at float64 precision on CPU for fair comparison.
          </div>
        </div>

        {/* Structure Selection */}
        <div className="flex-1">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h3 className="text-base font-semibold text-text-primary">
              Structures
              <span className="ml-2 text-sm font-normal tabular-nums text-text-muted">
                {totalStructures} selected{userStructures.length > 0 ? ` (${userStructures.length} uploaded)` : ""}
              </span>
            </h3>
            <div className="flex gap-3">
              <Button
                onClick={selectAll}
                variant="link"
                size="xs"
                className="h-auto p-0 text-sm max-sm:min-h-11 pointer-coarse:min-h-11 text-accent-strong"
              >
                Select all
              </Button>
              <Button
                onClick={selectMpSet}
                variant="link"
                size="xs"
                className="h-auto p-0 text-sm max-sm:min-h-11 pointer-coarse:min-h-11 text-accent-strong"
                title="Compounds plus every elemental reference phase they need"
              >
                Add MP set
              </Button>
              <Button
                onClick={clearAll}
                variant="link"
                size="xs"
                className="h-auto p-0 text-sm max-sm:min-h-11 pointer-coarse:min-h-11 text-text-secondary"
              >
                Clear
              </Button>
            </div>
          </div>

          {mpMissingReferences.length > 0 && (
            <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
              <div className="flex items-start gap-2 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <div>
                  <p>
                    Materials Project compounds are selected without the elemental reference
                    phase for {mpMissingReferences.map((m) => m.element).join(", ")}. No
                    formation energy can be computed for them, so those rows will report as
                    unscored.
                  </p>
                  <Button
                    onClick={addMissingMpReferences}
                    variant="link"
                    size="xs"
                    className="mt-1 h-auto p-0 text-sm text-accent-strong"
                  >
                    Add the missing reference{mpMissingReferences.length === 1 ? "" : "s"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {ALL_CATEGORIES.map((cat) => {
              const compatibleEntries = cat.entries.filter(
                (e) => !incompatibleIds.has(e.id)
              );
              const catIds = compatibleEntries.map((e) => e.id);
              const allChecked = catIds.length > 0 && catIds.every((id) => selectedStructures.has(id));
              const someChecked = catIds.some((id) => selectedStructures.has(id));

              return (
                <div key={cat.id}>
                  <div className="mb-1 flex w-full items-center gap-2">
                    <Checkbox
                      id={`cat-${cat.id}`}
                      checked={allChecked ? true : someChecked ? "indeterminate" : false}
                      onCheckedChange={() => toggleCategory(cat)}
                      disabled={catIds.length === 0}
                      aria-label={`Select all ${cat.name}`}
                    />
                    <Label
                      htmlFor={`cat-${cat.id}`}
                      className={`flex-1 gap-1.5 text-sm font-semibold text-text-primary max-sm:min-h-11 pointer-coarse:min-h-11 ${
                        catIds.length === 0 ? "opacity-40" : "cursor-pointer"
                      }`}
                    >
                      {cat.name}
                      <span className="text-sm font-normal tabular-nums text-text-muted">
                        ({incompatibleIds.size > 0
                          ? `${compatibleEntries.length}/${cat.entries.length}`
                          : cat.entries.length})
                      </span>
                    </Label>
                  </div>

                  <div className="ml-6 space-y-0.5">
                    {cat.entries.map((entry) => {
                      const isDisabled = incompatibleIds.has(entry.id);
                      const checked = selectedStructures.has(entry.id);
                      return (
                        <div
                          key={entry.id}
                          className={`flex w-full items-center gap-2 rounded px-1 py-0.5 transition-colors ${
                            isDisabled
                              ? "opacity-35"
                              : "hover:bg-bg-elevated"
                          }`}
                        >
                          <Checkbox
                            id={`entry-${entry.id}`}
                            checked={checked}
                            onCheckedChange={() => !isDisabled && toggleStructure(entry.id)}
                            disabled={isDisabled}
                            aria-label={`Select ${entry.name}`}
                            className="h-3.5 w-3.5"
                          />
                          <Label
                            htmlFor={`entry-${entry.id}`}
                            className={`flex-1 gap-0 text-sm font-normal text-text-secondary max-sm:min-h-11 pointer-coarse:min-h-11 ${
                              isDisabled ? "cursor-not-allowed" : "cursor-pointer"
                            }`}
                          >
                            <Formula text={entry.name} />
                          </Label>
                          <span className="ml-auto font-mono text-xs text-text-muted">
                            {entry.formula}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* User-uploaded structures */}
          <div className="mt-3 border-t border-border-subtle pt-3">
            <p className="mb-1.5 text-sm text-text-secondary">
              Your structures
            </p>

            {userStructures.length > 0 && (
              <div className="mb-2 space-y-1">
                {userStructures.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-center gap-2 rounded border border-accent-primary/30 bg-accent-primary/5 px-2 py-1"
                  >
                    <FileIcon className="h-3 w-3 flex-shrink-0 text-accent-strong" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-accent-strong">
                      {f.name}
                    </span>
                    <span className="text-xs tabular-nums text-text-muted">
                      {(f.size / 1024).toFixed(1)} KB
                    </span>
                    <Button
                      onClick={() => removeUserStructure(f.name)}
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${f.name}`}
                      className="flex-shrink-0 text-text-muted hover:text-error"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div
              onDrop={handleStructureDrop}
              onDragOver={(e) => e.preventDefault()}
              className="relative rounded-lg border border-dashed border-border-emphasis px-3 py-3 text-center transition-colors hover:border-accent-primary/50 hover:bg-accent-primary/5"
            >
              <input
                type="file"
                multiple
                accept={ACCEPTED_STRUCTURE_FORMATS.join(",")}
                onChange={handleStructureFileInput}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              <div className="flex items-center justify-center gap-2">
                <Upload className="h-3.5 w-3.5 text-text-muted" />
                <span className="text-sm text-text-secondary">
                  Drop or browse .xyz, .cif, .poscar, .pdb
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Run button */}
      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-xl border-t border-border-subtle bg-bg-secondary px-6 py-4">
        <Button
          onClick={handleRun}
          disabled={!canRun || isRunning}
          size="lg"
          className="h-11 gap-2.5 rounded-full px-6 text-sm font-semibold"
        >
          <Play className="h-4 w-4" aria-hidden="true" />
          Run benchmark
        </Button>
        <span className="text-sm tabular-nums text-text-muted">
          {totalModels} model{totalModels !== 1 ? "s" : ""} × {totalStructures} structure{totalStructures !== 1 ? "s" : ""} ={" "}
          <span className="text-text-secondary">{totalCalcs}</span> calculations
        </span>
      </div>
    </Card>
  );
}
