import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EnergyChart } from "@/components/calculate/trajectory/energy-chart";

// The x axis labels the first, middle and last frame. With one or two frames
// those are the same index, and each label was keyed by its index, so React
// logged "two children with the same key" in the browser (D159).
const xLabels = (frames: number): string[] => {
  const values = Array.from({ length: frames }, (_, i) => -1 - i * 0.1);
  const html = renderToString(
    createElement(EnergyChart, {
      series: [{ label: "Potential energy", values, color: "#4477AA" }],
      steps: values.map((_, i) => i * 10),
      currentFrame: 0,
    }),
  );
  // X tick labels sit on the bottom row of the viewBox (y = CHART_HEIGHT - 4 = 176).
  return [...html.matchAll(/<text[^>]*\sy="176"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
};

describe("the energy chart labels each distinct frame once on the x axis (D159)", () => {
  it("one frame: one label", () => expect(xLabels(1)).toEqual(["0"]));
  it("two frames: first and last", () => expect(xLabels(2)).toEqual(["0", "10"]));
  it("three frames: first, middle, last", () => expect(xLabels(3)).toEqual(["0", "10", "20"]));
  it("many frames: first, middle, last", () => expect(xLabels(11)).toEqual(["0", "50", "100"]));
});
