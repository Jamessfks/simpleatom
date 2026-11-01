import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// D84 / D87: the landing page may promise only what the product does. Custom
// checkpoints are opt-in on a local install (ALLOW_CUSTOM_MODELS=1) and are
// never loaded on the public site (ADR-0020); three foundation models are
// offered (mace-api/contract.json); the benchmark compares models with each
// other and, for the Materials Project set, with MP's formation energies. It
// computes no force error against reference forces.
const intro = readFileSync("components/intro-section.tsx", "utf8").replace(/\s+/g, " ");

describe("landing copy (D84, D87)", () => {
  it("does not promise uploading custom checkpoints to everyone", () => {
    expect(intro).not.toMatch(/upload a fine-tuned/i);
    expect(intro).not.toMatch(/or your own fine-tuned checkpoint/i);
    expect(intro).not.toMatch(/your own checkpoints/i);
  });

  it("says custom checkpoints are local and opt-in, and not on the public site", () => {
    expect(intro).toMatch(/local install/i);
    expect(intro).toMatch(/ALLOW_CUSTOM_MODELS=1/);
    expect(intro).toMatch(/public site never loads/i);
  });

  it("counts three foundation models", () => {
    expect(intro).not.toMatch(/Two foundation models/);
    expect(intro).toMatch(/Three foundation models/);
    expect(intro).toMatch(/MACE-MPA-0, MACE-MP-0 and MACE-OFF/);
  });

  it("does not claim force error metrics", () => {
    expect(intro).not.toMatch(/force error/i);
    expect(intro).toMatch(/energy per atom, forces and run time/i);
  });
});

// D84 residual: the docs repeated what the landing page was corrected for. A
// custom checkpoint is local and opt-in, loading it runs the file's code, and the
// public site never loads one (docs/models.tsx says all of that). Every other docs
// page that mentions one must be as careful.
describe("docs copy about custom checkpoints is qualified (D84)", () => {
  const pages = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? pages(`${dir}/${e.name}`) : e.name === "page.tsx" ? [`${dir}/${e.name}`] : [],
    );
  const docs = pages("app/docs").map((path) => ({ path, text: readFileSync(path, "utf8").replace(/\s+/g, " ") }));
  const mention = /(your own|user-supplied|a user|custom model upload|fine-tuned)[^.<]{0,80}(checkpoint|\.model)/gi;

  it("never offers a custom checkpoint without saying it is local", () => {
    const unqualified: string[] = [];
    for (const { path, text } of docs) {
      for (const m of text.matchAll(mention)) {
        const around = text.slice(Math.max(0, m.index! - 250), m.index! + m[0].length + 250);
        if (!/local/i.test(around)) unqualified.push(`${path}: ${m[0]}`);
      }
    }
    expect(unqualified).toEqual([]);
  });

  it("the docs home says the checkpoint is a local, opt-in extra and the public site never loads one", () => {
    const home = docs.find((d) => d.path === "app/docs/page.tsx")!.text;
    expect(home).not.toMatch(/or your own fine-tuned checkpoint/i);
    expect(home).toMatch(/local install/i);
    expect(home).toMatch(/ALLOW_CUSTOM_MODELS=1/);
    expect(home).toMatch(/public site never loads/i);
  });

  it("the parameter table's Custom Model Upload row is local-only, opt-in, runs the file's code, and not on the public site", () => {
    const calculations = docs.find((d) => d.path === "app/docs/calculations/page.tsx")!.text;
    const row = calculations.match(/<td>Custom Model Upload<\/td>.*?<\/tr>/)?.[0] ?? "";
    expect(row).toMatch(/local/i);
    expect(row).toMatch(/ALLOW_CUSTOM_MODELS=1/);
    expect(row).toMatch(/runs (the )?(code|file)/i);
    expect(row).toMatch(/public site never loads/i);
  });

  it("the Model Type row does not offer a user checkpoint to everyone", () => {
    const calculations = docs.find((d) => d.path === "app/docs/calculations/page.tsx")!.text;
    expect(calculations).not.toMatch(/or a user checkpoint/i);
  });
});
