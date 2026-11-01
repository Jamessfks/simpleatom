import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getEntryById } from "@/lib/mlpeg-catalog";
import { MP_REFERENCE_ENTRIES } from "@/lib/mp-reference-data";
import { expandCifSites, parseStructureText, type ExpansionWork, type ParsedStructure } from "@/lib/parse-structure";

// The browser previews an upload with lib/parse-structure.ts; the backend
// computes whatever ASE reads (mace-api/calculate.py `_read_structure`). When
// the two disagree the user sees one structure and runs another. This holds
// the parser to test/fixtures/parser-reference.json, which
// test_scripts/gen_parser_reference.py writes by reading every shipped
// structure and every adversarial fixture with ase.io.read the way the server
// does (test_scripts/test_parser_reference.py fails if that file is stale).
//
// Tolerance 1e-6 Å on positions and cell, exact on species, count, pbc.

interface AseRead {
  format: string;
  error?: string;
  symbols?: string[];
  positions?: number[][];
  cell?: number[][] | null;
  pbc?: boolean[];
  nFrames?: number;
  referenceEnergy?: number;
  referenceForces?: number[][];
}
interface Entry {
  name: string;
  group: "demo" | "catalog" | "mp-xyz" | "mp-cif" | "adversarial";
  filename: string;
  note?: string;
  ase: AseRead;
}

const reference = JSON.parse(readFileSync("test/fixtures/parser-reference.json", "utf8")) as {
  structures: Entry[];
};
const adversarialIndex = JSON.parse(
  readFileSync("test/fixtures/structures/adversarial/index.json", "utf8"),
) as { name: string; path: string }[];

function textOf(entry: Entry): string {
  const rest = entry.name.slice(entry.name.indexOf("/") + 1);
  if (entry.group === "demo") return readFileSync(`public/demo/${rest}`, "utf8");
  if (entry.group === "catalog") return getEntryById(rest)!.xyzData;
  if (entry.group === "mp-xyz" || entry.group === "mp-cif") {
    const id = rest.replace(/\.(xyz|cif)$/, "");
    const mp = MP_REFERENCE_ENTRIES.find((e) => e.id === id)!;
    return entry.group === "mp-xyz" ? mp.xyzData : mp.cifData;
  }
  return readFileSync(adversarialIndex.find((a) => `adversarial/${a.name}` === entry.name)!.path, "utf8");
}

/**
 * Cases where ASE itself is wrong, so agreeing with it would be agreeing with
 * a defect. The backend refuses them (D113-D115); the preview must refuse or
 * flag them too instead of drawing a structure that will not run.
 */
const ASE_IS_WRONG: Record<string, string> = {
  "adversarial/cif_uppercase_symbols": "D113: ASE reads NA, CL as C, N",
  "adversarial/cif_diamond_origin2_colon2": "D114: ASE ignores the ':2' origin choice",
  "adversarial/cif_partial_occupancy_mixed": "D115: ASE drops the occupancy",
  "adversarial/cif_partial_occupancy_vacancy": "D115: ASE drops the occupancy",
};

/**
 * ASE expands a CIF that gives only a Hermann-Mauguin symbol from its space
 * group table; the browser has no such table, so it cannot draw the full cell.
 * It must say so rather than present the listed sites as the structure.
 */
const SYMMETRY_FROM_SYMBOL: Record<string, string> = {
  "adversarial/cif_nacl_asym_hm_only": "no symmetry operations, only a Hermann-Mauguin symbol",
  "adversarial/cif_diamond_origin1_hm_only": "no symmetry operations, only a Hermann-Mauguin symbol",
  // D114: coordinates in origin choice 2 are expanded by ASE with origin-1
  // operators (16 atoms instead of 8). Without a ":2" the symbol cannot tell
  // the two apart, so the preview flags the file and says which origin ASE assumes.
  "adversarial/cif_diamond_origin2_hm_only": "D114: two origin choices, the symbol alone does not say which",
};

/**
 * The wwPDB `CRYST1 1.000 1.000 1.000 90 90 90 P 1` placeholder: ASE takes it
 * for a 1 Angstrom periodic cube (E = 1e21 eV for ethanol). It means "no cell",
 * so the preview reads an isolated molecule — and the server must, too (D89).
 */
const PLACEHOLDER_CELL = "adversarial/pdb_cryst1_placeholder";

