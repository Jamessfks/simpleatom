"use client";

/**
 * StructureInfo — Auto-parsed structure summary shown immediately after upload.
 *
 * PURPOSE:
 *   As suggested by the MACE founder, users should see key structure info and
 *   warnings IMMEDIATELY after uploading a file — without clicking anything.
 *   This catches huge or unexpected structures before the backend is involved.
 *
 * WHAT IT SHOWS:
 *   - Atom count (with color-coded badge: green/amber/red)
 *   - Unique elements list
 *   - Bounding box dimensions (Angstroms)
 *   - Frame count (for multi-frame XYZ files)
 *   - File name and size
 *   - Warnings for large structures:
 *       >500 atoms  → amber warning (slow calculation)
 *       >2000 atoms → red warning (may timeout)
 *
 * HOW IT WORKS:
 *   1. Parent passes the uploaded File.
 *   2. On mount (or when file changes), the file is parsed client-side
 *      using lib/parse-structure.ts — NO backend call.
 *   3. Info and warnings are rendered immediately.
 *   4. If parsing fails, a parse error is shown instead.
 *
 * THIS IS NOT THE 3D VIEWER:
 *   The 3D viewer (structure-preview.tsx) is still click-to-display.
 *   This component shows text-based info + warnings only. Both appear
 *   in the file upload section but serve different purposes:
 *     - StructureInfo  → always visible, lightweight, catches problems fast
 *     - StructurePreview → click-to-display, renders 3D viewer
 *
 * DEPENDENCIES:
 *   - lib/parse-structure.ts — client-side file parser
 *
 * THRESHOLDS (adjustable):
 *   - LARGE_THRESHOLD  = 500 atoms  → amber warning
 *   - VLARGE_THRESHOLD = 2000 atoms → red critical warning
 *   - HUGE_BOX_THRESHOLD = 100 Å   → warning about very large simulation box
 *
 * EXTENDING:
 *   To add new checks (e.g. missing elements, overlapping atoms), add them
 *   in the warnings section below. Each warning follows the same pattern:
 *   condition → icon + colored border + message.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Info, CheckCircle } from "lucide-react";
import {
  parseStructureFile,
  type ParsedStructure,
} from "@/lib/parse-structure";
import { CONTRACT } from "@/lib/contract";
import { Badge } from "@/components/ui/badge";
import { Formula } from "@/components/ui/formula";

// ---------------------------------------------------------------------------
// Warning thresholds
// ---------------------------------------------------------------------------

/** Atom count above this triggers an amber warning. */
const LARGE_THRESHOLD = 500;
/** Atom count above this triggers a red critical warning. */
const VLARGE_THRESHOLD = 2000;
/** Bounding box dimension (any axis) above this triggers a box size warning. */
const HUGE_BOX_THRESHOLD = 100; // Angstroms
/**
 * Atoms closer than this overlap. Read from the registry, where the engine's
 * refusal (`overlapping_atoms`) and the validator read the same value (D153).
 */
