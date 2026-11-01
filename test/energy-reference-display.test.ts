import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Radix mounts only the selected tab; the energy note and the headline card are
// both on the Summary tab, which is the default, so a plain pass-through is enough.
vi.mock("@/components/ui/tabs", () => {
  const passthrough = ({ children }: { children?: unknown }) => createElement("div", null, children as never);
  return { Tabs: passthrough, TabsList: passthrough, TabsTrigger: passthrough, TabsContent: passthrough };
});

import { MetricsDashboard } from "@/components/calculate/metrics-dashboard";
import { CONTRACT } from "@/lib/contract";
import type { CalculationResult } from "@/types/mace";

// D52: MACE-OFF's raw energy per atom has no element-independent band (water
// -693.7 eV/atom, CH2Br2 -28232.6). The registry holds none (typical and enforced
// are null) and gives the band that does hold, relative to the model's own
// isolated atoms. The dashboard must judge MACE-OFF by that, with the number the
// backend reports, and never print "reference convention unknown" for a model
// the registry knows.
const band = CONTRACT.energyConventions.off.relativeToIsolatedAtoms.typical;
const bandText = `${band.minEvPerAtom} to ${band.maxEvPerAtom} eV/atom`;
const mpBand = CONTRACT.energyConventions.mp.typical;

const water = (extra: Partial<CalculationResult> = {}, model = "MACE-OFF"): CalculationResult => ({
  status: "success",
  // -693.7 eV/atom, as MACE-OFF reports water
  energy: -2081.1,
  symbols: ["O", "H", "H"],
  positions: [[0, 0, 0], [0.96, 0, 0], [-0.24, 0.93, 0]],
  forces: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
  params: { calculationType: "single-point", modelType: model as never, modelSize: "small", device: "cpu", dispersion: false },
  ...extra,
});

const withRelative = (value: number, extra: Partial<CalculationResult> = {}) =>
  water({ properties: { energyPerAtomVsIsolatedAtoms: value, isolatedAtomsEnergy: -2071.1 }, ...extra });

const text = (result: CalculationResult) =>
  renderToStaticMarkup(createElement(MetricsDashboard, { result, filename: "water.xyz" }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&middot;/g, "·")
    .replace(/&minus;/g, "−")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("MACE-OFF energy is shown relative to the model's isolated atoms (D52)", () => {
  it("gives the energy per atom relative to the isolated atoms when the result carries it", () => {
    const shown = text(withRelative(-3.3456));
    expect(shown).toContain("-3.3456 eV/atom relative to the model's isolated atoms");
  });

  it("states the typical band from the registry, for the relative energy", () => {
    const shown = text(withRelative(-3.3456));
    expect(shown).toContain(`typical values fall between ${bandText}`);
    expect(shown).toMatch(/relative to (the model's|its own) isolated atoms/i);
  });

  it("says the raw energy per atom depends on the elements present, and does not judge it", () => {
    const shown = text(withRelative(-3.3456));
    expect(shown).toMatch(/raw energy per atom depends on the elements/i);
    expect(shown).not.toMatch(/outside typical/);
  });

  it("never calls the reference convention unknown for a registry model", () => {
    expect(text(withRelative(-3.3456))).not.toContain("reference convention unknown");
    expect(text(water())).not.toContain("reference convention unknown");
  });

  it("flags a relative energy outside the band, naming the band", () => {
    const shown = text(withRelative(band.minEvPerAtom - 3));
    expect(shown).toContain(`outside typical ${bandText}`);
  });

  it("does not flag a heavy molecule for its raw energy: CH2Br2 is -28232.6 eV/atom", () => {
    const heavy = water({
      energy: -28232.6 * 5,
      symbols: ["C", "H", "H", "Br", "Br"],
      properties: { energyPerAtomVsIsolatedAtoms: -2.97, isolatedAtomsEnergy: -140000 },
    });
    expect(text(heavy)).not.toMatch(/outside typical/);
  });

  it("for a result without the relative energy, shows no judgement and says why", () => {
    const shown = text(water());
    expect(shown).not.toMatch(/outside typical/);
    expect(shown).toMatch(/does not carry the energy relative to the model's isolated atoms/i);
  });
});

describe("the MACE-MP family keeps its raw per-atom band", () => {
  it("states and applies it", () => {
    const si = water({ energy: -43, symbols: Array(8).fill("Si") }, "MACE-MPA-0");
    const shown = text(si);
    expect(shown).toContain(`typical values fall between ${mpBand.minEvPerAtom} and ${mpBand.maxEvPerAtom} eV/atom for MACE-MPA-0`);
    expect(shown).not.toMatch(/outside typical/);
    expect(text({ ...si, energy: -8 * 40 })).toContain(`outside typical ${mpBand.minEvPerAtom} to ${mpBand.maxEvPerAtom} eV/atom`);
  });
});
