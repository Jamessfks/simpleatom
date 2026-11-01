import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Radix mounts only the selected tab. Mount them all, so one render reaches every
// section of the dashboard.
vi.mock("@/components/ui/tabs", () => {
  const passthrough = ({ children }: { children?: unknown }) => createElement("div", null, children as never);
  return { Tabs: passthrough, TabsList: passthrough, TabsTrigger: passthrough, TabsContent: passthrough };
});

import { summarizeShared } from "@/app/r/[id]/result-context";
import { MetricsDashboard } from "@/components/calculate/metrics-dashboard";
import { TrajectoryViewer } from "@/components/calculate/trajectory/trajectory-viewer";
import { checkSharedResultShape, normalizeSharedResult } from "@/lib/share";
import type { SharedResult } from "@/types/mace";

// D164: normalizeSharedResult is what the /r/[id] pages read a stored row through.
// It dropped a trajectory the page could not draw and an empty provenance or
// validation, and trusted everything else. Before the Supabase lockdown (D32) any
// client could insert a row, so a value of the wrong type in any section crashed
// the page for everyone who opened the link. The read path now applies the write
// path's section checks (checkSharedResultShape) and drops each section that fails.

const SHA = "a".repeat(64);
const frame = [[0, 0, 0], [0.96, 0, 0], [-0.24, 0.93, 0]];

const storedResult = (): Record<string, unknown> => ({
  status: "success",
  energy: -14.2,
  symbols: ["O", "H", "H"],
  positions: frame,
  forces: frame,
  lattice: [[10, 0, 0], [0, 10, 0], [0, 0, 10]],
  properties: { volume: 1000, pressure: 0.1, stress: [0.1, 0.1, 0.1, 0, 0, 0] },
  message: "NVT run finished",
  warnings: ["A warning"],
  licenseNotice: "MACE-OFF23 is distributed under the Academic Software License.",
  timeTaken: 1.2,
  clientRoundTrip: 2.3,
  params: { calculationType: "molecular-dynamics", modelType: "MACE-OFF", modelSize: "small", mdEnsemble: "NVT", temperature: 300 },
  provenance: {
    schemaVersion: 1,
    timestampUtc: "2026-08-10T02:38:41Z",
    model: { type: "MACE-OFF", size: "small", checkpoint: { filename: "x.model", sizeBytes: 12, sha256: SHA, resolvedBy: "mace-cache-dir" } },
    packages: { "mace-torch": "0.3.14", torch: null },
    input: { filename: "w.xyz", format: "xyz", nAtoms: 3, formula: "H2O", fileSha256: SHA, structureSha256: SHA, structureHashSpec: "simpleatom-structure-v1" },
    runtime: { device: "cpu", precision: "float32", seed: 42, python: "3.11.9", platform: "macOS-14-arm64", executable: "python3" },
    code: { gitCommit: "0123abc", gitDirty: false },
    paramsRef: "result.params",
    notes: ["code.gitDirty is null: no git checkout."],
  },
  validation: { status: "ran", valid: true, issues: [], warnings: ["w"], info: ["energy in range"], params: null },
  trajectory: {
    energies: [-14.2, -14.1],
    potentialEnergies: [-14.2, -14.1],
    kineticEnergies: [0.1, 0.2],
    totalEnergies: [-14.1, -13.9],
    temperatures: [290, 310],
    step: [0, 1],
    positions: [frame, frame],
  },
});

const stored = (patch: Record<string, unknown> = {}, row: Record<string, unknown> = {}): SharedResult =>
  ({
    id: "abc12345",
    created_at: "2026-01-01T00:00:00Z",
    filename: "water.xyz",
    params: { calculationType: "molecular-dynamics", modelType: "MACE-OFF" },
    ...row,
    result: { ...storedResult(), ...patch },
  }) as unknown as SharedResult;

// What the page does with a row: normalise it, summarise it, draw the dashboard
// and the trajectory player.
function open(shared: SharedResult) {
  const read = normalizeSharedResult(shared);
  summarizeShared(read);
  const html = renderToString(createElement(MetricsDashboard, { result: read.result, filename: read.filename }));
  renderToString(createElement(TrajectoryViewer, { result: read.result }));
  return { read, html };
}

const at = (value: unknown, path: string[]): unknown =>
  path.reduce<unknown>((v, key) => (v !== null && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined), value);

describe("a well-formed stored row is read as it is (D164)", () => {
  it("comes back as the same object and draws every section", () => {
    const shared = stored();
    const { read, html } = open(shared);
    expect(read).toBe(shared);
    expect(html).toMatch(/MD trajectory/i);
    expect(html).toMatch(/Manifest notes/);
  });

  it("keeps a long legitimate trajectory whole: sizes are the write path's business, not the read path's", () => {
    const frames = Array.from({ length: 2500 }, () => frame);
    const trajectory = { energies: frames.map(() => -14.2), step: frames.map((_, i) => i), positions: frames };
    const shared = stored({ trajectory });
    expect(normalizeSharedResult(shared)).toBe(shared);
  });
});

