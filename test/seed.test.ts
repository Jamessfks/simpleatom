import { describe, expect, it } from "vitest";
import { parseSeed } from "@/components/calculate/seed";
import { checkCalculationParams, PARAMS } from "@/lib/contract";

// D36: the docs tell users to change the MD seed for independent replicas, so
// the calculator needs a seed field. Blank means "the backend's default", never
// a number the user did not type.
describe("MD seed input (D36)", () => {
  const { min, max } = PARAMS.seed;

  it("leaves the seed unset when the box is empty", () => {
    expect(parseSeed("", min, max)).toEqual({ value: undefined, error: null });
    expect(parseSeed("   ", min, max)).toEqual({ value: undefined, error: null });
  });

  it("accepts integers across the contract's range", () => {
    expect(parseSeed("42", min, max).value).toBe(42);
    expect(parseSeed(" 7 ", min, max).value).toBe(7);
    expect(parseSeed(String(min), min, max).value).toBe(min);
    expect(parseSeed(String(max), min, max).value).toBe(max);
  });

  it("refuses what the backend would refuse, and blocks the run instead of using the default", () => {
    for (const raw of ["-1", String(max + 1), "1.5", "abc", "1e3", "0x10"]) {
      const out = parseSeed(raw, min, max);
      expect(out.error).toMatch(/whole number/);
      expect(out.error).not.toMatch(/default seed is used/);
      // The invalid entry reaches the request check, so the run stays blocked:
      // running with seed 42 while the box shows something else would be a
      // different calculation from the one on screen.
      const violation = checkCalculationParams({ calculationType: "molecular-dynamics", seed: out.value }, "hosted", false);
      expect(violation?.code).toBe("invalid_number");
    }
  });
});
