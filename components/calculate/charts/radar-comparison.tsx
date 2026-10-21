"use client";

/**
 * RadarComparison — Spider/radar chart for multi-metric model comparison.
 *
 * Compares two MACE models (e.g. custom vs. foundation) across multiple
 * accuracy metrics. Each axis represents a metric; each model gets a
 * polygon. Smaller area = better model (lower errors).
 *
 * Axes: Energy MAE, Force MAE, Force RMSE, Max Force Error
 * All axes follow the convention where smaller = better.
 */

import dynamic from "next/dynamic";
import { BASE_CONFIG, DATA_COLORS } from "./chart-config";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

/** Metrics for one model on the radar chart. */
export interface ModelMetrics {
  label: string;
  energyMAE: number;
  forceMAE: number;
  forceRMSE: number;
  maxForceError: number;
}

interface RadarComparisonProps {
  modelA: ModelMetrics;
  modelB: ModelMetrics;
  title?: string;
}

const AXES = [
  "Energy MAE (meV/atom)",
  "Force MAE (meV/\u00C5)",
  "Force RMSE (meV/\u00C5)",
  "Max Force Error (meV/\u00C5)",
];

export function RadarComparison({
  modelA,
  modelB,
  title = "Model Comparison",
}: RadarComparisonProps) {
  const toValues = (m: ModelMetrics) => [
    m.energyMAE,
    m.forceMAE,
    m.forceRMSE,
    m.maxForceError,
  ];

  const valuesA = toValues(modelA);
  const valuesB = toValues(modelB);

  const traces: Plotly.Data[] = [
    {
      type: "scatterpolar",
      r: [...valuesA, valuesA[0]],
      theta: [...AXES, AXES[0]],
      fill: "toself",
      name: modelA.label,
      fillcolor: "rgba(68,119,170,0.15)",
      line: { color: DATA_COLORS.blue, width: 2 },
      marker: { color: DATA_COLORS.blue, size: 5 },
    },
    {
      type: "scatterpolar",
      r: [...valuesB, valuesB[0]],
      theta: [...AXES, AXES[0]],
      fill: "toself",
      name: modelB.label,
      fillcolor: "rgba(170,51,119,0.15)",
      line: { color: DATA_COLORS.purple, width: 2 },
      marker: { color: DATA_COLORS.purple, size: 5 },
    },
  ];

  const layout: Partial<Plotly.Layout> = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: {
      family: "Geist Mono, ui-monospace, monospace",
      color: "#5C574E",
      size: 10,
    },
    title: { text: title, font: { size: 13, color: "#5C574E" } },
    polar: {
      bgcolor: "rgba(0,0,0,0)",
      radialaxis: {
        visible: true,
        gridcolor: "#EAE6DD",
        linecolor: "#D8D2C6",
        tickfont: { size: 9 },
      },
      angularaxis: {
        gridcolor: "#EAE6DD",
        linecolor: "#D8D2C6",
        tickfont: { size: 9 },
      },
    },
    showlegend: true,
    legend: {
      bgcolor: "rgba(0,0,0,0)",
      font: { color: "#5C574E", size: 10 },
    },
    margin: { l: 40, r: 40, t: 50, b: 40 },
    width: undefined,
    height: 400,
  };

  return (
    <Plot
      data={traces}
      layout={layout}
      config={BASE_CONFIG}
      useResizeHandler
      style={{ width: "100%", height: "400px" }}
    />
  );
}
