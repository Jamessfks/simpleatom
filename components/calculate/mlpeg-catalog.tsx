"use client";

/**
 * MlPegCatalog — Browse and select benchmark structures from ml-peg.
 *
 * PURPOSE:
 *  
 *   As the MACE founder suggested: "it could be really fun to connect the
 *   two tools, so that users could select a structure directly from the
 *   ml-peg menu instead of uploading a new one."
 * 
 *   The catalog is a pre-loaded library of benchmark structures so users can try the 
 *   MACE calculator instantly without needing to upload their own files.
 *
 *   This component provides a browsable catalog of benchmark structures from
 *   ml-peg (https://github.com/ddmms/ml-peg). Users can pick a structure
 *   (e.g. "Silicon diamond", "Ethanol") and it's auto-loaded into the
 *   calculator — no file upload needed.
 *
 * HOW IT WORKS:
 *   1. User clicks "Browse ml-peg structures" to open the catalog.
 *   2. Structures are organized by category (Bulk Crystals, Molecules, etc.)
 *      matching ml-peg's folder structure.
 *   3. User clicks a structure → it's converted to a File object and passed
 *      to the parent's onSelect callback.
 *   4. The parent (file-upload-section) sets it as the uploaded file, and the
 *      rest of the pipeline (info, preview, calculation) works as normal.
 *
 * DATA SOURCE:
 *   Structures are embedded in lib/mlpeg-catalog.ts as XYZ strings. This
 *   avoids CORS issues and network dependency. The catalog mirrors the
 *   categories in ml-peg's app/ directory.
 *
 * DEPENDENCIES:
 *   - lib/mlpeg-catalog.ts — Catalog data and helper functions
 *
 * SEE ALSO:
 *   - ml-peg repository: https://github.com/ddmms/ml-peg
 *   - ml-peg live guide:  https://ml-peg.stfc.ac.uk
 */

import { useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronDown, ChevronRight, X, Atom, FlaskConical } from "lucide-react";
import {
  getCategories,
  catalogEntryToFile,
  getCatalogSize,
  type CatalogEntry,
  type CatalogCategory,
} from "@/lib/mlpeg-catalog";
import { Formula } from "@/components/ui/formula";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MlPegCatalogProps {
  /**
   * Called when the user selects a structure from the catalog.
   * Receives a File object (XYZ format) that can be used like an upload.
   */
  onSelect: (file: File) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MlPegCatalog({ onSelect }: MlPegCatalogProps) {
  // Whether the catalog panel is open
  const [isOpen, setIsOpen] = useState(false);
  // Which categories are expanded
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const categories = getCategories();
  const totalStructures = getCatalogSize();

  // Toggle a category's expanded state
  const toggleCategory = (categoryId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  // Handle structure selection
  const handleSelect = (entry: CatalogEntry) => {
    const file = catalogEntryToFile(entry);
    onSelect(file);
    setIsOpen(false); // Close catalog after selection
  };

  return (
    <div className="mt-3">
      {/* ── Toggle button ── */}
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 rounded border border-border-emphasis bg-accent-primary/10 px-4 py-2 font-mono text-xs text-accent-strong transition-colors hover:bg-accent-primary/15 hover:border-accent-primary"
        >
          <BookOpen className="h-4 w-4" strokeWidth={1.75} />
          Browse ml-peg structures ({totalStructures})
        </button>
      ) : (
        /* ── Catalog panel ── */
        <div className="rounded-lg border border-border-subtle bg-bg-secondary p-4">
          {/* Header */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-accent-strong" strokeWidth={1.75} />
              <h3 className="text-sm font-semibold text-text-primary">
                ML-PEG benchmark structures
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              title="Close catalog"
              aria-label="Close catalog"
              className="rounded p-1 text-text-muted transition-colors hover:text-error"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>

          <p className="mb-4 font-mono text-xs text-text-muted">
            Select a benchmark structure from the{" "}
            <a
              href="https://github.com/ddmms/ml-peg"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-strong underline hover:text-accent-strong"
            >
              ml-peg
            </a>{" "}
            catalog. Click a structure to load it into the calculator.
          </p>

          {/* ── Category list ── */}
          <div className="space-y-1">
            {categories.map((category) => (
              <CategorySection
                key={category.id}
                category={category}
                isExpanded={expanded.has(category.id)}
                onToggle={() => toggleCategory(category.id)}
                onSelect={handleSelect}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between">
            <p className="font-mono text-xs text-text-muted">
              Structures from{" "}
              <a
                href="https://github.com/ddmms/ml-peg"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                ml-peg v0.2.2
              </a>
              {" · "}
              {totalStructures} structures · GPL-3.0 license
            </p>
            <Link
              href="/benchmark"
              className="flex items-center gap-1.5 font-mono text-xs text-accent-strong transition-colors hover:text-accent-hover"
            >
              <FlaskConical className="h-3 w-3" strokeWidth={1.75} />
              Run full benchmark →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category Section (expandable)
// ---------------------------------------------------------------------------

function CategorySection({
  category,
  isExpanded,
  onToggle,
  onSelect,
}: {
  category: CatalogCategory;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: (entry: CatalogEntry) => void;
}) {
  return (
    <div className="rounded border border-border-subtle bg-bg-elevated">
      {/* Category header (click to expand) */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 font-mono text-xs transition-colors hover:bg-accent-primary/15"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-accent-strong" strokeWidth={1.75} />
        ) : (
          <ChevronRight className="h-3 w-3 text-text-muted" strokeWidth={1.75} />
        )}
        <span className="font-bold text-text-primary">{category.name}</span>
        <span className="text-text-muted">
          ({category.entries.length})
        </span>
      </button>

      {/* Expanded: show entries */}
      {isExpanded && (
        <div className="border-t border-border-subtle px-2 py-1">
          {category.entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              onSelect={() => onSelect(entry)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry Row (clickable structure)
// ---------------------------------------------------------------------------

function EntryRow({
  entry,
  onSelect,
}: {
  entry: CatalogEntry;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded px-3 py-2 text-left font-mono text-xs transition-colors hover:bg-accent-primary/15"
    >
      <Atom className="h-3.5 w-3.5 shrink-0 text-accent-strong" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-primary"><Formula text={entry.name} /></span>
          <span className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-xs text-accent-strong">
            {entry.formula}
          </span>
          <span className="text-text-muted">
            {entry.atomCount} atoms
          </span>
        </div>
        <p className="mt-0.5 truncate text-text-muted">{entry.description}</p>
      </div>
      <span className="shrink-0 rounded border border-border-subtle px-1.5 py-0.5 text-xs text-accent-strong">
        {entry.recommendedModel === "MACE-OFF" ? "OFF" : "MPA"}
      </span>
    </button>
  );
}

/*
 * ============================================================================
 * DOCUMENTATION: ml-peg Catalog Integration
 * ============================================================================
 *
 * WHAT THIS DOES:
 *   Provides a "Browse ml-peg structures" button in the upload section.
 *   When opened, users see a categorized list of benchmark structures from
 *   the ml-peg project. Clicking a structure loads it into the calculator.
 *
 * CATEGORIES (matching ml-peg app/ folders):
 *   | Category               | ml-peg path                          | Examples          |
 *   |------------------------|--------------------------------------|-------------------|
 *   | Bulk Crystals          | ml_peg/app/bulk_crystal/             | Si, Cu, NaCl, Fe  |
 *   | Molecular Systems      | ml_peg/app/molecular/                | H2O, ethanol, C6H6 |
 *   | Non-Covalent           | ml_peg/app/non_covalent_interactions | Water dimer       |
 *   | Surfaces               | ml_peg/app/surfaces/                 | Cu(111), Si(111)  |
 *
 * HOW SELECTION WORKS:
 *   1. User clicks a structure entry.
 *   2. catalogEntryToFile() (from lib/mlpeg-catalog.ts) converts the XYZ
 *      string into a File object.
 *   3. The File is passed to onSelect → parent sets it as the uploaded file.
 *   4. StructureInfo auto-parses it, StructurePreview can show it in 3D,
 *      and the calculator button becomes active.
 *
 * MODEL RECOMMENDATIONS:
 *   Each entry has a recommendedModel field:
 *   - "MACE-MPA-0" for bulk crystals and surfaces (materials)
 *   - "MACE-OFF" for molecules and non-covalent systems (organics)
 *   Shown as "MP" or "OFF" badge in the UI.
 *
 * FILES INVOLVED:
 *   - lib/mlpeg-catalog.ts              — Catalog data + helper functions
 *   - components/calculate/mlpeg-catalog.tsx — This file (browser UI)
 *   - components/calculate/file-upload-section.tsx — Parent integration
 *
 * EXTENDING THE CATALOG:
 *   1. Open lib/mlpeg-catalog.ts
 *   2. Add a new entry to the appropriate category:
 *      {
 *        id: "unique-id",
 *        name: "Display Name",
 *        description: "What this structure is",
 *        formula: "Chemical formula",
 *        atomCount: N,
 *        elements: ["El1", "El2"],
 *        recommendedModel: "MACE-MPA-0" or "MACE-OFF",
 *        xyzData: `N\nComment\nEl1 x y z\n...`,
 *      }
 *   3. The entry will automatically appear in the UI.
 *
 * FUTURE IMPROVEMENTS:
 *   - Dynamic fetching from ml-peg's S3 bucket when CORS is available
 *   - Search/filter across all structures
 *   - Auto-set the model type based on recommendedModel when a structure is
 *     selected (currently just shown as a badge)
 *   - Preview thumbnail for each structure
 *   - More structures from ml-peg's conformers, supramolecular, lanthanides
 *     categories as they become available
 *
 * REFERENCE:
 *   - ml-peg repository: https://github.com/ddmms/ml-peg
 *   - ml-peg live guide: https://ml-peg.stfc.ac.uk
 *   - ml-peg categories: ml_peg/app/{bulk_crystal,molecular,conformers,
 *     surfaces,non_covalent_interactions,supramolecular,...}
 * ============================================================================
 */