// One forged row per section: [name, patch applied to a good result, path that must be gone, a sibling that must stay].
type Forged = [string, Record<string, unknown>, string[], string[]];
const prov = (patch: Record<string, unknown>) => ({ ...(storedResult().provenance as object), ...patch });
const traj = (patch: Record<string, unknown>) => ({ ...(storedResult().trajectory as object), ...patch });

const FORGED: Forged[] = [
  // The sites the pages crashed at
  ["trajectory frames that are strings", { trajectory: traj({ positions: ["abc", "abc"] }) }, ["trajectory"], ["energy"]],
  ["trajectory frames with a non-number coordinate", { trajectory: traj({ positions: [[["x", 0, 0], [0, 0, 0], [0, 0, 0]], frame] }) }, ["trajectory"], ["energy"]],
  ["trajectory frames with the wrong atom count", { trajectory: traj({ positions: [[[0, 0, 0]], [[0, 0, 0]]] }) }, ["trajectory"], ["energy"]],
  ["trajectory frames holding objects", { trajectory: traj({ positions: [[{}, {}, {}], [{}, {}, {}]] }) }, ["trajectory"], ["energy"]],
  ["provenance notes of numbers and objects", { provenance: prov({ notes: [1, { a: 1 }] }) }, ["provenance", "notes"], ["provenance", "model"]],
  ["provenance notes that are one string", { provenance: prov({ notes: "x" }) }, ["provenance", "notes"], ["provenance", "model"]],
  ["provenance notes that are a number", { provenance: prov({ notes: 5 }) }, ["provenance", "notes"], ["provenance", "model"]],
  ["validation lists that are strings", { validation: { status: "ran", valid: true, issues: "x", warnings: {}, info: 5 } }, ["validation"], ["energy"]],
  ["validation parameter findings that are strings", { validation: { status: "ran", valid: true, params: { valid: true, issues: "x" } } }, ["validation"], ["energy"]],
  ["a validation block of the wrong type", { validation: "ran" }, ["validation"], ["energy"]],
  ["an energy that is a string", { energy: "-14.2" }, ["energy"], ["symbols"]],
  ["an energy that is an object", { energy: {} }, ["energy"], ["symbols"]],
  ["a cell volume that is a string", { properties: { volume: "1000", pressure: 0.1 } }, ["properties", "volume"], ["properties", "pressure"]],
  ["a cell volume that is an object", { properties: { volume: { v: 1 } } }, ["properties", "volume"], ["energy"]],
  // The remaining sections the write path checks
  ["warnings that are one string", { warnings: "x" }, ["warnings"], ["energy"]],
  ["warnings that are numbers", { warnings: [1, 2] }, ["warnings"], ["energy"]],
  ["a message that is an object", { message: { a: 1 } }, ["message"], ["energy"]],
  ["a licence notice that is a list", { licenseNotice: ["x"] }, ["licenseNotice"], ["energy"]],
  ["a time taken that is a string", { timeTaken: "1.2" }, ["timeTaken"], ["energy"]],
  ["a lattice of strings", { lattice: "cell" }, ["lattice"], ["energy"]],
  ["a stress tensor of objects", { properties: { volume: 1000, stress: [{}, {}, {}, {}, {}, {}] } }, ["properties", "stress"], ["properties", "volume"]],
  ["a parameter of the wrong type", { params: { calculationType: "molecular-dynamics", modelType: "MACE-OFF", temperature: { k: 300 } } }, ["params", "temperature"], ["params", "modelType"]],
  ["params that are a string", { params: "fast" }, ["params"], ["energy"]],
  ["a status that is an object", { status: { a: 1 } }, ["status"], ["energy"]],
  ["provenance that is a string", { provenance: "signed" }, ["provenance"], ["energy"]],
  ["a provenance filename that is an object", { provenance: prov({ input: { filename: { a: 1 }, nAtoms: 3 } }) }, ["provenance", "input", "filename"], ["provenance", "model"]],
  ["a provenance package version that is an object", { provenance: prov({ packages: { torch: {} } }) }, ["provenance", "packages", "torch"], ["provenance", "model"]],
  ["a provenance checkpoint size that is a string", { provenance: prov({ model: { type: "MACE-OFF", checkpoint: { filename: "x", sizeBytes: "big", sha256: SHA } } }) }, ["provenance", "model", "checkpoint", "sizeBytes"], ["provenance", "model", "checkpoint", "sha256"]],
  ["reference forces of strings", { referenceForces: ["a", "b"] }, ["referenceForces"], ["energy"]],
  ["a client round trip that is a string", { clientRoundTrip: "2.3" }, ["clientRoundTrip"], ["energy"]],
  ["an isolated-atoms energy that is a string", { properties: { volume: 1000, isolatedAtomsEnergy: "x", energyPerAtomVsIsolatedAtoms: {} } }, ["properties", "isolatedAtomsEnergy"], ["properties", "volume"]],
  // The structure itself
  ["symbols that are numbers", { symbols: [8, 1, 1] }, ["symbols"], ["energy"]],
  ["symbols that are not element symbols", { symbols: ["O", "H", "<script>"] }, ["symbols"], ["energy"]],
  ["positions that are not 3-vectors", { positions: [[0, 0], [0, 0], [0, 0]] }, ["positions"], ["forces"]],
  ["forces for the wrong number of atoms", { forces: [[0, 0, 0]] }, ["forces"], ["positions"]],
];

