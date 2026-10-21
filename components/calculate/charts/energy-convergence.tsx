"use client";

/**
 * EnergyConvergence — Energy vs. step line chart using Plotly.
 *
 * Used for:
 *   - Geometry optimization: energy decreasing over optimization steps
 *   - Molecular dynamics: energy fluctuation over MD steps
 *   - MD energy distribution histogram (secondary view)
 *
 * Replaces the custom SVG energy chart with a Plotly-based version
 * that supports export and richer interactivity.
 */

import dynamic from "next/dynamic";
import { BASE_LAYOUT, BASE_CONFIG, DATA_COLORS } from "./chart-config";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface EnergyConvergenceProps {
  /** Energy values at each step (eV). */
  energies: number[];
  /** Step indices. */
  steps: number[];
  /** Chart title. */
  title?: string;
  /** Current frame index to highlight (optional). */
  currentFrame?: number;
}

export function EnergyConvergence({
  energies,
  steps,
  title = "Energy vs. Step",
  currentFrame,
}: EnergyConvergenceProps) {
  if (energies.length === 0) return null;

  const traces: Plotly.Data[] = [
    {
      x: steps,
      y: energies,
      mode: "lines",
      type: "scatter",
      name: "Energy",
      line: { color: DATA_COLORS.blue, width: 2 },
      fill: "tozeroy",
      fillcolor: "rgba(68,119,170,0.1)",
    },
  ];

  // FIX: also check energies bounds → steps and energies may have different lengths
  if (currentFrame != null && currentFrame < steps.length && currentFrame < energies.length) {
    traces.push({
      x: [steps[currentFrame]],
      y: [energies[currentFrame]],
      mode: "markers",
      type: "scatter",
      name: `Frame ${currentFrame + 1}`,
      marker: { color: DATA_COLORS.cyan, size: 10, symbol: "circle" },
      showlegend: false,
    });
  }

  const eMin = Math.min(...energies);
  const eMax = Math.max(...energies);
  const mean = energies.reduce((s, v) => s + v, 0) / energies.length;

  const layout: Partial<Plotly.Layout> = {
    ...BASE_LAYOUT,
    title: { text: title, font: { size: 13, color: "#5C574E" } },
    xaxis: {
      ...BASE_LAYOUT.xaxis,
      title: { text: "Step", font: { size: 11 } },
    },
    yaxis: {
      ...BASE_LAYOUT.yaxis,
      title: { text: "Energy (eV)", font: { size: 11 } },
    },
    annotations: [
      {
        x: 0.98,
        y: 0.95,
        xref: "paper",
        yref: "paper",
        text: `Min = ${eMin.toFixed(4)} eV<br>Max = ${eMax.toFixed(4)} eV<br>Mean = ${mean.toFixed(4)} eV<br>\u0394E = ${(eMax - eMin).toFixed(4)} eV`,
        showarrow: false,
        font: { family: "Geist Mono, monospace", size: 10, color: "#5C574E" },
        bgcolor: "rgba(255,255,255,0.85)",
        bordercolor: "#D8D2C6",
        borderwidth: 1,
        borderpad: 6,
        align: "right",
      },
    ],
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
