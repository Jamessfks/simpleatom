"use client";

/**
 * ErrorHistogram — Distribution of prediction errors.
 *
 * Shows how force or energy errors are distributed across the dataset.
 * A narrow, centered distribution indicates a well-trained model.
 * Asymmetry suggests systematic bias.
 *
 * Features:
 *   - Histogram with automatic bin count
 *   - Mean and standard deviation annotated
 *   - Vertical dashed line at mean
 *   - Plotly modebar for export
 */

import dynamic from "next/dynamic";
import { BASE_LAYOUT, BASE_CONFIG, DATA_COLORS } from "./chart-config";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface ErrorHistogramProps {
  /** Error values (predicted - reference). */
  errors: number[];
  /** X-axis label (e.g. "Force Error (eV/A)"). */
  xLabel?: string;
  /** Chart title. */
  title?: string;
  /** Bar color. */
  color?: string;
}

export function ErrorHistogram({
  errors,
  xLabel = "Error",
  title = "Error Distribution",
  color = DATA_COLORS.red,
}: ErrorHistogramProps) {
  if (errors.length === 0) return null;

  const mean = errors.reduce((s, v) => s + v, 0) / errors.length;
  const variance =
    errors.reduce((s, v) => s + (v - mean) ** 2, 0) / errors.length;
  const std = Math.sqrt(variance);

  // `nbinsx` is a real histogram attribute that @types/plotly.js omits.
  const histogram: Partial<Plotly.PlotData> & { nbinsx: number } = {
    x: errors,
    type: "histogram",
    name: "Errors",
    marker: { color, opacity: 0.7 },
    nbinsx: Math.min(50, Math.max(10, Math.floor(Math.sqrt(errors.length)))),
  };
  const traces: Plotly.Data[] = [histogram];

  const layout: Partial<Plotly.Layout> = {
    ...BASE_LAYOUT,
    title: { text: title, font: { size: 13, color: "#5C574E" } },
    xaxis: {
      ...BASE_LAYOUT.xaxis,
      title: { text: xLabel, font: { size: 11 } },
    },
    yaxis: {
      ...BASE_LAYOUT.yaxis,
      title: { text: "Count", font: { size: 11 } },
    },
    shapes: [
      {
        type: "line",
        x0: mean,
        x1: mean,
        y0: 0,
        y1: 1,
        yref: "paper",
        line: { color: "#5C574E", dash: "dash", width: 1.5 },
      },
    ],
    annotations: [
      {
        x: 0.98,
        y: 0.95,
        xref: "paper",
        yref: "paper",
        text: `Mean = ${mean.toFixed(4)}<br>Std = ${std.toFixed(4)}<br>N = ${errors.length}`,
        showarrow: false,
        font: { family: "Geist Mono, monospace", size: 10, color: "#5C574E" },
        bgcolor: "rgba(255,255,255,0.85)",
        bordercolor: "#D8D2C6",
        borderwidth: 1,
        borderpad: 6,
        align: "right",
      },
    ],
    showlegend: false,
    width: undefined,
    height: 350,
  };

  return (
    <Plot
      data={traces}
      layout={layout}
      config={BASE_CONFIG}
      useResizeHandler
      style={{ width: "100%", height: "350px" }}
    />
  );
}
