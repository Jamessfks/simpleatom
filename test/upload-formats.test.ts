import { describe, expect, it } from "vitest";
import { uploadFormats } from "@/components/calculate/upload-formats";
import { CONTRACT } from "@/lib/contract";

// D69 (F25): the upload accepted fewer extensions than the contract does, and
// greyed out bare POSCAR files in the picker.
describe("upload formats come from the contract (D69)", () => {
  it("accepts every extension the backend accepts", () => {
    const { accept } = uploadFormats();
    for (const ext of CONTRACT.structureExtensions) expect(accept.split(",")).toContain(ext);
    expect(accept.split(",")).toContain(".extxyz");
    expect(accept.split(",")).toContain(".vasp");
  });

  it("lists the extensionless names the picker cannot filter", () => {
    const { bareNames } = uploadFormats();
    expect(bareNames).toEqual(Object.keys(CONTRACT.bareStructureNames));
  });
});
