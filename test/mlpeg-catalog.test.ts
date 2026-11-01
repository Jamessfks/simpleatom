import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAllEntries, MLPEG_CATALOG } from "@/lib/mlpeg-catalog";
import { parseStructureText } from "@/lib/parse-structure";

// Each periodic catalog entry must be the crystal its label names. The checks
// are geometric, so they hold whatever model later runs on the cell: atom
// count, nearest-neighbour distance, coordination of every atom at that
// distance, and (for bulk) volume per atom. D57: "Silicon (diamond)" and
// "Diamond (carbon)" were a 2-atom primitive basis inside a cubic cell — 4×
// too sparse, every atom 1-coordinated — for eight months under a comment
// that said "Verified".
const SQRT2 = Math.SQRT2;
const SQRT3 = Math.sqrt(3);

// Lattice constants are the experimental values docs/v2/validation/structure-references.json
// cites to COD records (D112), not the rounded textbook numbers the catalog used
// to carry (5.43, 3.615, 5.64, 2.87): Si 9011998, C 9011997, Cu 9013014,
// NaCl 9003308, Fe 9008536. The cell and the reference value are one number (D71).
const REFERENCES = JSON.parse(readFileSync("docs/v2/validation/structure-references.json", "utf8")) as {
  records: { id: string; fields: Record<string, { value: unknown }> }[];
};
const cited = (id: string, field: string): number =>
  REFERENCES.records.find((r) => r.id === id)!.fields[field].value as number;
const A_SI = cited("Si-diamond", "lattice_constant_exp");
const A_C = cited("C-diamond", "lattice_constant_exp");
const A_CU = cited("Cu-fcc", "lattice_constant_exp");
const A_NACL = cited("NaCl-rocksalt", "lattice_constant_exp");
const A_FE = cited("Fe-bcc", "lattice_constant_exp");

interface Expected {
  atoms: number;
  nearestNeighbour: number;
  /** Coordination of each atom at the nearest-neighbour distance, sorted. */
  coordination: number[];
  /** Bulk only: |det(lattice)| / atoms. */
  volumePerAtom?: number;
}

const EXPECTED: Record<string, Expected> = {
  "si-diamond": { atoms: 8, nearestNeighbour: (A_SI * SQRT3) / 4, coordination: Array(8).fill(4), volumePerAtom: A_SI ** 3 / 8 },
  "c-diamond": { atoms: 8, nearestNeighbour: (A_C * SQRT3) / 4, coordination: Array(8).fill(4), volumePerAtom: A_C ** 3 / 8 },
  "cu-fcc": { atoms: 4, nearestNeighbour: A_CU / SQRT2, coordination: Array(4).fill(12), volumePerAtom: A_CU ** 3 / 4 },
  "nacl-rocksalt": { atoms: 8, nearestNeighbour: A_NACL / 2, coordination: Array(8).fill(6), volumePerAtom: A_NACL ** 3 / 8 },
  "fe-bcc": { atoms: 2, nearestNeighbour: (A_FE * SQRT3) / 2, coordination: Array(2).fill(8), volumePerAtom: A_FE ** 3 / 2 },
  // Three close-packed layers: the two surfaces lose the three neighbours of
  // the missing layer.
  "cu-111": { atoms: 3, nearestNeighbour: A_CU / SQRT2, coordination: [9, 9, 12] },
  // Two diamond (111) bilayers: an outer atom keeps three bonds inside its
  // bilayer, an inner atom adds the one bond across to the other bilayer.
  "si-111": { atoms: 4, nearestNeighbour: (A_SI * SQRT3) / 4, coordination: [3, 3, 4, 4] },
};

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

/** Distances from atom i to every periodic image of every atom within `cutoff`. */
function neighbourDistances(positions: number[][], lattice: number[][], i: number, cutoff: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < positions.length; j++) {
    for (let a = -2; a <= 2; a++) {
      for (let b = -2; b <= 2; b++) {
        for (let c = -2; c <= 2; c++) {
          const d = [0, 1, 2].map(
            (k) => positions[j][k] + a * lattice[0][k] + b * lattice[1][k] + c * lattice[2][k] - positions[i][k],
          );
          const r = Math.hypot(d[0], d[1], d[2]);
          if (r > 1e-6 && r < cutoff) out.push(r);
        }
      }
    }
  }
  return out;
}

