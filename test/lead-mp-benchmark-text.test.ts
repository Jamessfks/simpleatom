import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MP_REFERENCE_ENTRIES, mpEntryLabel } from "@/lib/mp-reference";
import { getBenchmarkStructuresByIds } from "@/lib/benchmark-structures";

// D155 (completes D121) and D156: the MP set's description must be true where
// it is written, and the benchmark must show the D107/D108 labels.
const generator = readFileSync("test_scripts/fetch_mp_reference.py", "utf8");
const data = readFileSync("lib/mp-reference-data.ts", "utf8");
const structures = readFileSync("lib/benchmark-structures.ts", "utf8");

describe("the MP reference set describes itself truthfully (D155)", () => {
  it("no longer calls the cells PBE-relaxed or the .xyz reader plain XYZ", () => {
    for (const text of [generator, data, structures]) {
      expect(text).not.toMatch(/PBE-relaxed/);
      expect(text).not.toMatch(/plain-xyz|plain XYZ reader|simple_read_xyz/);
    }
  });

  it("says the benchmark sends the CIF, which is what it sends", () => {
    expect(structures).toMatch(/structureData: mp\.cifData/);
    expect(data).toMatch(/The benchmark sends the CIF/);
    expect(data).not.toMatch(/The extended XYZ is what the benchmark sends/);
  });
});

describe("the benchmark shows the corrected MP labels (D156)", () => {
  it("uses mpEntryLabel for every MP entry", () => {
    const ids = MP_REFERENCE_ENTRIES.map((e) => e.id);
    const names = new Map(getBenchmarkStructuresByIds(ids).map((s) => [s.id, s.name]));
    for (const e of MP_REFERENCE_ENTRIES) expect(names.get(e.id)).toBe(mpEntryLabel(e));
  });
});
