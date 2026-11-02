import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/tabs", () => {
  const passthrough = ({ children }: { children?: unknown }) => createElement("div", null, children as never);
  return { Tabs: passthrough, TabsList: passthrough, TabsTrigger: passthrough, TabsContent: passthrough };
});

import { MetricsDashboard } from "@/components/calculate/metrics-dashboard";
import type { CalculationResult } from "@/types/mace";

// D181: the "Temperature (mean)" tile averaged every frame, warm-up included, while the
// message gave the warm-up-discarded mean (Si NVT, 1000 steps: 326.1 K vs 342.6 K).
const temps = [100, 200, 300, 340, 345, 342, 344, 341, 343, 342];
const md = (summary: boolean): CalculationResult => ({
  status: "success",
  energy: -43,
  symbols: ["Si", "Si"],
  positions: [[0, 0, 0], [1.36, 1.36, 1.36]],
  forces: [[0, 0, 0], [0, 0, 0]],
  params: { calculationType: "molecular-dynamics", modelType: "MACE-MPA-0", modelSize: "medium", device: "cpu",
            dispersion: false, temperature: 300, mdEnsemble: "NVT" } as never,
  trajectory: {
    energies: temps.map(() => -43), positions: temps.map(() => [[0, 0, 0], [1.36, 1.36, 1.36]]),
    step: temps.map((_, i) => i), temperatures: temps, kineticEnergies: temps.map(() => 0.1),
    totalEnergies: temps.map(() => -42.9),
  } as never,
  ...(summary ? { mdSummary: { warmupFraction: 0.2, warmupFrames: 2, meanTemperature: 337.1 } } : {}),
});

const text = (r: CalculationResult) =>
  renderToStaticMarkup(createElement(MetricsDashboard, { result: r, filename: "si.xyz" })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the mean-temperature tile (D181)", () => {
  it("shows the same warm-up-discarded mean as the message", () => {
    const shown = text(md(true));
    expect(shown).toMatch(/Temperature \(mean after warm-up\) 337\.1 K/);
  });

  it("says it averages all frames when the result carries no summary", () => {
    expect(text(md(false))).toMatch(/Temperature \(mean, all frames\) 289\.7 K/);
  });
});
