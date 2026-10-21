"use client";

/**
 * BenchmarkHeatmap — Pairwise model agreement visualization.
 *
 * Plotly heatmap where each cell is |ΔE| in meV/atom between a pair of
 * models for a given structure. Dark cells = agreement, bright = contention.
 * For N models, shows N*(N-1)/2 pairwise rows (e.g. 3 rows for 3 models).
 */

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { BASE_LAYOUT, BASE_CONFIG } from "@/components/calculate/charts/chart-config";
import type { BenchmarkResult } from "@/types/mace";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface HeatmapProps {
  result: BenchmarkResult;
}

export function BenchmarkHeatmap({ result }: HeatmapProps) {
  const modelLabels = useMemo(() => {
    if (result.results.length === 0) return [];
    return result.results[0].models.map((m) => m.modelLabel);
  }, [result]);

  const structureNames = result.results.map((r) => r.structureName);

  const { pairLabels, z, annotations } = useMemo(() => {
    const pairs: { label: string; i: number; j: number }[] = [];
    for (let i = 0; i < modelLabels.length; i++) {
      for (let j = i + 1; j < modelLabels.length; j++) {
        pairs.push({
          label: `${shortenLabel(modelLabels[i])} vs ${shortenLabel(modelLabels[j])}`,
          i,
          j,
        });
      }
    }

    const z: (number | null)[][] = pairs.map((pair) =>
      result.results.map((r) => {
        const a = r.models[pair.i];
        const b = r.models[pair.j];
        if (
          a?.status !== "success" ||
          b?.status !== "success" ||
          a.energyPerAtom == null ||
          b.energyPerAtom == null
        ) {
          return null;
        }
        return Math.abs(a.energyPerAtom - b.energyPerAtom) * 1000;
      })
    );

    const anns: Partial<Plotly.Annotations>[] = [];
    for (let pi = 0; pi < pairs.length; pi++) {
      for (let si = 0; si < result.results.length; si++) {
        const val = z[pi][si];
        anns.push({
          x: structureNames[si],
          y: pairs[pi].label,
          text: val != null ? val.toFixed(1) : "err",
          showarrow: false,
          font: {
            color: val != null && val > 10 ? "#FFFFFF" : "#5C574E",
            size: 10,
            family: "Geist Mono, ui-monospace, monospace",
          },
        });
      }
    }

    return { pairLabels: pairs.map((p) => p.label), z, annotations: anns };
  }, [result, modelLabels, structureNames]);

  if (pairLabels.length === 0) {
    return (
      <Card className="gap-0 rounded-lg bg-[var(--color-bg-secondary)] p-6 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">
          Need at least 2 models to generate agreement heatmap.
        </p>
      </Card>
    );
  }

  return (
    <Card className="gap-0 rounded-lg bg-[var(--color-bg-secondary)] p-4">
      <h3 className="mb-2 font-sans text-sm font-bold text-[var(--color-text-primary)]">
        Model Agreement Heatmap
      </h3>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        Pairwise energy disagreement (|ΔE| in meV/atom) for each structure. Light cells indicate
        consensus; bright cells reveal contention.
      </p>
      <Plot
        data={[
          {
            type: "heatmap",
            x: structureNames,
            y: pairLabels,
            z: z,
            colorscale: [
              [0, "#E9F2E4"],
              [0.25, "#D8D2C6"],
              [0.5, "#CCBB44"],
              [1, "#EE6677"],
            ],
            colorbar: {
              // `titlefont` is deprecated in Plotly; the font lives on the title.
              title: { text: "|ΔE| (meV)", side: "right", font: { color: "#5C574E", size: 10 } },
              tickfont: { color: "#5C574E", size: 10 },
            },
            hovertemplate:
              "<b>%{x}</b><br>%{y}<br>|ΔE| = %{z:.2f} meV<extra></extra>",
            showscale: true,
          },
        ]}
        layout={{
          ...BASE_LAYOUT,
          annotations: annotations,
          xaxis: {
            ...BASE_LAYOUT.xaxis,
            tickangle: -35,
            side: "bottom",
          },
          yaxis: {
            ...BASE_LAYOUT.yaxis,
            autorange: "reversed" as const,
          },
          height: Math.max(250, pairLabels.length * 60 + 150),
          margin: { l: 180, r: 80, t: 20, b: 120 },
        }}
        config={BASE_CONFIG}
        className="w-full"
      />
    </Card>
  );
}

function shortenLabel(label: string): string {
  return label
    .replace("MACE-MP-0", "MP-0")
    .replace("MACE-OFF", "OFF");
}
