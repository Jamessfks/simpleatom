import { describe, expect, it } from "vitest";
import { SHARE_ID_PATTERN, embedPath, normalizeSharedResult } from "@/lib/share";
import type { SharedResult } from "@/types/mace";

const base = (extra: Record<string, unknown>): SharedResult =>
  ({
    id: "abc12345",
    params: {},
    created_at: "2026-01-01T00:00:00Z",
    result: { status: "success", energy: -1, ...extra },
  }) as unknown as SharedResult;

describe("MACE Link", () => {
  it("accepts old nanoid(8) ids and new 12-char ids, nothing path-like", () => {
    expect(SHARE_ID_PATTERN.test("gK7tabOE")).toBe(true);
    expect(SHARE_ID_PATTERN.test("Ab3_-xYz09Qw")).toBe(true);
    expect(SHARE_ID_PATTERN.test("../../etc")).toBe(false);
  });

  it("builds the embed path the framing exemption expects", () => {
    expect(embedPath("abc12345")).toBe("/r/abc12345/embed");
  });

  it("drops a provenance block with nothing to render, and keeps numbers", () => {
    const out = normalizeSharedResult(base({ provenance: { schemaVersion: 1, model: { name: null } } }));
    expect(out.result.provenance).toBeUndefined();
    expect(out.result.energy).toBe(-1);
  });

  it("drops a stored trajectory with no arrays instead of letting the page throw (D64)", () => {
    for (const trajectory of [{}, null, [], "x", { energies: [1] }]) {
      const out = normalizeSharedResult(base({ trajectory }));
      expect(out.result.trajectory).toBeUndefined();
      expect(out.result.energy).toBe(-1);
    }
    const kept = { energies: [1, 2], step: [0, 1], positions: [[[0, 0, 0]], [[0, 0, 1]]] };
    expect(normalizeSharedResult(base({ trajectory: kept })).result.trajectory).toEqual(kept);
  });

  it("keeps a validation block that actually ran", () => {
    const out = normalizeSharedResult(base({ validation: { status: "ran", valid: true } }));
    expect(out.result.validation?.status).toBe("ran");
  });
});
