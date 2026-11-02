import { describe, expect, it } from "vitest";
import { limitationsFor } from "@/components/calculate/limitations";
import { findModel } from "@/lib/contract";

const text = (id: string | undefined) =>
  limitationsFor(id)
    .map((l) => `${l.title} ${l.text}`)
    .join("\n");

// D37: the "Limitations and uncertainty" list was one static block, printing
// MACE-OFF's scope under materials results and advising a model-size sweep
// that MACE-MPA-0 (one size) cannot do. It now reads the registry entry of the
// model that ran.
describe("limitations are specific to the model that ran (D37)", () => {
  it("does not describe MACE-OFF under a materials model", () => {
    for (const id of ["MACE-MPA-0", "MACE-MP-0"]) {
      const t = text(id);
      expect(t).not.toMatch(/MACE-OFF/);
      expect(t).not.toMatch(/closed-shell/);
      expect(t).toContain(findModel(id)!.levelOfTheory!);
    }
  });

  it("never advises a size sweep the model does not offer", () => {
    expect(text("MACE-MPA-0")).not.toMatch(/small\/medium\/large/);
    // MPA-0 points at the other materials model instead.
    expect(text("MACE-MPA-0")).toContain("MACE-MP-0");
    expect(text("MACE-MP-0")).toContain("MACE-MPA-0");
  });

  it("states MACE-OFF's scope from the registry, for the alias too", () => {
    const elements = findModel("MACE-OFF")!.elements!.join(", ");
    for (const id of ["MACE-OFF", "MACE-OFF23"]) {
      const t = text(id);
      expect(t).toMatch(/closed-shell/);
      expect(t).toContain(elements);
    }
  });

  it("says a custom checkpoint's training and energy reference are unknown", () => {
    const t = text("custom");
    expect(t).toMatch(/unknown/i);
    expect(t).not.toMatch(/closed-shell/);
  });

  it("keeps the general rows when the model is not known", () => {
    const titles = limitationsFor(undefined).map((l) => l.title);
    expect(titles).toContain("ML potential, not QM");
    expect(titles).toContain("Out-of-distribution risk");
  });
});
