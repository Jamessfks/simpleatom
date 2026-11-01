import { describe, expect, it } from "vitest";
import {
  GIT_COMMIT_PATTERN,
  MAX_RENDERED_ROWS,
  checkSharedResultShape,
  visibleRows,
} from "@/lib/share";

const SHA = "a".repeat(64);

const good = (extra: Record<string, unknown> = {}) => ({
  status: "success",
  energy: -1,
  symbols: ["O", "H", "H"],
  warnings: ["Optimization not converged: 0.1 eV/Å > fmax 0.05 eV/Å after 500/500 steps."],
  message: "ok",
  params: { calculationType: "geometry-opt", finalFmax: 0.1, optSteps: 500, converged: false, modelType: "MACE-OFF" },
  provenance: {
    schemaVersion: 1,
    timestampUtc: "2026-08-10T02:38:41Z",
    model: { type: "MACE-OFF", size: "small", checkpoint: { filename: "x.model", sizeBytes: 12, sha256: SHA, resolvedBy: "mace-cache-dir" } },
    packages: { "mace-torch": "0.3.14", torch: null },
    input: { filename: "w.xyz", format: "xyz", nAtoms: 3, formula: "H2O", fileSha256: SHA, structureSha256: SHA, structureHashSpec: "simpleatom-structure-v1" },
    runtime: { device: "cpu", precision: "float64", seed: null, python: "3.11.9", platform: "macOS-14-arm64", executable: "python3" },
    code: { gitCommit: "0123abc", gitDirty: false },
    paramsRef: "result.params",
    notes: ["code.gitDirty is null: no git checkout."],
  },
  validation: { status: "ran", valid: true, issues: [], warnings: [], info: ["energy in range"], params: null },
  ...extra,
});

const problem = (extra: Record<string, unknown>) => checkSharedResultShape(good(extra), 3)?.field ?? null;

// D64: MACE Link renders client-submitted metadata as fact. The server now
// refuses shapes the page cannot render safely, and the page caps what it draws.
describe("shared result metadata is checked on the server (D64)", () => {
  it("accepts what the backend actually produces", () => {
    expect(checkSharedResultShape(good(), 3)).toBeNull();
  });

  it("only treats a hex string as a git commit", () => {
    expect(GIT_COMMIT_PATTERN.test("0123abc")).toBe(true);
    expect(GIT_COMMIT_PATTERN.test("a".repeat(40))).toBe(true);
    expect(GIT_COMMIT_PATTERN.test("../../../x/y/pull/1")).toBe(false);
    expect(GIT_COMMIT_PATTERN.test("abc")).toBe(false);
    expect(GIT_COMMIT_PATTERN.test("A".repeat(40))).toBe(false);
  });

  it("refuses a gitCommit that would become a link to another GitHub path", () => {
    const prov = good().provenance as Record<string, unknown>;
    expect(problem({ provenance: { ...prov, code: { gitCommit: "../../../x/y/pull/1", gitDirty: false } } })).toBe(
      "result.provenance.code.gitCommit",
    );
  });

  it("refuses values the page would call .toFixed or .slice on", () => {
    const prov = good().provenance as Record<string, unknown>;
    expect(problem({ params: { finalFmax: "0.1" } })).toBe("result.params.finalFmax");
    expect(problem({ provenance: { ...prov, timestampUtc: 12345 } })).toBe("result.provenance.timestampUtc");
    expect(problem({ provenance: { ...prov, timestampUtc: "yesterday" } })).toBe("result.provenance.timestampUtc");
    expect(
      problem({ provenance: { ...prov, model: { type: "x", checkpoint: { sha256: "not-a-hash" } } } }),
    ).toBe("result.provenance.model.checkpoint.sha256");
  });

  it("refuses a validation block that is not a validator's output", () => {
    expect(problem({ validation: { status: "all good" } })).toBe("result.validation.status");
    expect(problem({ validation: { status: "ran", info: "fine" } })).toBe("result.validation.info");
    expect(problem({ validation: { status: "ran", valid: "yes" } })).toBe("result.validation.valid");
  });

  it("bounds free text and list sizes", () => {
    expect(problem({ message: "x".repeat(5000) })).toBe("result.message");
    expect(problem({ warnings: Array.from({ length: 500 }, () => "w") })).toBe("result.warnings");
    expect(problem({ warnings: [1, 2] })).toBe("result.warnings");
  });

  it("refuses trajectory series that are not finite numbers", () => {
    expect(problem({ trajectory: { energies: [1, NaN], step: [0, 1], positions: [] } })).toBe("result.trajectory.energies");
    expect(problem({ trajectory: { energies: [1], step: ["a"], positions: [] } })).toBe("result.trajectory.step");
    expect(
      problem({ trajectory: { energies: [1], step: [0], positions: [[[0, 0, 0]]] } }),
    ).toBe("result.trajectory.positions");
  });
});

describe("rendered table rows are capped (D64)", () => {
  it("shows every row of an ordinary result", () => {
    const rows = Array.from({ length: 50 }, (_, i) => i);
    expect(visibleRows(rows)).toEqual({ shown: rows, hidden: 0 });
  });

  it("stops at the cap and says how many were left out", () => {
    const rows = Array.from({ length: MAX_RENDERED_ROWS + 1234 }, (_, i) => i);
    const { shown, hidden } = visibleRows(rows);
    expect(shown).toHaveLength(MAX_RENDERED_ROWS);
    expect(hidden).toBe(1234);
  });
});
