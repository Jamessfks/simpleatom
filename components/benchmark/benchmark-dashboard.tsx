"use client";

/**
 * BenchmarkDashboard — Tabbed results container for benchmark output.
 *
 * Six sub-tabs: Leaderboard, Forces, Timing, Energy Landscape, Agreement, and
 * vs Materials Project — the only tab that compares against an external
 * published number rather than the models against each other.
 * Detects cross-family comparisons (MP-0 vs OFF) and warns that absolute
 * energy differences are not physically meaningful due to different
 * training DFT functionals (PBE vs ωB97M-D3BJ).
 */

import { findModel } from "@/lib/contract";
import { useState, useMemo } from "react";
import {
  Trophy,
  ArrowRightLeft,
  Timer,
  TrendingUp,
  Grid3X3,
  AlertTriangle,
  Scale,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BenchmarkLeaderboard } from "./benchmark-leaderboard";
import { BenchmarkForceBars } from "./benchmark-force-bars";
import { BenchmarkTiming } from "./benchmark-timing";
import { BenchmarkEnergyLandscape } from "./benchmark-energy-landscape";
import { BenchmarkHeatmap } from "./benchmark-heatmap";
import { BenchmarkExport } from "./benchmark-export";
import { BenchmarkMpComparison } from "./benchmark-mp-comparison";
import type { BenchmarkResult } from "@/types/mace";

type TabId = "leaderboard" | "forces" | "timing" | "energy" | "heatmap" | "materials-project";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: "leaderboard", label: "Leaderboard", icon: <Trophy className="h-3.5 w-3.5" /> },
  { id: "forces", label: "Forces", icon: <ArrowRightLeft className="h-3.5 w-3.5" /> },
  { id: "timing", label: "Timing", icon: <Timer className="h-3.5 w-3.5" /> },
  { id: "energy", label: "Energy Landscape", icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { id: "heatmap", label: "Agreement", icon: <Grid3X3 className="h-3.5 w-3.5" /> },
  {
    id: "materials-project",
    label: "vs Materials Project",
    icon: <Scale className="h-3.5 w-3.5" />,
  },
];

interface DashboardProps {
  result: BenchmarkResult;
}

export function BenchmarkDashboard({ result }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>("leaderboard");

  const modelLabels = useMemo(() => {
    if (result.results.length === 0) return [];
    return result.results[0].models.map((m) => m.modelLabel);
  }, [result]);

  const isCrossFamily = useMemo(() => {
    const families = new Set(
      result.results[0]?.models.map((m) => m.modelType) ?? []
    );
    const conventions = new Set([...families].map((t) => findModel(t)?.energyConvention));
    return conventions.has("mp") && conventions.has("off");
  }, [result]);

  return (
    <div className="space-y-5">
      {/* Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-success)]/20 bg-[var(--color-success)]/5 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            <span className="absolute inset-0 animate-pulse rounded-full bg-[var(--color-success)]/50" />
            <span className="relative block h-2.5 w-2.5 rounded-full bg-[var(--color-success)]" />
          </span>
          <span className="font-sans text-sm font-bold text-[var(--color-success)]">
            Benchmark Complete
          </span>
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            {modelLabels.join(" vs ")} — {result.summary.totalCalculations} calculations in{" "}
            {result.summary.totalTime.toFixed(1)}s
          </span>
          {result.summary.errorCount > 0 && (
            <Badge
              variant="outline"
              className="rounded font-mono text-[10px] text-[var(--color-error)] border-[var(--color-error)]/30 bg-[var(--color-error)]/10"
            >
              {result.summary.errorCount} error{result.summary.errorCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <BenchmarkExport result={result} />
      </div>

      {/* Cross-family warning */}
      {isCrossFamily && (
        <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 px-5 py-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-warning)]" />
          <div className="font-mono text-xs text-[var(--color-warning)]">
            <p className="font-semibold">Cross-family comparison</p>
            <p className="mt-0.5 text-[var(--color-warning)]/80">
              MACE-MP-0 and MACE-OFF are trained on different levels of theory (PBE vs
              ωB97M-D3BJ). Absolute energy differences between them are not physically meaningful.
              Compare forces and relative energies within each family instead.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} className="gap-5">
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto rounded-none border-b border-[var(--color-border-subtle)] bg-transparent p-0"
        >
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="flex-none gap-2 whitespace-nowrap rounded-none border-transparent px-4 py-2.5 font-sans text-sm text-[var(--color-text-muted)] shadow-none after:bg-[var(--color-accent-primary)] hover:text-[var(--color-text-secondary)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--color-accent-primary)] data-[state=active]:shadow-none"
            >
              {tab.icon}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Tab Content */}
        <div className="min-h-[400px]">
          <TabsContent value="leaderboard">
            <BenchmarkLeaderboard result={result} />
          </TabsContent>
          <TabsContent value="forces">
            <BenchmarkForceBars result={result} />
          </TabsContent>
          <TabsContent value="timing">
            <BenchmarkTiming result={result} />
          </TabsContent>
          <TabsContent value="energy">
            <BenchmarkEnergyLandscape result={result} />
          </TabsContent>
          <TabsContent value="heatmap">
            <BenchmarkHeatmap result={result} />
          </TabsContent>
          <TabsContent value="materials-project">
            <BenchmarkMpComparison result={result} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