// Every entry that has a cell: bulk crystals (pbc T T T) and slabs (pbc T T F).
const periodic = getAllEntries().filter((e) => /Lattice=/.test(e.xyzData));
const slabs = periodic.filter((e) => /pbc="T T F"/.test(e.xyzData));

describe("catalog crystals are the structures their labels name", () => {
  it("covers every periodic entry", () => {
    expect(periodic.map((e) => e.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const entry of periodic) {
    const want = EXPECTED[entry.id];
    it(`${entry.id}: ${want?.atoms} atoms, nearest neighbour ${want?.nearestNeighbour.toFixed(4)} Å`, () => {
      const parsed = parseStructureText(entry.xyzData, `${entry.id}.xyz`);
      const lattice = parsed.lattice!;
      expect(parsed.isPeriodic).toBe(!slabs.includes(entry));
      expect(parsed.atomCount).toBe(want.atoms);
      expect(entry.atomCount).toBe(want.atoms);

      const shells = parsed.positions.map((_, i) =>
        neighbourDistances(parsed.positions, lattice, i, want.nearestNeighbour * 1.1),
      );
      const nearest = Math.min(...shells.flat());
      expect(nearest).toBeCloseTo(want.nearestNeighbour, 2); // ±5 mÅ: the catalog prints 3–6 decimals
      expect(shells.map((s) => s.length).sort((x, y) => x - y)).toEqual(want.coordination);

      if (want.volumePerAtom !== undefined) {
        expect(Math.abs(det3(lattice)) / parsed.atomCount).toBeCloseTo(want.volumePerAtom, 2);
      }
    });
  }
});


describe("D70 slabs are periodic in the surface plane only", () => {
  it("declare pbc T T F, so no stress or NPT is offered for them", () => {
    expect(slabs.map((e) => e.id).sort()).toEqual(["cu-111", "si-111"]);
    for (const entry of slabs) {
      const parsed = parseStructureText(entry.xyzData, `${entry.id}.xyz`);
      expect(parsed.pbc).toEqual([true, true, false]);
      expect(parsed.isPeriodic).toBe(false);
    }
  });

  it("keep at least 10 A of vacuum along z, and the category says what they are for", () => {
    for (const entry of slabs) {
      const parsed = parseStructureText(entry.xyzData, `${entry.id}.xyz`);
      const z = parsed.positions.map((p) => p[2]);
      const vacuum = parsed.lattice![2][2] - (Math.max(...z) - Math.min(...z));
      expect(vacuum, entry.id).toBeGreaterThan(10);
    }
    const surfaces = MLPEG_CATALOG.find((c) => c.id === "surfaces")!;
    expect(surfaces.description).toMatch(/not converged surface energies/i);
  });
});

describe("D71 every catalog cell is exact", () => {
  const cells = getAllEntries().filter((e) => /Lattice=/.test(e.xyzData) || ["benzene", "methane-dimer"].includes(e.id));

  it("writes cell vectors and coordinates to 6 decimals or more", () => {
    for (const entry of cells) {
      const lines = entry.xyzData.split("\n");
      const lattice = /Lattice="([^"]*)"/.exec(lines[1])?.[1].split(/\s+/) ?? [];
      const coordinates = lines.slice(2).flatMap((l) => l.trim().split(/\s+/).slice(1));
      for (const token of [...lattice, ...coordinates]) {
        expect(token, `${entry.id}: ${token}`).toMatch(/^-?\d+\.\d{6,}$/);
      }
    }
  });

  it("cu-111 is a hexagonal cell: equal in-plane vectors at exactly 60 degrees", () => {
    const parsed = parseStructureText(getAllEntries().find((e) => e.id === "cu-111")!.xyzData, "cu-111.xyz");
    const [a1, a2] = parsed.lattice!;
    const cos = (a1[0] * a2[0] + a1[1] * a2[1]) / (Math.hypot(a1[0], a1[1]) * Math.hypot(a2[0], a2[1]));
    expect(Math.acos(cos) * (180 / Math.PI)).toBeCloseTo(60, 5);
    expect(Math.hypot(a1[0], a1[1])).toBeCloseTo(Math.hypot(a2[0], a2[1]), 6);
    expect(Math.hypot(a1[0], a1[1])).toBeCloseTo(A_CU / SQRT2, 5);
  });

  it("benzene: six equal C-C and six equal C-H bonds at CCCBDB's values", () => {
    const parsed = parseStructureText(getAllEntries().find((e) => e.id === "benzene")!.xyzData, "benzene.xyz");
    const dist = (i: number, j: number) => Math.hypot(...[0, 1, 2].map((k) => parsed.positions[i][k] - parsed.positions[j][k]));
    const cc = [0, 1, 2, 3, 4, 5].map((i) => dist(i, (i + 1) % 6));
    const ch = [0, 1, 2, 3, 4, 5].map((i) => dist(i, i + 6));
    expect(Math.max(...cc) - Math.min(...cc)).toBeLessThan(2e-6);
    expect(Math.max(...ch) - Math.min(...ch)).toBeLessThan(2e-6);
    expect(cc[0]).toBeCloseTo(cited("benzene", "r_CC"), 5);
    expect(ch[0]).toBeCloseTo(cited("benzene", "r_CH"), 5);
  });
});

describe("D111 the methane dimer is S22 entry 8 (Jurecka et al., PCCP 2006)", () => {
  it("has the reference geometry from structure-references.json, atom for atom", () => {
    const want = cited("methane-dimer", "reference_geometry_xyz") as unknown as [string, number, number, number][];
    const parsed = parseStructureText(getAllEntries().find((e) => e.id === "methane-dimer")!.xyzData, "methane-dimer.xyz");
    expect(parsed.symbols).toEqual(want.map((a) => a[0]));
    want.forEach((a, i) => {
      const xyz = a.slice(1) as number[];
      for (let k = 0; k < 3; k++) expect(parsed.positions[i][k], `atom ${i}`).toBeCloseTo(xyz[k], 6);
    });
    const cc = Math.hypot(...[0, 1, 2].map((k) => parsed.positions[0][k] - parsed.positions[5][k]));
    expect(cc).toBeCloseTo(cited("methane-dimer", "C...C_distance"), 3);
  });

  it("is cited to S22", () => {
    const src = readFileSync("lib/mlpeg-catalog.ts", "utf8");
    expect(src).toMatch(/Jurečka/);
    expect(src).toMatch(/Phys\. Chem\. Chem\. Phys\. 8, 1985/);
  });
});

describe("D110, D112 reference values carry the source they were read from", () => {
  const ref = (id: string) => getAllEntries().find((e) => e.id === id)!.reference!;

  it("NaCl: the cohesive energy is the NIST-JANAF atomization energy per atom, with its temperature", () => {
    const perFormulaUnit = cited("NaCl-rocksalt", "cohesive_energy_per_fu_0K_from_JANAF");
    const c = ref("nacl-rocksalt").cohesiveEnergy!;
    expect(c.value).toBeCloseTo(-perFormulaUnit / 2, 6);
    expect(c.source).toMatch(/NIST-JANAF/);
    expect(c.source).toMatch(/0 K/);
    expect(c.source).toMatch(/÷ 2 atoms/);
    expect(c.source).not.toMatch(/CRC|6\.68/);
  });

  it("lattice constants are the cited COD values, and the cell is that value", () => {
    const cases: [string, string, number, string][] = [
      ["si-diamond", "Si-diamond", A_SI, "9011998"],
      ["c-diamond", "C-diamond", A_C, "9011997"],
      ["cu-fcc", "Cu-fcc", A_CU, "9013014"],
      ["nacl-rocksalt", "NaCl-rocksalt", A_NACL, "9003308"],
      ["fe-bcc", "Fe-bcc", A_FE, "9008536"],
    ];
    for (const [id, recordId, a, cod] of cases) {
      const lattice = ref(id).latticeConstant!;
      expect(lattice.value, id).toBe(a);
      expect(lattice.source, id).toContain(`COD ${cod}`);
      expect(lattice.source, id).not.toMatch(/Kittel|CRC/);
      const parsed = parseStructureText(getAllEntries().find((e) => e.id === id)!.xyzData, `${id}.xyz`);
      expect(parsed.lattice![0][0], `${id} cell`).toBeCloseTo(a, 6);
      expect(cited(recordId, "lattice_constant_exp")).toBe(a);
    }
  });
});
