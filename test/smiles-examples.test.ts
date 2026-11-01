import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SMILES_EXAMPLES } from "@/components/calculate/smiles-input";

// D109 (audit F12, H4): the example SMILES left stereocentres unspecified, and
// the converter filled them arbitrarily: "Alanine" came out D, the glucose
// anomeric carbon S, ibuprofen R. Each example now says which stereoisomer it
// is. The two PubChem-cited isomeric SMILES are the ones in
// docs/v2/validation/structure-references.json; their CIP labels (L-alanine S,
// anomeric C of beta-D-glucopyranose R, and (S)-ibuprofen for the ibuprofen
// SMILES) were checked with RDKit's CIP labeller on 2026-11-01.

const refs = JSON.parse(readFileSync("docs/v2/validation/structure-references.json", "utf8")) as {
  records: { id: string; fields: Record<string, { value: string }> }[];
};
const field = (id: string, key: string) => refs.records.find((r) => r.id === id)!.fields[key].value;
const example = (smiles: string) => SMILES_EXAMPLES.find((e) => e.smiles === smiles);

describe("example SMILES name their stereoisomer (D109)", () => {
  it("L-alanine is PubChem CID 5950, (S)", () => {
    const smiles = field("smiles-alanine", "L-alanine_isomeric_smiles_CID5950");
    expect(smiles).toBe("C[C@@H](C(=O)O)N");
    const ex = example(smiles)!;
    expect(ex.name).toBe("L-Alanine");
    expect(ex.detail).toMatch(/\(S\)/);
    expect(ex.detail).toMatch(/CID 5950/);
  });

  it("glucose is beta-D-glucopyranose, PubChem CID 64689", () => {
    const smiles = field("smiles-glucose", "beta-D-glucopyranose_isomeric_smiles_CID64689");
    const ex = example(smiles)!;
    expect(ex.name).toBe("β-D-Glucopyranose");
    expect(ex.detail).toMatch(/CID 64689/);
  });

  it("ibuprofen is (S), chosen on purpose, and says the drug is the racemate", () => {
    const ex = SMILES_EXAMPLES.find((e) => /Ibuprofen/.test(e.name))!;
    expect(ex.smiles).toBe("CC(C)Cc1ccc(cc1)[C@H](C)C(=O)O");
    expect(ex.name).toBe("(S)-Ibuprofen");
    expect(ex.detail).toMatch(/active enantiomer/i);
    expect(ex.detail).toMatch(/racemate/i);
  });

  it("no example keeps the unspecified alanine or the unspecified-anomer glucose", () => {
    const all = SMILES_EXAMPLES.map((e) => e.smiles);
    expect(all).not.toContain("CC(N)C(=O)O");
    expect(all).not.toContain("OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O");
    expect(all).not.toContain("CC(C)Cc1ccc(cc1)C(C)C(=O)O");
  });
});
