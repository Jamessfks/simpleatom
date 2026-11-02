import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/tabs", () => {
  const passthrough = ({ children }: { children?: unknown }) => createElement("div", null, children as never);
  return { Tabs: passthrough, TabsList: passthrough, TabsTrigger: passthrough, TabsContent: passthrough };
});

import { MetricsDashboard } from "@/components/calculate/metrics-dashboard";
import { CONTRACT } from "@/lib/contract";
import type { CalculationResult } from "@/types/mace";

// D176: the dashboard styled I2 (-0.31 eV/atom relative to its isolated atoms) as a
// warning, outside the typical band, while the validator accepts it (enforced -10 to +1).
// One rule in both: only a value outside the registry's enforced band is a warning; a
// value outside the typical band but inside the enforced one is a neutral note.
const enforced = CONTRACT.energyConventions.off.relativeToIsolatedAtoms.enforced;

const iodine = (relative: number): CalculationResult => ({
  status: "success",
  energy: -28000,
  symbols: ["I", "I"],
  positions: [[0, 0, 0], [2.67, 0, 0]],
  forces: [[0, 0, 0], [0, 0, 0]],
  params: { calculationType: "single-point", modelType: "MACE-OFF", modelSize: "small", device: "cpu", dispersion: false },
  properties: { energyPerAtomVsIsolatedAtoms: relative, isolatedAtomsEnergy: -27999 },
});

const html = (result: CalculationResult) =>
  renderToStaticMarkup(createElement(MetricsDashboard, { result, filename: "i2.xyz" }));

describe("one energy rule in the dashboard and the validator (D176)", () => {
  it("does not style a value the validator accepts as a warning", () => {
    const shown = html(iodine(-0.31));
    expect(shown).not.toMatch(/text-warning[^>]*>[^<]*MACE-OFF/);
    expect(shown.replace(/<[^>]+>/g, " ")).toMatch(/validator accepts/);
  });

  it("styles a value outside the enforced band as a warning, naming that band", () => {
    const shown = html(iodine(enforced.minEvPerAtom - 5));
    expect(shown).toMatch(/text-warning/);
    expect(shown.replace(/<[^>]+>/g, " ")).toContain(`${enforced.minEvPerAtom} to ${enforced.maxEvPerAtom}`);
  });
});
