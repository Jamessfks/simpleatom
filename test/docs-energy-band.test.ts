import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ModelsPage from "@/app/docs/models/page";
import { CONTRACT } from "@/lib/contract";

// D52: MACE-OFF's raw energy per atom has no element-independent band (water
// -693.7 eV/atom, CH2Br2 -28232.6). The registry therefore holds no raw band
// for it, and the docs must not quote one. The band that means something is
// relative to the model's own isolated atoms.
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&minus;/g, "−")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, " ");
const source = (p: string) => text(readFileSync(p, "utf8"));

const band = CONTRACT.energyConventions.off.relativeToIsolatedAtoms.typical;
const signed = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n)}`;
const expectedBand = `${signed(band.minEvPerAtom)} to ${signed(band.maxEvPerAtom)}`;

describe("the docs do not quote a raw MACE-OFF energy band (D52)", () => {
  const pages = {
    models: text(renderToStaticMarkup(ModelsPage())),
    units: source("app/docs/units/page.tsx"),
    validation: source("app/docs/validation/page.tsx"),
  };

  for (const [name, page] of Object.entries(pages)) {
    it(`${name} does not say MACE-OFF energies lie in −100 to −600 eV/atom`, () => {
      expect(page).not.toMatch(/(−|-)\s?100 to (−|-)\s?600/);
    });
  }

  it("the models page says the raw value depends on the elements and gives the relative band from the registry", () => {
    const models = pages.models;
    expect(models).toMatch(/depends on the elements/i);
    expect(models).toMatch(/water/i);
    expect(models).toMatch(/CH2Br2/);
    expect(models).toMatch(/isolated atoms/i);
    expect(models).toContain(`${expectedBand} eV/atom`);
  });
});
