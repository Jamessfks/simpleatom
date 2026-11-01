import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParameterPanel } from "@/components/calculate/parameter-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CalculationParams } from "@/types/mace";

const params = {
  modelSize: "medium",
  modelType: "MACE-MPA-0",
  device: "cpu",
  calculationType: "single-point",
  dispersion: false,
} as CalculationParams;

function firstPaint(): string {
  // Server rendering runs no effects: this is the panel before the deployment answers.
  const panel = createElement(ParameterPanel, {
    params,
    onChange: () => {},
    customModelFile: null,
    onCustomModelChange: () => {},
  });
  const html = renderToString(createElement(TooltipProvider, null, panel));
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("the parameter panel before the deployment answers (D104, D84)", () => {
  it("says it is checking, without claiming the GPU is unavailable or pointing a local user elsewhere", () => {
    const text = firstPaint();
    expect(text).toContain("Checking this deployment");
    expect(text).not.toMatch(/GPU unavailable/);
    expect(text).not.toMatch(/Run locally to use a GPU/);
  });

  it("does not offer a checkpoint upload in the step description", () => {
    expect(firstPaint()).not.toMatch(/or upload a fine-tuned checkpoint/i);
  });
});

// A slab has a cell, so "has no periodic cell" was false for it. NPT needs every
// direction periodic, and the reason says so.
describe("the NPT-unavailable reason is true for a slab as well as a molecule", () => {
  const reason = (): string => {
    const panel = createElement(ParameterPanel, {
      params: { ...params, calculationType: "molecular-dynamics", mdEnsemble: "NVT" } as CalculationParams,
      onChange: () => {},
      customModelFile: null,
      onCustomModelChange: () => {},
      isPeriodic: false,
    });
    return renderToString(createElement(TooltipProvider, null, panel))
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");
  };

  it("says the structure is not periodic in all three directions", () => {
    expect(reason()).toMatch(/NPT is unavailable[^.]*not periodic in all three directions/);
  });

  it("does not say the structure has no periodic cell", () => {
    expect(reason()).not.toMatch(/has no periodic cell/);
  });
});
