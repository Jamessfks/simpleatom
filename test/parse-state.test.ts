import { describe, expect, it } from "vitest";
import { parsedFor } from "@/components/calculate/parse-state";
import type { ParsedStructure } from "@/lib/parse-structure";

// D98 (web review W11): the parse effect did not clear the previous structure
// while a new file was still being read, so Run pressed in that window paired
// the new file with the old structure: the ledger, the NPT gate and the Compare
// model choice described the wrong file.

const file = (name: string) => new File(["x"], name);
const structure = (name: string) => ({ filename: name }) as ParsedStructure;

describe("the parsed structure belongs to the file it was parsed from (D98)", () => {
  const a = file("a.xyz");
  const b = file("b.cif");

  it("no file: nothing parsed, nothing pending", () => {
    expect(parsedFor(undefined, null)).toEqual({ structure: null, parsing: false });
    expect(parsedFor(undefined, { file: a, structure: structure("a") })).toEqual({ structure: null, parsing: false });
  });

  it("the file just chosen is pending, and the previous file's structure is not offered", () => {
    expect(parsedFor(b, { file: a, structure: structure("a") })).toEqual({ structure: null, parsing: true });
    expect(parsedFor(a, null)).toEqual({ structure: null, parsing: true });
  });

  it("once parsed, the structure is offered", () => {
    const s = structure("b");
    expect(parsedFor(b, { file: b, structure: s })).toEqual({ structure: s, parsing: false });
  });

  it("a file that could not be parsed is settled, not pending forever", () => {
    expect(parsedFor(b, { file: b, structure: null })).toEqual({ structure: null, parsing: false });
  });

  it("the same name with new content is a different file", () => {
    const a2 = file("a.xyz");
    expect(parsedFor(a2, { file: a, structure: structure("a") }).parsing).toBe(true);
  });
});
