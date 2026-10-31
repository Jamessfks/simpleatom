import { describe, expect, it } from "vitest";
import { getAllEntries } from "@/lib/mlpeg-catalog";
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

interface Expected {
  atoms: number;
  nearestNeighbour: number;
  /** Coordination of each atom at the nearest-neighbour distance, sorted. */
  coordination: number[];
  /** Bulk only: |det(lattice)| / atoms. */
  volumePerAtom?: number;
}

const EXPECTED: Record<string, Expected> = {
  "si-diamond": { atoms: 8, nearestNeighbour: (5.43 * SQRT3) / 4, coordination: Array(8).fill(4), volumePerAtom: 5.43 ** 3 / 8 },
  "c-diamond": { atoms: 8, nearestNeighbour: (3.567 * SQRT3) / 4, coordination: Array(8).fill(4), volumePerAtom: 3.567 ** 3 / 8 },
  "cu-fcc": { atoms: 4, nearestNeighbour: 3.615 / SQRT2, coordination: Array(4).fill(12), volumePerAtom: 3.615 ** 3 / 4 },
  "nacl-rocksalt": { atoms: 8, nearestNeighbour: 5.64 / 2, coordination: Array(8).fill(6), volumePerAtom: 5.64 ** 3 / 8 },
  "fe-bcc": { atoms: 2, nearestNeighbour: (2.87 * SQRT3) / 2, coordination: Array(2).fill(8), volumePerAtom: 2.87 ** 3 / 2 },
  // Three close-packed layers: the two surfaces lose the three neighbours of
  // the missing layer.
  "cu-111": { atoms: 3, nearestNeighbour: 3.615 / SQRT2, coordination: [9, 9, 12] },
  // Two diamond (111) bilayers: an outer atom keeps three bonds inside its
  // bilayer, an inner atom adds the one bond across to the other bilayer.
  "si-111": { atoms: 4, nearestNeighbour: (5.43 * SQRT3) / 4, coordination: [3, 3, 4, 4] },
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

const periodic = getAllEntries().filter((e) => /pbc="T T T"/.test(e.xyzData));

describe("catalog crystals are the structures their labels name", () => {
  it("covers every periodic entry", () => {
    expect(periodic.map((e) => e.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const entry of periodic) {
    const want = EXPECTED[entry.id];
    it(`${entry.id}: ${want?.atoms} atoms, nearest neighbour ${want?.nearestNeighbour.toFixed(4)} Å`, () => {
      const parsed = parseStructureText(entry.xyzData, `${entry.id}.xyz`);
      const lattice = parsed.lattice!;
      expect(parsed.isPeriodic).toBe(true);
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
