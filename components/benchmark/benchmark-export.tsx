"use client";

/**
 * BenchmarkExport — CSV, JSON, and PDF export for benchmark results.
 *
 * CSV: one row per structure, columns for each model's energy/force/time.
 * JSON: raw BenchmarkResult object.
 * PDF: @react-pdf/renderer document with leaderboard table, timing
 *   summary, and key findings (largest model disagreement).
 *
 * CSV values are escaped to handle commas/quotes in structure names.
 */

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BenchmarkResult } from "@/types/mace";

interface BenchmarkExportProps {
  result: BenchmarkResult;
}

export function BenchmarkExport({ result }: BenchmarkExportProps) {
  const [pdfLoading, setPdfLoading] = useState(false);

  const modelLabels =
    result.results.length > 0
      ? result.results[0].models.map((m) => m.modelLabel)
      : [];

  const downloadCSV = () => {
    const headers = [
      "Structure",
      "Category",
      "Atoms",
      "Ref_Cohesive_Energy (eV/atom)",
      "Ref_Source",
      ...modelLabels.flatMap((l) => [
        `${l} Energy (eV/atom)`,
        `${l} RMS Force (eV/A)`,
        `${l} Time (s)`,
      ]),
      "DeltaE_max (meV)",
    ];

    const rows = result.results.map((r) => {
      const energies = r.models
        .filter((m) => m.status === "success" && m.energyPerAtom != null)
        .map((m) => m.energyPerAtom!);
      const de =
        energies.length >= 2
          ? (Math.max(...energies) - Math.min(...energies)) * 1000
          : 0;

      return [
        csvEscape(r.structureName),
        csvEscape(r.category),
        r.atomCount,
        r.reference?.cohesiveEnergy?.value?.toFixed(3) ?? "",
        csvEscape(r.reference?.cohesiveEnergy?.source ?? ""),
        ...r.models.flatMap((m) => [
          m.energyPerAtom?.toFixed(6) ?? "error",
          m.rmsForce?.toFixed(6) ?? "error",
          m.timeTaken?.toFixed(2) ?? "error",
        ]),
        de.toFixed(2),
      ].join(",");
    });

    const csv = headers.join(",") + "\n" + rows.join("\n");
    downloadBlob(csv, "mace-benchmark.csv", "text/csv");
  };

  const downloadJSON = () => {
    downloadBlob(
      JSON.stringify(result, null, 2),
      "mace-benchmark.json",
      "application/json"
    );
  };

  const downloadPDF = async () => {
    setPdfLoading(true);
    try {
      const { renderBenchmarkBlob } = await import("./benchmark-export-pdf");
      const blob = await renderBenchmarkBlob(result);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mace-benchmark-report.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        onClick={downloadPDF}
        disabled={pdfLoading}
        variant="outline"
        size="sm"
        className="gap-1.5 border-[var(--color-accent-primary)]/50 bg-[var(--color-accent-primary)]/10 font-mono text-xs text-[var(--color-accent-primary)] hover:bg-[var(--color-accent-primary)]/15 hover:text-[var(--color-accent-primary)]"
      >
        <FileText className="h-3 w-3" />
        {pdfLoading ? "Generating..." : "Export PDF"}
      </Button>
      <Button
        onClick={downloadCSV}
        variant="outline"
        size="sm"
        className="gap-1.5 bg-[var(--color-bg-elevated)] font-mono text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-accent-primary)]/50 hover:text-[var(--color-accent-primary)]"
      >
        <Download className="h-3 w-3" /> Export CSV
      </Button>
      <Button
        onClick={downloadJSON}
        variant="outline"
        size="sm"
        className="gap-1.5 bg-[var(--color-bg-elevated)] font-mono text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-accent-primary)]/50 hover:text-[var(--color-accent-primary)]"
      >
        <Download className="h-3 w-3" /> Export JSON
      </Button>
    </div>
  );
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
