"use client";

/**
 * BenchmarkEnergyLandscape — Multi-trace energy-per-atom chart.
 *
 * Scatter+line plot: x-axis = structures, y-axis = energy/atom.
 * One trace per model with distinct colors, markers, and dash styles.
 * Overlapping points indicate model agreement; divergence reveals
 * structures where models disagree.
 */

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { BASE_LAYOUT, BASE_CONFIG, DATA_COLORS } from "@/components/calculate/charts/chart-config";
import type { BenchmarkResult } from "@/types/mace";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const MODEL_COLORS = [DATA_COLORS.blue, DATA_COLORS.red, DATA_COLORS.green];
const MARKERS = ["circle", "diamond", "square"] as const;

type Dash = "solid" | "dot" | "dashdot" | "dash" | "longdash";

interface EnergyLandscapeProps {
  result: BenchmarkResult;
}

export function BenchmarkEnergyLandscape({ result }: EnergyLandscapeProps) {
  const modelLabels = useMemo(() => {
    if (result.results.length === 0) return [];
    return result.results[0].models.map((m) => m.modelLabel);
  }, [result]);

  const structureNames = result.results.map((r) => r.structureName);

  const traces = modelLabels.map((label, mi) => ({
    name: label,
    type: "scatter" as const,
    mode: "lines+markers" as const,
    x: structureNames,
    y: result.results.map((r) => r.models[mi]?.energyPerAtom ?? null),
    marker: {
      color: MODEL_COLORS[mi],
      size: 8,
      symbol: MARKERS[mi % MARKERS.length],
    },
    line: {
      color: MODEL_COLORS[mi],
      width: 1.5,
      dash: (mi === 0 ? "solid" : mi === 1 ? "dot" : "dashdot") as Dash,
    },
    hovertemplate:
      "<b>%{x}</b><br>" + label + "<br>E/atom: %{y:.6f} eV<extra></extra>",
  }));

  return (
    <Card className="gap-0 rounded-lg bg-bg-secondary p-4">
      <h3 className="mb-2 font-sans text-sm font-bold text-text-primary">
        Energy Landscape
      </h3>
      <p className="mb-3 text-xs text-text-muted">
        Energy per atom across all structures for each model. Overlapping points indicate model
        agreement; divergence reveals structures where models disagree.
      </p>
      <Plot
        data={traces}
        layout={{
          ...BASE_LAYOUT,
          xaxis: {
            ...BASE_LAYOUT.xaxis,
            tickangle: -35,
            title: { text: "Structure", standoff: 15 },
          },
          yaxis: {
            ...BASE_LAYOUT.yaxis,
            title: { text: "Energy per Atom (eV/atom)", standoff: 10 },
          },
          height: 420,
          margin: { l: 80, r: 20, t: 30, b: 120 },
          hovermode: "closest",
        }}
        config={BASE_CONFIG}
        className="w-full"
      />
    </Card>
  );
}
