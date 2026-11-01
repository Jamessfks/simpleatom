import { describe, expect, it } from "vitest";
import { MATBENCH, barText } from "@/app/v2/bars";
import { findModel } from "@/lib/contract";

// D66: /v2 printed Matbench ranks of 34 and 21 and said SimpleAtom "offers it
// nowhere". MACE-MPA-0 has been the default since v2.2.0, and the leaderboard
// moved. The ranks now come from one dated record, the scores from the registry.
describe("/v2 Matbench Discovery card (D66)", () => {
  const stale = {
    name: "Matbench Discovery",
    fetchable:
      "Fully public leaderboard. MACE-MP-0 ranks 34: F1 0.669. MACE-MPA-0 ranks 21 and beats it on every published metric; SimpleAtom offers it nowhere.",
  };

  it("states the current ranks with the date they were retrieved", () => {
    const text = barText(stale);
    expect(text).toContain("22nd of 43");
    expect(text).toContain("36th of 43");
    expect(text).toContain("Matbench Discovery, retrieved 2026-10-28");
    expect(MATBENCH.retrieved).toBe("2026-10-28");
  });

  it("no longer says SimpleAtom lacks MACE-MPA-0, and does not repeat the old ranks", () => {
    const text = barText(stale);
    expect(text).not.toMatch(/offers it nowhere/);
    expect(text).not.toMatch(/ranks 34|ranks 21/);
    expect(text).toMatch(/default/);
  });

  it("takes the scores from the model registry", () => {
    const text = barText(stale);
    expect(text).toContain(`F1 ${findModel("MACE-MPA-0")!.benchmark!.f1}`);
    expect(text).toContain(`F1 ${findModel("MACE-MP-0")!.benchmark!.f1}`);
  });

  it("leaves every other bar's text alone", () => {
    expect(barText({ name: "Mol*", fetchable: "Fully public." })).toBe("Fully public.");
  });
});
