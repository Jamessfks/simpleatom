import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStructureText } from "@/lib/parse-structure";

describe("parseStructureText", () => {
  it("converts silicon.cif fractional coordinates (nearest neighbour a*sqrt(3)/4)", () => {
    // Regresses to ~0.43 Å if fractional coordinates stop being multiplied
    // through the cell — the bug that once shipped. This is the TypeScript
    // parser's own check; the daily gate's silicon fixture reads the file
    // with ASE, which cannot catch a regression here.
    const parsed = parseStructureText(readFileSync("public/demo/silicon.cif", "utf8"), "silicon.cif");
    expect(parsed.atomCount).toBe(8);
    expect(parsed.isPeriodic).toBe(true);
    expect(parsed.minNeighborDist).toBeCloseTo(2.3516, 3);
  });

  it("parses ethanol.xyz", () => {
    const parsed = parseStructureText(readFileSync("public/demo/ethanol.xyz", "utf8"), "ethanol.xyz");
    expect(parsed.atomCount).toBe(9);
    expect(parsed.empiricalFormula).toBe("C₂H₆O");
    expect(parsed.isPeriodic).toBe(false);
  });

  it("keeps the first frame of a multi-frame XYZ", () => {
    const frame = (x: number) => `2\nframe\nH ${x} 0 0\nH ${x + 0.74} 0 0\n`;
    const parsed = parseStructureText(frame(0) + frame(5), "two.xyz");
    expect(parsed.frameCount).toBe(2);
    expect(parsed.positions[0][0]).toBe(0);
  });
});

// D62: database CIFs list the asymmetric unit and rely on the symmetry
// operations for the rest. ASE (the backend) expands them; the preview must too,
// or the atom count, formula, size limits and overlap warnings describe a
// different structure from the one that runs.
describe("CIF symmetry expansion (D62)", () => {
  /** Rock-salt NaCl, Fm-3m, as COD writes it: 2 sites and all 192 operations. */
  function naclCif(): string {
    const vars = ["x", "y", "z"];
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const centering = [["", "", ""], ["", "+1/2", "+1/2"], ["+1/2", "", "+1/2"], ["+1/2", "+1/2", ""]];
    const ops: string[] = [];
    for (const p of perms)
      for (let s = 0; s < 8; s++)
        for (const t of centering) {
          const comps = p.map((v, i) => `${s & (1 << i) ? "-" : ""}${vars[v]}${t[i]}`);
          ops.push(`'${comps.join(", ")}'`);
        }
    return [
      "data_NaCl",
      "_cell_length_a 5.6400",
      "_cell_length_b 5.6400",
      "_cell_length_c 5.6400",
      "_cell_angle_alpha 90",
      "_cell_angle_beta 90",
      "_cell_angle_gamma 90",
      "_symmetry_space_group_name_H-M 'F m -3 m'",
      "loop_",
      "_symmetry_equiv_pos_as_xyz",
      ...ops,
      "loop_",
      "_atom_site_label",
      "_atom_site_type_symbol",
      "_atom_site_fract_x",
      "_atom_site_fract_y",
      "_atom_site_fract_z",
      "Na1 Na 0.0 0.0 0.0",
      "Cl1 Cl 0.5 0.5 0.5",
      "",
    ].join("\n");
  }

  it("turns the NaCl asymmetric unit (2 sites) into the 8-atom cell ASE reads", () => {
    const parsed = parseStructureText(naclCif(), "nacl.cif");
    expect(parsed.atomCount).toBe(8);
    expect(parsed.elementCounts).toEqual({ Na: 4, Cl: 4 });
    expect(parsed.isPeriodic).toBe(true);
    // Na–Cl nearest neighbour is a/2 = 2.82 Å, not the 4.88 Å between the two listed sites.
    expect(parsed.minNeighborDist).toBeCloseTo(2.82, 2);
  });

  it("keeps one atom for a site on a special position", () => {
    const cif = [
      "data_P-1",
      "_cell_length_a 4", "_cell_length_b 5", "_cell_length_c 6",
      "_cell_angle_alpha 90", "_cell_angle_beta 90", "_cell_angle_gamma 90",
      "loop_", "_space_group_symop_operation_xyz", "'x, y, z'", "'-x, -y, -z'",
      "loop_", "_atom_site_type_symbol", "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z",
      "O 0.0 0.0 0.0",
      "C 0.1 0.2 0.3",
      "",
    ].join("\n");
    const parsed = parseStructureText(cif, "p-1.cif");
    expect(parsed.elementCounts).toEqual({ O: 1, C: 2 });
  });

  it("does not multiply a CIF that already lists every atom", () => {
    const parsed = parseStructureText(readFileSync("public/demo/silicon.cif", "utf8"), "silicon.cif");
    expect(parsed.atomCount).toBe(8);
  });
});

// D69 (F13 related): the POSCAR scale factor applies to Cartesian coordinates
// as well as to the cell.
describe("POSCAR scale factor (D69)", () => {
  const poscar = (mode: string) =>
    ["cubic", "2.0", "1 0 0", "0 1 0", "0 0 1", "Cu", "1", mode, "0.5 0.0 0.0", ""].join("\n");

  it("scales Cartesian coordinates with the cell", () => {
    const parsed = parseStructureText(poscar("Cartesian"), "POSCAR");
    expect(parsed.lattice![0][0]).toBeCloseTo(2, 10);
    expect(parsed.positions[0][0]).toBeCloseTo(1.0, 10);
  });

  it("puts a direct coordinate at the same place", () => {
    const parsed = parseStructureText(poscar("Direct"), "POSCAR");
    expect(parsed.positions[0][0]).toBeCloseTo(1.0, 10);
  });
});
