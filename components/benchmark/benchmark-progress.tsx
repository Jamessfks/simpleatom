"use client";

/**
 * BenchmarkProgress — Indeterminate progress display during benchmark.
 *
 * Shows a shimmer progress bar (not percentage-based) because the API
 * processes all calculations in a single batch — individual completion
 * events are not streamed. Displays elapsed time and a grid of
 * structure cards with pulsing status dots.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { SelectedModel } from "./benchmark-config";

interface BenchmarkProgressProps {
  models: SelectedModel[];
  structureIds: string[];
  structureNames: Record<string, string>;
  total: number;
  startTime: number;
}

export function BenchmarkProgress({
  models,
  structureIds,
  structureNames,
  total,
  startTime,
}: BenchmarkProgressProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  return (
    <Card className="gap-0 rounded-xl bg-bg-secondary p-6">
      {/* Overall progress */}
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-accent-strong" />
            <span className="font-sans text-sm font-semibold text-text-primary">
              Running Benchmark
            </span>
          </div>
          <span className="font-mono text-xs text-text-muted">
            {models.length} models × {structureIds.length} structures = {total} calculations
          </span>
        </div>
        {/* Indeterminate shimmer bar */}
        <div className="relative h-2 overflow-hidden rounded-full bg-bg-elevated">
          <div className="absolute inset-0 h-full w-1/3 animate-[shimmer_1.5s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-transparent via-accent-primary/60 to-transparent" />
        </div>
        <div className="mt-2 flex justify-between font-mono text-xs text-text-muted">
          <span>Elapsed: {formatTime(elapsed)}</span>
          <span>Server is processing all calculations in batch...</span>
        </div>
      </div>

      {/* Structure grid — all show as "running" */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {structureIds.map((sid) => (
          <Card
            key={sid}
            className="gap-0 rounded-lg bg-bg-elevated px-3 py-2"
          >
            <p className="mb-1.5 truncate font-mono text-xs font-semibold text-text-secondary">
              {structureNames[sid] || sid}
            </p>
            <div className="flex gap-1.5">
              {models.map((m, i) => (
                <div key={i} className="flex items-center gap-1" title={m.label}>
                  <span className="relative h-2.5 w-2.5">
                    <span className="absolute inset-0 animate-ping rounded-full bg-accent-primary/50" />
                    <span className="relative block h-2.5 w-2.5 rounded-full bg-accent-primary" />
                  </span>
                  <span className="font-mono text-xs text-text-muted">
                    {m.size[0].toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </Card>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
