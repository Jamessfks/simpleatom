/**
 * Structure resolution for the benchmark endpoint.
 *
 * The benchmark can run two families of structures:
 *
 *   1. the ml-peg catalog (lib/mlpeg-catalog.ts) — the structures the calculator
 *      page also offers, submitted as extended XYZ;
 *   2. the Materials Project reference set (lib/mp-reference-data.ts) — MP's own
 *      PBE-relaxed cells, each carrying MP's published formation energy, used by
 *      the "vs Materials Project" tab.
 *
 * Kept in its own module so the MP set never reaches the calculator page's
 * bundle: that page imports lib/mlpeg-catalog directly and its structure picker
 * is deliberately unchanged by this feature.
 *
 * WHY MP ENTRIES ARE SENT AS .cif
 *   When this set was added, mace-api/calculate.py read ".xyz" with ASE's plain
 *   "xyz" reader, which ignores the comment line, so extended-XYZ `Lattice=`
 *   and `pbc=` were discarded and MP's primitive FCC Cu (mp-30) came out at
 *   -0.93 eV/atom instead of -4.08 as an isolated cluster. That reader defect
 *   was fixed in 88aa676 (".xyz" now maps to "extxyz"). CIF is kept because
 *   every CIF in the fixture was checked to round-trip with no loss of
 *   minimum-image distances or cell parameters (see `cifRoundTrip`), and the
 *   cell lives in the body of the file rather than in a comment line.
 */

import { getEntriesByIds, type CatalogEntry } from "./mlpeg-catalog";
import { MP_REFERENCE_ENTRIES } from "./mp-reference-data";

/** Category id used for Materials Project reference-set structures. */
export const MP_CATEGORY_ID = "mp-reference";

/**
 * A structure the benchmark endpoint can run.
 *
 * `structureData` + `filename` are what actually get written to disk and handed
 * to the Python backend; the extension in `filename` selects the ASE reader.
 */
export interface BenchmarkStructure {
  id: string;
  name: string;
  category: string;
  formula: string;
  atomCount: number;
  elements: string[];
  /** File contents to calculate. */
  structureData: string;
  /** Filename, including the extension that picks the ASE reader. */
  filename: string;
  /**
   * True when the structure has a defined cell and a periodic result is the
   * only admissible one. The endpoint rejects a result whose returned lattice
   * is null for such a structure rather than reporting a cluster energy.
   */
  expectsPeriodic: boolean;
  /** Experimental reference values, ml-peg entries only. Never MP values. */
  reference?: CatalogEntry["reference"];
}

const MP_BY_ID = new Map(MP_REFERENCE_ENTRIES.map((e) => [e.id, e]));

/**
 * Resolve benchmark structure ids to runnable structures, preserving input
 * order. Unknown ids are dropped, matching getEntriesByIds().
 */
export function getBenchmarkStructuresByIds(ids: string[]): BenchmarkStructure[] {
  const catalogIds = ids.filter((id) => !MP_BY_ID.has(id));
  const catalogById = new Map(
    getEntriesByIds(catalogIds).map((e) => [e.id, e] as const),
  );

  const out: BenchmarkStructure[] = [];
  for (const id of ids) {
    const mp = MP_BY_ID.get(id);
    if (mp) {
      out.push({
        id: mp.id,
        name: mp.name,
        category: MP_CATEGORY_ID,
        formula: mp.formula,
        atomCount: mp.atomCount,
        elements: mp.elements,
        structureData: mp.cifData,
        filename: `${mp.id}.cif`,
        expectsPeriodic: true,
      });
      continue;
    }
    const entry = catalogById.get(id);
    if (!entry) continue;
    out.push({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      formula: entry.formula,
      atomCount: entry.atomCount,
      elements: entry.elements,
      structureData: entry.xyzData,
      filename: `${entry.id}.xyz`,
      // Left false for ml-peg entries pending a check of each one: several
      // declare a lattice and were submitted as .xyz while the reader defect
      // above existed. Making them periodic-strict is a follow-up once each
      // entry's returned lattice has been verified.
      expectsPeriodic: false,
      reference: entry.reference,
    });
  }
  return out;
}