const MIN_DISTANCE = CONTRACT.structureChecks.minInteratomicDistanceA; // Angstroms

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StructureInfoProps {
  /** The uploaded file to parse and display info for. */
  file: File;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StructureInfo({ file }: StructureInfoProps) {
  const [parsed, setParsed] = useState<ParsedStructure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(true);

  // Auto-parse when the file changes
  useEffect(() => {
    let cancelled = false;
    setParsing(true);
    setError(null);
    setParsed(null);

    parseStructureFile(file)
      .then((result) => {
        if (cancelled) return;
        if (result.atomCount === 0) {
          setError("No atoms found. Check the file format.");
        } else {
          setParsed(result);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to parse file.");
      })
      .finally(() => {
        if (!cancelled) setParsing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  // ── Loading state ──
  if (parsing) {
    return (
      <div className="mt-3 flex items-center gap-2 text-sm text-text-muted">
        <div className="h-3 w-3 animate-spin rounded-full border border-border-subtle border-t-accent-primary" />
        Parsing structure...
      </div>
    );
  }

  // ── Parse error ──
  if (error) {
    return (
      <div className="mt-3 rounded border border-error/40 bg-error/10 p-3 text-sm text-error">
        <strong>Parse error:</strong> {error}
      </div>
    );
  }

  if (!parsed) return null;
  return <ParsedStructureInfo parsed={parsed} />;
}

/**
 * The summary and warnings for a structure that has been parsed. Split from
 * `StructureInfo` (which parses in an effect) so that it can be rendered, and
 * tested, with a structure in hand.
 */
export function ParsedStructureInfo({ parsed }: { parsed: ParsedStructure }) {
  // ── Compute warnings ──
  const atomCount = parsed.atomCount;
  const isVeryLarge = atomCount > VLARGE_THRESHOLD;
  const isLarge = atomCount > LARGE_THRESHOLD && !isVeryLarge;
  const boxSize = parsed.boundingBox.size;
  const isHugeBox =
    boxSize[0] > HUGE_BOX_THRESHOLD ||
    boxSize[1] > HUGE_BOX_THRESHOLD ||
    boxSize[2] > HUGE_BOX_THRESHOLD;

  // Atom count badge color
  const countColor = isVeryLarge
    ? "text-error border-error/40 bg-error/10"
    : isLarge
      ? "text-warning border-warning/40 bg-warning/10"
      : "text-success border-success/40 bg-success/10";

  // ── Geometry sanity checks ──
  const hasOverlap = parsed.minNeighborDist < MIN_DISTANCE;
  const hasWarnings = isLarge || isVeryLarge || isHugeBox || parsed.isPlanar || hasOverlap || parsed.notes.length > 0;

  // ── Geometry details — tight key/value rows (Materials-Project style:
  //    bold label left, value right, hairline rule between rows). Precision
  //    is picked once per quantity: bounding box to 0.1 Å (a rough extent),
  //    min distance to 0.001 Å (fine enough to catch near-overlaps) — and
  //    applied consistently everywhere that quantity is shown, including in
  //    the "huge box" warning below (which used to round differently).
  const geometryRows: { label: string; value: React.ReactNode }[] = [
    {
      label: "Bounding box",
      value: `${boxSize[0].toFixed(1)} × ${boxSize[1].toFixed(1)} × ${boxSize[2].toFixed(1)} Å`,
    },
    {
      label: "Min distance",
      value:
        parsed.minNeighborDist === Infinity ? (
          "N/A"
        ) : (
          <span className={hasOverlap ? "font-bold text-error" : undefined}>
            {parsed.minNeighborDist.toFixed(3)} Å
          </span>
        ),
    },
  ];
  if (parsed.frameCount > 1) {
    geometryRows.push({ label: "Frames", value: `${parsed.frameCount} (first frame used)` });
  }

  return (
    <div className="mt-3 space-y-2">
      {/* ── Structure info card ── */}
      <div className="rounded border border-border-subtle bg-bg-secondary p-3">
        <div className="mb-2 flex items-center gap-2">
          <Info className="h-3.5 w-3.5 text-accent-strong" strokeWidth={1.75} />
          <span className="text-sm font-semibold text-text-primary">
            Structure info
          </span>
        </div>

        {/* Formula + atom count header */}
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sm font-semibold text-text-primary">
            <Formula text={parsed.empiricalFormula} />
          </span>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${countColor}`}>
            {atomCount.toLocaleString()} atoms
          </span>
        </div>

        {/* Per-element breakdown — shows count per element */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {parsed.elements.map((el) => (
            <Badge
              key={el}
              variant="outline"
              className="gap-0.5 bg-bg-surface font-mono text-xs font-normal text-text-secondary"
            >
              {el}
              <span className="text-accent-strong">
                ×{parsed.elementCounts[el]}
              </span>
            </Badge>
          ))}
        </div>

        {/* Geometry details — tight key/value rows (bold label left, value right, hairline rule) */}
        <div className="text-sm">
          {geometryRows.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-3 border-t border-border-subtle py-1 first:border-t-0 first:pt-0 last:pb-0"
            >
              <span className="text-text-muted">{row.label}</span>
              <span className="text-right font-mono text-xs tabular-nums text-text-primary">{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Warnings ── */}

      {/* Overlapping atoms — red critical (closer than MIN_DISTANCE) */}
      {hasOverlap && (
        <div className="flex items-start gap-2 rounded border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <div>
            <strong>Overlapping atoms detected</strong> (min distance{" "}
            {parsed.minNeighborDist.toFixed(3)} Å, closer than {MIN_DISTANCE} Å).
            This usually indicates corrupted or incorrectly generated
            coordinates, and the calculation refuses it.
          </div>
        </div>
      )}

      {/* What the reader had to decide about this file (read as plain XYZ, a
          placeholder cell ignored, symmetry it cannot expand…). */}
      {parsed.notes.map((note) => (
        <div key={note} className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <div>{note}</div>
        </div>
      ))}

      {/* Flat molecule — amber (all atoms coplanar with >3 atoms) */}
      {parsed.isPlanar && (
        <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <div>
            <strong>Structure is completely flat (2D).</strong> All atoms lie in
            the same plane. If this molecule should have 3D geometry, the
            coordinates may be incorrect.
          </div>
        </div>
      )}

      {/* Very large structure (>2000 atoms) — red critical */}
      {isVeryLarge && (
        <div className="flex items-start gap-2 rounded border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <div>
            <strong>Very large structure ({atomCount.toLocaleString()} atoms).</strong>{" "}
            Calculations will be very slow or may timeout on the server.
            Consider using a smaller subset of your system.
          </div>
        </div>
      )}

      {/* Large structure (>500 atoms) — amber warning */}
      {isLarge && (
        <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <div>
            <strong>Large structure ({atomCount.toLocaleString()} atoms).</strong>{" "}
            Calculation may take several minutes. Single-point energy is
            recommended for large systems.
          </div>
        </div>
      )}

      {/* Huge bounding box — may indicate periodic system or error */}
      {isHugeBox && (
        <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <div>
            <strong>
              Very large simulation box ({boxSize[0].toFixed(1)} ×{" "}
              {boxSize[1].toFixed(1)} × {boxSize[2].toFixed(1)} Å).
            </strong>{" "}
            This may be a periodic system with a large cell. Ensure coordinates
            are correct.
          </div>
        </div>
      )}

      {/* All clear — no issues */}
      {!hasWarnings && (
        <div className="flex items-center gap-2 text-sm text-success">
          <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          Structure looks good. Ready to calculate.
        </div>
      )}
    </div>
  );
}

/*
 * ============================================================================
 * DOCUMENTATION: StructureInfo — Automatic Structure Warnings
 * ============================================================================
 *
 * MOTIVATION (from MACE founder):
 *   "One idea that could make the tool even more useful is to include an
 *   optional visualisation of the uploaded structure. This would help users
 *   quickly catch any huge or unexpected structures before the site gets
 *   overwhelmed."
 *
 * This component addresses that by auto-parsing the uploaded file and showing:
 *   - Atom count (color-coded: green = fine, amber = large, red = very large)
 *   - Element list (to verify it's the right structure)
 *   - Bounding box (to check system size)
 *   - Warnings for large structures or huge simulation boxes
 *   - A "looks good" confirmation for small/normal structures
 *
 * ARCHITECTURE:
 *   StructureInfo is a child of FileUploadSection. It receives a single File
 *   prop and auto-parses it on mount using lib/parse-structure.ts. No user
 *   action is needed — the info appears the moment a file is uploaded.
 *
 *   The 3D viewer (StructurePreview) remains click-to-display, so there are
 *   two levels of inspection:
 *     Level 1: StructureInfo (auto, text-only, instant)
 *     Level 2: StructurePreview (click, 3D viewer, heavier)
 *
 * WARNING THRESHOLDS:
 *   | Condition            | Threshold     | Severity | Color  |
 *   |----------------------|---------------|----------|--------|
 *   | Large structure      | >500 atoms    | Warning  | Amber  |
 *   | Very large structure | >2000 atoms   | Critical | Red    |
 *   | Huge bounding box    | >100 A (axis) | Warning  | Amber  |
 *
 *   These are defined at the top of this file and can be adjusted.
 *
 * FILES INVOLVED:
 *   - lib/parse-structure.ts            — Parser (XYZ/CIF/PDB/POSCAR)
 *   - components/calculate/structure-info.tsx  — This file (auto info + warnings)
 *   - components/calculate/structure-preview.tsx — 3D viewer (click-to-display)
 *   - components/calculate/file-upload-section.tsx — Parent that renders both
 *
 * EXTENDING:
 *   To add new warnings, add a condition check after the existing warnings
 *   section. Follow the pattern:
 *     {condition && (
 *       <div className="... border-COLOR ...">
 *         <AlertTriangle /> <strong>Title.</strong> Description.
 *       </div>
 *     )}
 *
 *   Examples of future warnings:
 *   - Missing hydrogen atoms
 *   - Unsupported elements for selected model
 *   - Very small structures (< 3 atoms)
 *
 * FUTURE (ml-peg integration):
 *   When loading structures from the ml-peg catalog, StructureInfo can
 *   display the same stats. The ParsedStructure format is the same
 *   regardless of how the structure was obtained (file upload or catalog).
 * ============================================================================
 */
