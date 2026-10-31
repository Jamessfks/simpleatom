"use client";

/**
 * BenchmarkPage — Multi-model comparison against ml-peg structures.
 *
 * Three-phase UI: configuration → running → results.
 * The calculation is a single batch POST to /api/benchmark — the server
 * runs all (model × structure) pairs and returns everything at once.
 * Progress is shown as an indeterminate shimmer because individual
 * calculation status is not streamed.
 */

import { useState, useCallback } from "react";
import { FlaskConical } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import {
  BenchmarkConfig,
  type SelectedModel,
} from "@/components/benchmark/benchmark-config";
import { BenchmarkProgress } from "@/components/benchmark/benchmark-progress";
import { BenchmarkDashboard } from "@/components/benchmark/benchmark-dashboard";
import { MLPEG_CATALOG } from "@/lib/mlpeg-catalog";
import { MP_REFERENCE_ENTRIES } from "@/lib/mp-reference";
import type { BenchmarkResult } from "@/types/mace";

type Phase = "config" | "running" | "results";

// Both selectable families, so the progress list can name every structure it is
// waiting on rather than falling back to a bare id.
const structureNameMap: Record<string, string> = {};
for (const cat of MLPEG_CATALOG) {
  for (const e of cat.entries) {
    structureNameMap[e.id] = e.name;
  }
}
for (const e of MP_REFERENCE_ENTRIES) {
  structureNameMap[e.id] = e.name;
}

export default function BenchmarkPage() {
  const [phase, setPhase] = useState<Phase>("config");
  const [result, setResult] = useState<BenchmarkResult | null>(null);

  const [models, setModels] = useState<SelectedModel[]>([]);
  const [structureIds, setStructureIds] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  // Set when a run starts (an event handler), so render never reads a ref or
  // calls the impure Date.now().
  const [startTime, setStartTime] = useState(0);

  const handleRun = useCallback(
    async (
      selectedModels: SelectedModel[],
      selectedIds: string[],
      customModelFile?: File,
      userStructureFiles?: File[],
    ) => {
      setModels(selectedModels);
      setStructureIds(selectedIds);
      const structureCount =
        selectedIds.length + (userStructureFiles?.length ?? 0);
      setTotal(selectedModels.length * structureCount);
      setPhase("running");
      const runStart = Date.now();
      setStartTime(runStart);

      try {
        const payload = {
          models: selectedModels.map((m) => ({ type: m.type, size: m.size })),
          structureIds: selectedIds,
          calculationType: "single-point",
        };

        const hasFiles =
          !!customModelFile ||
          (userStructureFiles && userStructureFiles.length > 0);

        let response: Response;
        if (hasFiles) {
          const formData = new FormData();
          formData.append("json", JSON.stringify(payload));
          if (customModelFile) {
            formData.append("model", customModelFile);
          }
          if (userStructureFiles) {
            for (const f of userStructureFiles) {
              formData.append("structures", f);
            }
          }
          response = await fetch("/api/benchmark", {
            method: "POST",
            body: formData,
          });
        } else {
          response = await fetch("/api/benchmark", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Benchmark request failed");
        }

        const data: BenchmarkResult = await response.json();
        setResult(data);
        setPhase("results");
      } catch (err) {
        console.error("Benchmark failed:", err);
        setResult({
          status: "error",
          results: [],
          summary: {
            totalStructures: selectedIds.length,
            totalModels: selectedModels.length,
            totalCalculations: selectedModels.length * selectedIds.length,
            successCount: 0,
            errorCount: selectedModels.length * selectedIds.length,
            totalTime: (Date.now() - runStart) / 1000,
          },
        });
        setPhase("results");
      }
    },
    [],
  );

  const handleReset = () => {
    setPhase("config");
    setResult(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Page sub-header */}
      <div className="border-b border-border-subtle bg-bg-primary/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
              <FlaskConical className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="font-serif text-2xl font-semibold tracking-tight text-text-primary">
                Benchmark
              </h1>
              <p className="mt-0.5 text-sm text-text-secondary">
                Compare MACE models across ml-peg reference structures.
              </p>
            </div>
          </div>
          {phase === "results" && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              New benchmark
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <main id="main" className="mx-auto max-w-7xl px-6 py-8">
        <div className="space-y-6">
          {phase === "config" && (
            <BenchmarkConfig onRun={handleRun} isRunning={false} />
          )}

          {phase === "running" && (
            <BenchmarkProgress
              models={models}
              structureIds={structureIds}
              structureNames={structureNameMap}
              total={total}
              startTime={startTime}
            />
          )}

          {phase === "results" &&
            result &&
            (result.status === "error" && result.results.length === 0 ? (
              <div className="rounded-2xl border border-error/25 bg-error/5 p-8 text-center">
                <p className="font-serif text-lg font-semibold text-error">
                  Benchmark failed
                </p>
                <p className="mt-2 text-sm text-text-secondary">
                  All calculations returned errors. Check that the Python
                  backend is running.
                </p>
                <Button className="mt-4" onClick={handleReset}>
                  Try again
                </Button>
              </div>
            ) : (
              <BenchmarkDashboard result={result} />
            ))}
        </div>

        {/* Attribution */}
        <p className="mt-12 border-t border-border-subtle pt-6 text-center text-sm text-text-muted">
          Inspired by{" "}
          <a
            href="https://ml-peg.stfc.ac.uk"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-strong hover:underline"
          >
            ml-peg
          </a>{" "}
          and{" "}
          <a
            href="https://mlip-testing.stfc.ac.uk:8050"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-strong hover:underline"
          >
            STFC MLIP Testing
          </a>
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
