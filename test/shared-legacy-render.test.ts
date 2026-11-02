import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Radix mounts only the selected tab. Mount them all, so one render reaches
// every place the dashboard reads a trajectory.
vi.mock("@/components/ui/tabs", () => {
  const passthrough = ({ children }: { children?: unknown }) => createElement("div", null, children as never);
  return { Tabs: passthrough, TabsList: passthrough, TabsTrigger: passthrough, TabsContent: passthrough };
});

import { MetricsDashboard } from "@/components/calculate/metrics-dashboard";
import { normalizeSharedResult } from "@/lib/share";
import type { CalculationResult, SharedResult } from "@/types/mace";

const frame = [[0, 0, 0], [0.96, 0, 0], [-0.24, 0.93, 0]];

// What /r/[id] reads back for a row stored before the server checked its
// trajectory (D64): a successful MD result with whatever `trajectory` held.
const legacy = (trajectory: unknown): CalculationResult =>
  ({
    status: "success",
    energy: -14.2,
    symbols: ["O", "H", "H"],
    positions: frame,
    forces: frame,
    params: { calculationType: "molecular-dynamics", modelType: "MACE-OFF", modelSize: "small", mdEnsemble: "NVT" },
    ...(trajectory === undefined ? {} : { trajectory }),
  }) as unknown as CalculationResult;

const render = (result: CalculationResult) =>
  renderToString(createElement(MetricsDashboard, { result, filename: "water.xyz" }));

describe("a stored row whose trajectory lacks the arrays the page reads still renders (D64)", () => {
  const rows: [string, unknown][] = [
    ["{}", {}],
    ["only energies", { energies: [1] }],
    ["only positions", { positions: [frame, frame] }],
    ["only a step list", { step: [0, 1, 2] }],
    ["empty lists", { energies: [], positions: [], step: [] }],
    ["null", null],
    ["a list", []],
    ["a string", "x"],
  ];

  for (const [name, trajectory] of rows) {
    it(`renders with trajectory ${name}`, () => {
      expect(() => render(legacy(trajectory))).not.toThrow();
    });

    it(`renders with trajectory ${name} after normalisation`, () => {
      const shared = { id: "abc123", result: legacy(trajectory), params: {} } as unknown as SharedResult;
      expect(() => render(normalizeSharedResult(shared).result)).not.toThrow();
    });
  }

  it("renders a trajectory whose series are of the wrong type, once the store has normalised it", () => {
    const keys = ["energies", "potentialEnergies", "totalEnergies", "kineticEnergies", "temperatures", "step", "positions"];
    const failures: string[] = [];
    for (const key of keys) {
      for (const value of [5, "x", {}, null, ["a"], [null]]) {
        const trajectory: Record<string, unknown> = { energies: [1, 2], positions: [frame, frame], step: [0, 1] };
        trajectory[key] = value;
        const shared = { id: "abc123", result: legacy(trajectory), params: {} } as unknown as SharedResult;
        try {
          render(normalizeSharedResult(shared).result);
        } catch {
          failures.push(`${key} = ${JSON.stringify(value)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("renders a complete trajectory, so the cases above are not passing by rendering nothing", () => {
    const html = render(legacy({ energies: [-14.2, -14.1], step: [0, 1], positions: [frame, frame] }));
    expect(html).toMatch(/MD trajectory/i);
  });
});