describe("a stored row with a forged section opens, and the section is dropped (D164)", () => {
  for (const [name, patch, gone, kept] of FORGED) {
    it(name, () => {
      const { read } = open(stored(patch));
      expect(at(read.result, gone), `${gone.join(".")} should be dropped`).toBeUndefined();
      expect(at(read.result, kept), `${kept.join(".")} should be kept`).not.toBeUndefined();
    });
  }

  it("drops the structure's dependants when its symbols are forged", () => {
    const { read } = open(stored({ symbols: "OHH" }));
    expect(read.result.symbols).toBeUndefined();
    expect(read.result.trajectory).toBeUndefined();
  });

  it("leaves the numbers of every other section untouched", () => {
    const { read } = open(stored({ warnings: "x" }));
    expect(read.result.energy).toBe(-14.2);
    expect(read.result.forces).toEqual(frame);
    expect(read.result.trajectory).toEqual(storedResult().trajectory);
    expect(read.result.validation).toEqual(storedResult().validation);
  });
});

describe("the read path caps what a forged row can make the page draw (D164)", () => {
  it("drops three megabytes of provenance notes instead of rendering them", () => {
    const notes = Array.from({ length: 50_000 }, (_, i) => `note ${i} ${"x".repeat(60)}`);
    const { read, html } = open(stored({ provenance: prov({ notes }) }));
    expect(read.result.provenance?.notes).toBeUndefined();
    expect(read.result.provenance?.model).toBeDefined();
    expect(html.length).toBeLessThan(500_000);
  });

  it("drops a warnings list longer than the write path allows", () => {
    const warnings = Array.from({ length: 5_000 }, (_, i) => `warning ${i}`);
    const { read, html } = open(stored({ warnings }));
    expect(read.result.warnings).toBeUndefined();
    expect(html.length).toBeLessThan(500_000);
  });

  it("drops a message and a validation line longer than the write path allows", () => {
    const { read } = open(stored({ message: "m".repeat(1_000_000), validation: { status: "ran", valid: true, info: ["i".repeat(1_000_000)] } }));
    expect(read.result.message).toBeUndefined();
    expect(read.result.validation).toBeUndefined();
  });
});

describe("the row's own columns are read as carefully as its result (D164)", () => {
  it("drops a params column that is not an object, and a parameter of the wrong type in it", () => {
    for (const params of ["fast", 5, ["a"], null]) {
      const { read } = open(stored({}, { params }));
      expect(read.params).toEqual({});
    }
    const { read } = open(stored({}, { params: { modelType: "MACE-OFF", temperature: {} } }));
    expect(read.params).toEqual({ modelType: "MACE-OFF" });
  });

  it("drops a file name that is not text", () => {
    const { read } = open(stored({}, { filename: { a: 1 } }));
    expect(read.filename).toBeUndefined();
  });

  it("replaces a result that is not an object with a failed one", () => {
    for (const result of ["x", 5, [], null]) {
      const shared = { ...stored(), result } as unknown as SharedResult;
      const { read } = open(shared);
      expect(read.result).toEqual({ status: "error" });
    }
  });
});

describe("what the read path drops is what the write path refuses (D164)", () => {
  it("refuses each new shape on the way in as well", () => {
    const refused = (patch: Record<string, unknown>) => checkSharedResultShape({ ...storedResult(), ...patch }, 3)?.field ?? null;
    expect(refused({ clientRoundTrip: "2.3" })).toBe("result.clientRoundTrip");
    expect(refused({ referenceForces: ["a"] })).toBe("result.referenceForces");
    expect(refused({ properties: { isolatedAtomsEnergy: "x" } })).toBe("result.properties.isolatedAtomsEnergy");
    expect(refused({ provenance: prov({ input: { filename: {} } }) })).toBe("result.provenance.input.filename");
    expect(refused({ provenance: prov({ packages: { torch: 1 } }) })).toBe("result.provenance.packages.torch");
    expect(refused({})).toBeNull();
  });
});
