"use client";

/**
 * ParityPlot — Predicted vs. reference scatter plot (forces or energy).
 *
 * The gold standard visualization for MLIP model accuracy. Points on the
 * y=x diagonal indicate perfect prediction. Deviation reveals systematic
 * errors. Used in every MACE paper and benchmark.
 *
 * Features:
 *   - Dashed y=x diagonal (perfect prediction reference)
 *   - Points colored by element type
 *   - R², MAE, RMSE annotated in upper-left corner
 *   - Square aspect ratio (1:1) for visual accuracy
 *   - Semi-transparent points (opacity 0.3) for density visualization
 *   - Plotly modebar for PNG/SVG export
 */

import dynamic from "next/dynamic";
import { BASE_LAYOUT, BASE_CONFIG, getElementColor } from "./chart-config";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface ParityPlotProps {
  /** Reference (DFT) values — x-axis. */
  reference: number[];
  /** Predicted (MACE) values — y-axis. */
  predicted: number[];
  /** Optional element labels per data point (for coloring). */
  elements?: string[];
  /** X-axis label. */
  xLabel?: string;
  /** Y-axis label. */
  yLabel?: string;
  /** Chart title. */
  title?: string;
}

/** Compute basic regression statistics. */
function computeStats(ref: number[], pred: number[]) {
  const n = ref.length;
  if (n === 0) return { mae: 0, rmse: 0, r2: null };

  let sumAbsErr = 0;
  let sumSqErr = 0;
  let sumRef = 0;

  for (let i = 0; i < n; i++) {
    const err = pred[i] - ref[i];
    sumAbsErr += Math.abs(err);
    sumSqErr += err * err;
    sumRef += ref[i];
  }

  const mae = sumAbsErr / n;
  const rmse = Math.sqrt(sumSqErr / n);

  const meanRef = sumRef / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (ref[i] - meanRef) ** 2;
    ssRes += (pred[i] - ref[i]) ** 2;
  }
  // With zero spread in the references R² is undefined: reporting 1 would
  // claim a perfect fit for predictions that may all be wrong.
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : ssRes === 0 ? 1 : null;

  return { mae, rmse, r2 };
}

export function ParityPlot({
  reference,
  predicted,
  elements,
  xLabel = "Reference",
  yLabel = "Predicted",
  title = "Parity Plot",
}: ParityPlotProps) {
  const stats = computeStats(reference, predicted);

  const allVals = [...reference, ...predicted];
  const dataMin = Math.min(...allVals);
  const dataMax = Math.max(...allVals);
  const pad = (dataMax - dataMin) * 0.05 || 0.1;
  const axMin = dataMin - pad;
  const axMax = dataMax + pad;

  const traces: Plotly.Data[] = [];

  if (elements) {
    const uniqueElements = [...new Set(elements)];
    uniqueElements.forEach((el, idx) => {
      const mask = elements.map((e) => e === el);
      traces.push({
        x: reference.filter((_, i) => mask[i]),
        y: predicted.filter((_, i) => mask[i]),
        mode: "markers",
        type: "scatter",
        name: el,
        marker: {
          color: getElementColor(idx),
          size: 5,
          opacity: 0.4,
        },
      });
    });
  } else {
    traces.push({
      x: reference,
      y: predicted,
      mode: "markers",
      type: "scatter",
      name: "Data",
      marker: { color: "#4477AA", size: 5, opacity: 0.4 },
    });
  }

  // y=x diagonal line
  traces.push({
    x: [axMin, axMax],
    y: [axMin, axMax],
    mode: "lines",
    type: "scatter",
    name: "y = x",
    line: { color: "#BBBBBB", dash: "dash", width: 1.5 },
    showlegend: false,
  });

  const layout: Partial<Plotly.Layout> = {
    ...BASE_LAYOUT,
    title: { text: title, font: { size: 13, color: "#5C574E" } },
    xaxis: {
      ...BASE_LAYOUT.xaxis,
      title: { text: xLabel, font: { size: 11 } },
      range: [axMin, axMax],
      scaleanchor: "y",
      constrain: "domain",
    },
    yaxis: {
      ...BASE_LAYOUT.yaxis,
      title: { text: yLabel, font: { size: 11 } },
      range: [axMin, axMax],
    },
    annotations: [
      {
        x: 0.02,
        y: 0.98,
        xref: "paper",
        yref: "paper",
        text: `R\u00B2 = ${stats.r2 === null ? "n/a" : stats.r2.toFixed(4)}<br>MAE = ${stats.mae.toFixed(4)}<br>RMSE = ${stats.rmse.toFixed(4)}`,
        showarrow: false,
        font: { family: "Geist Mono, monospace", size: 10, color: "#5C574E" },
        bgcolor: "rgba(255,255,255,0.85)",
        bordercolor: "#D8D2C6",
        borderwidth: 1,
        borderpad: 6,
        align: "left",
      },
    ],
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
