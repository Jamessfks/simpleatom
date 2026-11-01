import { readFileSync } from "node:fs";
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