/** Which defect a fixture pins, so a failure names it. */
const DEFECT: Record<string, string> = {
  "adversarial/pdb_cryst1_placeholder": "D89",
  "adversarial/poscar_scale2_cartesian": "D92",
  "adversarial/poscar_negative_scale": "D92",
  "adversarial/poscar_three_scales": "D92",
  "adversarial/poscar_vasp4_no_species": "D92",
  "adversarial/poscar_selective_dynamics": "D92",
  "adversarial/xyz_pbcF_with_lattice": "D93",
  "adversarial/xyz_slab_pbcTTF": "D93",
  "adversarial/xyz_lattice_no_pbc": "D93",
  "adversarial/xyz_element_case": "D93",
  "adversarial/xyz_species_not_first": "D93",
  "adversarial/xyz_free_energy_first": "D93",
  "adversarial/xyz_energy_forces_columns": "D93",
  "adversarial/xyz_REF_energy_forces": "D93",
  "adversarial/pdb_uppercase_elements": "D93",
  "adversarial/pdb_two_models": "D93",
  "adversarial/cif_label_before_type": "D93",
  "adversarial/cif_labels_only": "D93",
  "adversarial/cif_type_symbol_oxidation": "D93",
  "adversarial/cif_aniso_loop_after": "D93",
  "adversarial/cif_two_data_blocks": "D93",
  "adversarial/xyz_overlap_across_boundary": "D117",
  "adversarial/cif_symmetry_equivalent_sites_twice": "D62",
  "adversarial/cif_full_cell_with_symops": "D62",
  "adversarial/cif_duplicate_sites_tolerance": "D62",
};

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function close(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

function expectMatrix(got: number[][] | undefined, want: number[][], what: string) {
  expect(got, `${what}: present`).toBeDefined();
  expect(got!.length, `${what}: rows`).toBe(want.length);
  for (let i = 0; i < want.length; i++)
    for (let j = 0; j < 3; j++)
      expect(close(got![i][j], want[i][j]), `${what}[${i}][${j}] ${got![i][j]} vs ${want[i][j]}`).toBe(true);
}

/** What the preview exposes for agreement: ParsedStructure plus the axes it treats as periodic and its flags. */
type Parsed = ParsedStructure & { pbc?: boolean[]; notes?: string[] };

function parse(entry: Entry): Parsed {
  return parseStructureText(textOf(entry), entry.filename);
}

describe("browser parser agrees with ASE (the server's reader)", () => {
  it("has a reference entry for every structure", () => {
    expect(reference.structures.length).toBeGreaterThan(60);
  });

  const agreeing = reference.structures.filter(
    (e) =>
      !(e.name in ASE_IS_WRONG) && !(e.name in SYMMETRY_FROM_SYMBOL) && e.name !== PLACEHOLDER_CELL && !e.ase.error,
  );

  for (const entry of agreeing) {
    const label = `${DEFECT[entry.name] ? `${DEFECT[entry.name]} ` : ""}${entry.name}`;
    it(label, () => {
      const ase = entry.ase;
      const parsed = parse(entry);

      expect(parsed.atomCount, "atom count").toBe(ase.symbols!.length);
      expect(parsed.symbols, "species, in order").toEqual(ase.symbols);
      for (let i = 0; i < ase.symbols!.length; i++)
        for (let k = 0; k < 3; k++)
          expect(
            close(parsed.positions[i][k], ase.positions![i][k]),
            `atom ${i} ${"xyz"[k]}: ${parsed.positions[i][k]} vs ${ase.positions![i][k]}`,
          ).toBe(true);

      if (ase.cell) expectMatrix(parsed.lattice, ase.cell, "cell");
      else expect(parsed.lattice, "no cell").toBeUndefined();

      expect(parsed.pbc, "pbc").toEqual(ase.pbc);
      const fullyPeriodic = ase.pbc!.every(Boolean) && !!ase.cell && Math.abs(det3(ase.cell)) > 1e-6;
      expect(parsed.isPeriodic, "isPeriodic (all axes periodic and a cell of positive volume)").toBe(fullyPeriodic);

      if (ase.referenceEnergy === undefined) expect(parsed.referenceEnergy, "reference energy").toBeUndefined();
      else expect(close(parsed.referenceEnergy!, ase.referenceEnergy), "reference energy").toBe(true);
      if (ase.referenceForces === undefined) expect(parsed.referenceForces, "reference forces").toBeUndefined();
      else expectMatrix(parsed.referenceForces, ase.referenceForces, "reference forces");

      if (entry.filename.endsWith(".xyz")) expect(parsed.frameCount, "frames").toBe(ase.nFrames);
    });
  }

  // D113-D115: ASE reads these wrongly and the backend now refuses them. The
  // preview must not present a structure the run will not compute.
  for (const entry of reference.structures.filter((e) => e.name in ASE_IS_WRONG)) {
    it(`refuses ${entry.name} (${ASE_IS_WRONG[entry.name]})`, () => {
      expect(() => parse(entry)).toThrow(/.{20,}/);
    });
  }

  for (const entry of reference.structures.filter((e) => e.name in SYMMETRY_FROM_SYMBOL)) {
    it(`flags ${entry.name} (${SYMMETRY_FROM_SYMBOL[entry.name]})`, () => {
      const parsed = parse(entry);
      expect((parsed.notes ?? []).join(" ")).toMatch(/Hermann-Mauguin/i);
    });
  }
});

// D62: ASE's crystal() drops an image that lands within 0.001 of ANY atom it has
// already placed, modulo the cell, whichever listed site made it. The preview
// used to compare an image only with the other images of its own listed site.
// (A different element on an occupied site is dropped too: ASE keeps the first,
// so the preview follows ASE here rather than comparing elements.)
describe("D62 CIF symmetry expansion drops an image that repeats any earlier atom", () => {
  const entry = (name: string) => reference.structures.find((e) => e.name === `adversarial/${name}`)!;

  it("symmetry-equivalent sites listed twice give 8 atoms, not 12", () => {
    const e = entry("cif_symmetry_equivalent_sites_twice");
    const parsed = parse(e);
    expect(e.ase.symbols).toHaveLength(8);
    expect(parsed.atomCount).toBe(8);
    expect(parsed.symbols.filter((s) => s === "Na")).toHaveLength(4);
    expect(parsed.symbols.filter((s) => s === "Cl")).toHaveLength(4);
  });

  it("a full cell listed together with its operations gives 8 atoms and no zero distance", () => {
    const e = entry("cif_full_cell_with_symops");
    const parsed = parse(e);
    expect(e.ase.symbols).toHaveLength(8);
    expect(parsed.atomCount).toBe(8);
    expect(parsed.minNeighborDist).toBeCloseTo(5.64 / 2, 6);
  });

  it("merges sites within 0.001 of an earlier one across the cell boundary, and keeps sites 0.002 apart", () => {
    const e = entry("cif_duplicate_sites_tolerance");
    const parsed = parse(e);
    expect(parsed.symbols).toEqual(["Na", "Na"]);
    expect(parsed.positions[0]).toEqual([0, 0, 0]);
    expect(parsed.positions[1][0]).toBeCloseTo(0.002 * 5, 6);
  });

  it("an H-M symbol with no operations stays a note: the preview draws the 2 listed sites and says so", () => {
    const e = entry("cif_nacl_asym_hm_only");
    const parsed = parse(e);
    expect(e.ase.symbols).toHaveLength(8);
    expect(parsed.atomCount).toBe(2);
    const note = (parsed.notes ?? []).join(" ");
    expect(note).toMatch(/preview cannot expand it/);
    expect(note).toMatch(/shows only the 2 listed sites/);
    expect(note).toMatch(/atom count may be larger/);
  });
});

describe("D89 the wwPDB CRYST1 placeholder is no cell", () => {
  const entry = reference.structures.find((e) => e.name === PLACEHOLDER_CELL)!;

  it("reads an isolated molecule, with the atoms ASE reads", () => {
    const parsed = parse(entry);
    expect(parsed.symbols).toEqual(entry.ase.symbols);
    expect(parsed.lattice).toBeUndefined();
    expect(parsed.pbc).toEqual([false, false, false]);
    expect(parsed.isPeriodic).toBe(false);
    expect((parsed.notes ?? []).join(" ")).toMatch(/CRYST1/);
  });

  it("keeps a real CRYST1 periodic, with its cell", () => {
    // Cell a=b=c=5 A, 90 degrees: ASE reads pbc True and this cell (checked with ase 3.27).
    const pdb =
      "CRYST1    5.000    5.000    5.000  90.00  90.00  90.00 P 1           1\n" +
      "HETATM    1 NA   NA  A   1       0.000   0.000   0.000  1.00  0.00          NA\n" +
      "HETATM    2 CL   CL  A   2       2.500   2.500   2.500  1.00  0.00          CL\n";
    const parsed = parseStructureText(pdb, "real.pdb");
    expect(parsed.symbols).toEqual(["Na", "Cl"]);
    expect(parsed.pbc).toEqual([true, true, true]);
    expect(parsed.isPeriodic).toBe(true);
    expect(parsed.lattice![0][0]).toBeCloseTo(5, 6);
    expect(parsed.minNeighborDist).toBeCloseTo(Math.sqrt(3) * 2.5, 6);
  });
});

describe("D117 the preview measures nearest neighbours across the cell boundary", () => {
  it("a 0.20 A contact across a periodic boundary is the minimum distance", () => {
    const entry = reference.structures.find((e) => e.name === "adversarial/xyz_overlap_across_boundary")!;
    const parsed = parse(entry);
    expect(parsed.minNeighborDist).toBeLessThan(0.25);
    expect(parsed.minNeighborDist).toBeGreaterThan(0.15);
  });

  it("a one-atom cell is bound to its own image", () => {
    const text =
      'Lattice="2.5 0 0 0 2.5 0 0 0 2.5" Properties=species:S:1:pos:R:3 pbc="T T T"';
    const parsed = parseStructureText(`1\n${text}\nCu 0 0 0\n`, "one.xyz");
    expect(parsed.minNeighborDist).toBeCloseTo(2.5, 6);
  });

  it("a molecule in a pbc F F F box is measured without images", () => {
    const text = 'Lattice="3 0 0 0 3 0 0 0 3" Properties=species:S:1:pos:R:3 pbc="F F F"';
    const parsed = parseStructureText(`2\n${text}\nH 0.1 0 0\nH 2.9 0 0\n`, "box.xyz");
    expect(parsed.minNeighborDist).toBeCloseTo(2.8, 6);
  });
});

// Behaviours ASE shows on the pinned version (3.27.0, checked by reading these
// exact strings with ase.io.read(format="extxyz", index=0) and, where the
// reader raised, the plain "xyz" reader the server falls back to).
describe("extended XYZ keys are case-sensitive, as ASE reads them (D93)", () => {
  const box = (key: string, extra = "") =>
    `2\n${key}="3 0 0 0 3 0 0 0 3" ${extra}Properties=species:S:1:pos:R:3\nH 0 0 0\nH 1 0 0\n`;

  it("ignores a lower-case lattice= (no cell, not periodic) and says so", () => {
    const parsed = parseStructureText(box("lattice"), "lower.xyz") as Parsed;
    expect(parsed.lattice).toBeUndefined();
    expect(parsed.pbc).toEqual([false, false, false]);
    expect(parsed.isPeriodic).toBe(false);
    expect((parsed.notes ?? []).join(" ")).toMatch(/lattice=.*case-sensitive/);
  });

  it("reads pbc as booleans per axis, with one value for all three", () => {
    expect((parseStructureText(box("Lattice", 'pbc="T T F" '), "a.xyz") as Parsed).pbc).toEqual([true, true, false]);
    expect((parseStructureText(box("Lattice", "pbc=F "), "a.xyz") as Parsed).pbc).toEqual([false, false, false]);
    expect((parseStructureText(box("Lattice", 'pbc="True False True" '), "a.xyz") as Parsed).pbc).toEqual([true, false, true]);
    expect(parseStructureText(box("Lattice", 'pbc="T T F" '), "a.xyz").isPeriodic).toBe(false);
    expect(parseStructureText(box("Lattice"), "a.xyz").isPeriodic).toBe(true);
  });

  it("falls back to plain XYZ when the comment line cannot be read, losing the cell like the server", () => {
    const bad = '2\nLattice="3 0 0 0 3" Properties=species:S:1:pos:R:3\nH 0 0 0\nH 1 0 0\n';
    const parsed = parseStructureText(bad, "bad.xyz") as Parsed;
    expect(parsed.atomCount).toBe(2);
    expect(parsed.lattice).toBeUndefined();
    expect(parsed.isPeriodic).toBe(false);
    expect((parsed.notes ?? []).join(" ")).toMatch(/plain XYZ/);
  });

  it("refuses an atom line with a missing coordinate (ASE refuses it too), instead of dropping the atom", () => {
    expect(() => parseStructureText("2\n\nO 0 0 0\nH 1 0\n", "bad.xyz")).toThrow(/atom line 2/);
  });

  it("does not take free_energy for the reference energy", () => {
    const parsed = parseStructureText("1\nfree_energy=-9 \nH 0 0 0\n", "fe.xyz");
    expect(parsed.referenceEnergy).toBeUndefined();
  });
});

// D133 (backend): a CIF whose sites x symmetry operations is huge froze the
// server for minutes. The preview runs the same expansion in the browser tab,
// so it refuses past a cap rather than hang the page, and stays linear below it.
describe("a CIF symmetry bomb cannot freeze the preview (D133)", () => {
  const ops = (): string[] => {
    const vars = ["x", "y", "z"];
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const centring = [["", "", ""], ["", "+1/2", "+1/2"], ["+1/2", "", "+1/2"], ["+1/2", "+1/2", ""]];
    const out: string[] = [];
    for (const p of perms)
      for (let s = 0; s < 8; s++)
        for (const t of centring)
          out.push(`'${p.map((v, i) => `${s & (1 << i) ? "-" : ""}${vars[v]}${t[i]}`).join(", ")}'`);
    return out;
  };
  const cif = (sites: number): string =>
    [
      "data_bomb", "_cell_length_a 40", "_cell_length_b 40", "_cell_length_c 40",
      "_cell_angle_alpha 90", "_cell_angle_beta 90", "_cell_angle_gamma 90",
      "loop_", "_symmetry_equiv_pos_as_xyz", ...ops(),
      "loop_", "_atom_site_type_symbol", "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z",
      ...Array.from({ length: sites }, (_, i) => `Cu ${((i * 0.6180339887) % 1).toFixed(6)} ${((i * 0.7548776662) % 1).toFixed(6)} ${((i * 0.5698402909) % 1).toFixed(6)}`),
      "",
    ].join("\n");

  const sitesOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      symbol: "Cu",
      frac: [(i * 0.6180339887) % 1, (i * 0.7548776662) % 1, (i * 0.5698402909) % 1] as [number, number, number],
    }));

  it("refuses 6000 sites under 192 operations at once, naming the size", () => {
    expect(() => parseStructureText(cif(6000), "bomb.cif")).toThrow(/symmetry|expand/i);
  });

  it("refuses before generating a single image", () => {
    const work: ExpansionWork = { images: 0, comparisons: 0 };
    expect(() => expandCifSites(sitesOf(6000), ops().map((o) => o.replace(/'/g, "")), work)).toThrow(/symmetry|expand/i);
    expect(work).toEqual({ images: 0, comparisons: 0 });
  });

  it("expands an ordinary listing and drops repeats", () => {
    const parsed = parseStructureText(cif(6), "big.cif");
    expect(parsed.atomCount).toBeGreaterThan(6 * 100); // generic positions: close to 6 x 192 distinct images
    expect(parsed.atomCount).toBeLessThan(6 * 192); // site 0 is a special position, so its repeats were dropped
  });

  // Counted, not timed: a runner several times slower than a laptop must not
  // fail this, and a quadratic scan (every image against every kept atom) must.
  it("does work linear in the number of images, not quadratic", () => {
    const operations = ops().map((o) => o.replace(/'/g, ""));
    const run = (n: number) => {
      const work: ExpansionWork = { images: 0, comparisons: 0 };
      const kept = expandCifSites(sitesOf(n), operations, work).length;
      return { ...work, kept };
    };
    const small = run(100); // 19,200 images
    const large = run(200); // 38,400 images, under the 100,000 cap
    expect(small.images).toBe(100 * 192);
    expect(large.images).toBe(200 * 192);
    expect(large.kept).toBeLessThan(large.images); // repeats were found and dropped
    // Each image meets the contents of at most 27 grid cells, a handful of atoms;
    // a scan of everything kept so far would be ~images/2 per image (>10,000 here).
    for (const r of [small, large]) expect(r.comparisons).toBeLessThan(27 * r.images);
    // Doubling the images doubles the work (a quadratic scan would quadruple it).
    expect(large.comparisons).toBeLessThan(3 * Math.max(small.comparisons, 1));
  });
});
