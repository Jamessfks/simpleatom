import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MP_CAVEATS,
  MP_REFERENCE_ENTRIES,
  mpCellFunctional,
  mpEntryLabel,
  mpEntryNote,
} from "@/lib/mp-reference";

// D106, D107, D108, D121: what the Materials Project set says about itself must
// be what docs/v2/validation/structure-references.json found.
//   H1  MP serves the structure it ranks best (r2SCAN > GGA+U > GGA). 12 of the
//       13 ids have an r2SCAN entry; mp-1048 (NiTi) does not. The formation
//       energies paired with those cells are gga_gga+u, so cells and energies
//       come from different functionals.
//   H2  mp-72 is omega-Ti (P6/mmm), MP's GGA hull ground state; hcp alpha-Ti is
//       mp-46 (P6_3/mmc), +0.0044 eV/atom in GGA.
//   H3  mp-985806 is a hypothetical fluorite-type Al2Cu on MP's hull, not
//       theta-Al2Cu (I4/mcm, mp-998, E_hull 0.0125 eV/atom in GGA).

const entry = (mpId: string) => MP_REFERENCE_ENTRIES.find((e) => e.mpId === mpId)!;
const data = readFileSync("lib/mp-reference-data.ts", "utf8").replace(/\s+/g, " ");

describe("which functional each cell and energy comes from (D106)", () => {
  it("12 cells are r2SCAN-relaxed, NiTi's is GGA/GGA+U", () => {
    const functionals = MP_REFERENCE_ENTRIES.map((e) => [e.mpId, mpCellFunctional(e)]);
    expect(functionals.filter(([, f]) => f === "r2SCAN")).toHaveLength(12);
    expect(functionals.filter(([, f]) => f === "GGA/GGA+U")).toEqual([["mp-1048", "GGA/GGA+U"]]);
  });

  it("no on-screen text calls the cells PBE-relaxed", () => {
    for (const file of [
      "lib/mp-reference.ts",
      "components/benchmark/benchmark-mp-comparison.tsx",
      "components/benchmark/benchmark-config.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/PBE-relaxed/);
    }
    for (const c of MP_CAVEATS) expect(`${c.title} ${c.body}`).not.toMatch(/PBE-relaxed/);
  });

  it("the comparison carries a caveat that cells and energies differ in functional", () => {
    const caveat = MP_CAVEATS.find((c) => /r2SCAN/.test(c.title));
    expect(caveat).toBeDefined();
    expect(caveat!.body).toMatch(/12 of the 13/);
    expect(caveat!.body).toMatch(/mp-1048/);
    expect(caveat!.body).toMatch(/gga_gga\+u/);
    expect(caveat!.body).toMatch(/0\.87.{1,3}1\.21 %/);
  });

  it("the data header states the cell functional and no longer says PBE-relaxed", () => {
    expect(data).not.toMatch(/PBE-relaxed cells/);
    expect(data).toMatch(/r2SCAN/);
    expect(data).toMatch(/12 of the 13/);
  });
});

describe("the data header describes the files that run (D121)", () => {
  it("says the .xyz is read as extended XYZ, not plain XYZ", () => {
    expect(data).not.toMatch(/plain-xyz reader/i);
    expect(data).not.toMatch(/would have every crystal here evaluated as an isolated cluster/i);
    expect(data).toMatch(/extended XYZ/i);
    expect(data).toMatch(/Lattice/);
  });
});

describe("the two entries whose names mislead (D107, D108)", () => {
  it("mp-72 is omega-Ti, P6/mmm, MP's GGA ground state, and not alpha-Ti", () => {
    expect(mpEntryLabel(entry("mp-72"))).toBe("ω-Ti (mp-72)");
    const note = mpEntryNote(entry("mp-72"))!;
    expect(note).toMatch(/P6\/mmm/);
    expect(note).toMatch(/GGA/);
    expect(note).toMatch(/ground state/);
    expect(note).toMatch(/α-Ti is mp-46/);
    expect(note).toMatch(/0\.0044 eV\/atom/);
  });

  it("mp-985806 is a hypothetical fluorite-type Al2Cu, not theta-Al2Cu", () => {
    expect(mpEntryLabel(entry("mp-985806"))).toBe("Al2Cu, fluorite-type (mp-985806)");
    expect(mpEntryLabel(entry("mp-985806"))).not.toMatch(/θ/);
    const note = mpEntryNote(entry("mp-985806"))!;
    expect(note).toMatch(/hypothetical/i);
    expect(note).toMatch(/hull/);
    expect(note).toMatch(/not the experimental θ-Al2Cu/);
    expect(note).toMatch(/mp-998/);
    expect(note).toMatch(/0\.0125 eV\/atom/);
  });

  it("other entries keep their data names and have no extra note", () => {
    expect(mpEntryLabel(entry("mp-30"))).toBe("Cu reference (mp-30)");
    expect(mpEntryNote(entry("mp-30"))).toBeNull();
  });
});
