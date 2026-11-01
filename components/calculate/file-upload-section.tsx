"use client";

/**
 * FileUploadSection — structure input.
 *
 * Three input methods behind a segmented control (Upload / Catalog / SMILES),
 * plus a selected-structure panel with instant info and an on-demand 3D
 * preview. Rebuilt on shadcn primitives and the warm light theme.
 *
 * SEE ALSO:
 *   - lib/parse-structure.ts   — client-side XYZ/CIF/PDB/POSCAR parser
 *   - components/calculate/structure-info.tsx     — instant stats + warnings
 *   - components/calculate/structure-preview.tsx  — on-demand 3D viewer
 */

import { StepTitle } from "@/components/calculate/step-title";
import { useCallback } from "react";
import { Upload, X, File as FileIcon } from "lucide-react";
import { MlPegCatalog } from "./mlpeg-catalog";
import { SmilesInput } from "./smiles-input";
import { StructureInfo } from "./structure-info";
import { StructurePreview } from "./structure-preview";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface FileUploadSectionProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
}

const ACCEPTED_FORMATS = [".xyz", ".cif", ".poscar", ".contcar", ".pdb"];

export function getTotalFilesSize(files: File[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

export function FileUploadSection({
  files,
  onFilesChange,
}: FileUploadSectionProps) {
  // Only one file at a time — a new selection replaces the previous one.
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length > 0) onFilesChange([dropped[0]]);
    },
    [onFilesChange],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        onFilesChange([e.target.files[0]]);
      }
    },
    [onFilesChange],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <StepTitle step={1}>Structure</StepTitle>
          <CardDescription>
            Upload a file, choose a benchmark structure, or generate one from a
            SMILES string.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="upload">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload">Upload</TabsTrigger>
              <TabsTrigger value="catalog">Catalog</TabsTrigger>
              <TabsTrigger value="smiles">SMILES</TabsTrigger>
            </TabsList>

            {/* Upload */}
            <TabsContent value="upload" className="mt-4">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="group relative cursor-pointer rounded-xl border-2 border-dashed border-border-emphasis bg-bg-surface p-10 text-center transition-colors hover:border-accent-primary hover:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
              >
                <input
                  type="file"
                  accept={ACCEPTED_FORMATS.join(",")}
                  onChange={handleFileInput}
                  aria-label="Upload a structure file"
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
                <Upload className="mx-auto mb-3 h-9 w-9 text-accent-strong" strokeWidth={1.5} />
                <p className="text-sm font-medium text-text-primary">
                  Drag &amp; drop a structure file
                </p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  or click to browse
                </p>
                <p className="mt-3 font-mono text-xs text-text-secondary">
                  {ACCEPTED_FORMATS.join("  ·  ")}
                </p>
              </div>
            </TabsContent>

            {/* Catalog */}
            <TabsContent value="catalog" className="mt-4">
              <p className="mb-3 text-xs text-text-secondary">
                Select a benchmark structure from the{" "}
                <a
                  href="https://github.com/ddmms/ml-peg"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-strong underline-offset-2 hover:underline"
                >
                  ml-peg
                </a>{" "}
                catalog — no file needed.
              </p>
              <MlPegCatalog onSelect={(file) => onFilesChange([file])} />
            </TabsContent>

            {/* SMILES */}
            <TabsContent value="smiles" className="mt-4">
              <p className="mb-3 text-xs text-text-secondary">
                Enter a{" "}
                <a
                  href="https://en.wikipedia.org/wiki/Simplified_molecular-input_line-entry_system"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-strong underline-offset-2 hover:underline"
                >
                  SMILES
                </a>{" "}
                string to generate a 3D structure with RDKit (auto-selects
                MACE-OFF).
              </p>
              <SmilesInput onFilesChange={onFilesChange} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Selected structure */}
      {files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">
              Selected structure
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-surface p-3">
              <div className="flex items-center gap-3">
                <FileIcon className="h-4 w-4 text-accent-strong" />
                <div>
                  <p className="font-mono text-xs text-text-primary">
                    {files[0].name}
                  </p>
                  <p className="font-mono text-xs text-text-muted">
                    {(files[0].size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onFilesChange([])}
                aria-label="Remove selected structure"
                className="touch-target rounded p-1 text-text-muted transition-colors hover:text-error"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <StructureInfo file={files[0]} />
            <StructurePreview files={files} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
