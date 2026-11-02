import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D85: "PBE overbinds by 0.1-0.5 eV/atom" had no source. PBE's differences from
// experiment depend on the material and the property (lattice constants run
// large, cohesive energies run both ways), so no single band is true. The one
// measured example the project owns is silicon, COD 9011998.

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .filter((p) => !p.includes("/generated/"));
}

const band = /0\.1\s*(?:–|-|&ndash;|&mdash;)\s*0\.5\s*eV/;

describe("no unsourced error band for PBE (D85)", () => {
  for (const dir of ["app", "components", "lib"]) {
    it(`${dir}/ states no 0.1–0.5 eV/atom band`, () => {
      const offenders = sources(dir).filter((p) => band.test(readFileSync(p, "utf8").replace(/\s+/g, " ")));
      expect(offenders).toEqual([]);
    });
  }

  it("the docs pages say what depends on what, and cite silicon", () => {
    for (const page of ["faq", "models", "validation"]) {
      const text = readFileSync(`app/docs/${page}/page.tsx`, "utf8").replace(/\s+/g, " ");
      expect(text, page).toMatch(/inherit(?:s)? PBE(?:'|&rsquo;|’)s differences from experiment, which depend on the material and the property/);
    }
    const models = readFileSync("app/docs/models/page.tsx", "utf8").replace(/\s+/g, " ");
    expect(models).toMatch(/a = 5\.467 Å vs 5\.4309 Å measured \(COD 9011998, 298 K\)/);
  });
});
