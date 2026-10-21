"use client";

/**
 * BenchmarkForceBars — Grouped bar chart and table for force comparison.
 *
 * Top: Plotly grouped bar chart (structures × models for RMS force).
 * Bottom: per-atom force magnitude table with element labels and spread
 * column (max - min force across models for that atom).
 */

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { BASE_LAYOUT, BASE_CONFIG, DATA_COLORS } from "@/components/calculate/charts/chart-config";
import type { BenchmarkResult } from "@/types/mace";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const MODEL_COLORS = [DATA_COLORS.blue, DATA_COLORS.red, DATA_COLORS.green];

interface ForceBarsProps {
  result: BenchmarkResult;
}

export function BenchmarkForceBars({ result }: ForceBarsProps) {
  const modelLabels = useMemo(() => {
    if (result.results.length === 0) return [];
    return result.results[0].models.map((m) => m.modelLabel);
  }, [result]);

  const structureNames = result.results.map((r) => r.structureName);

  const traces = modelLabels.map((label, mi) => ({
    name: label,
    type: "bar" as const,
    x: structureNames,
    y: result.results.map((r) => r.models[mi]?.rmsForce ?? 0),
    marker: { color: MODEL_COLORS[mi] },
    hovertemplate: "%{x}<br>RMS Force: %{y:.4f} eV/Å<extra>" + label + "</extra>",
  }));

  const forceTable = useMemo(() => {
    const rows: {
      structureName: string;
      atomIndex: number;
      element: string;
      forces: (number | null)[];
      spread: number;
    }[] = [];
    
    //***
    // the range of force magnitudes across models for that specific atom.
    //  A large spread means models disagree on how much force that atom experiences; 
    // a small spread means consensus
    //  */
    
    for (const r of result.results) {
      const maxAtoms = Math.min(
        5,
        Math.max(...r.models.map((m) => m.forces?.length ?? 0))
      );
      for (let ai = 0; ai < maxAtoms; ai++) {
        const mags = r.models.map((m) => {
          const f = m.forces?.[ai];
          return f ? Math.sqrt(f[0] ** 2 + f[1] ** 2 + f[2] ** 2) : null;
        });
        const valid = mags.filter((v): v is number => v != null);
        const spread = valid.length >= 2
          ? Math.max(...valid) - Math.min(...valid)
          : 0;
        const sym = r.models.find((m) => m.symbols?.[ai])?.symbols?.[ai] ?? "—";
        rows.push({
          structureName: r.structureName,
          atomIndex: ai + 1,
          element: sym,
          forces: mags,
          spread,
        });
      }
    }
    return rows;
  }, [result]);

  // Every hook runs before this return. It used to sit above the useMemo, so a
  // result going from empty to non-empty changed the number of hooks called
  // and React threw (rules-of-hooks).
  if (result.results.length === 0) {
    return (
      <Card className="gap-0 rounded-lg bg-[var(--color-bg-secondary)] p-6 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">No force data available.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Bar chart */}
      <Card className="gap-0 rounded-lg bg-[var(--color-bg-secondary)] p-4">
        <h3 className="mb-2 font-sans text-sm font-bold text-[var(--color-text-primary)]">
          RMS Force by Structure
        </h3>
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">
          Root-mean-square force magnitude per atom for each structure and model.
        </p>
        <Plot
          data={traces}
          layout={{
            ...BASE_LAYOUT,
            barmode: "group",
            xaxis: {
              ...BASE_LAYOUT.xaxis,
              tickangle: -30,
              title: { text: "Structure", standoff: 15 },
            },
            yaxis: {
              ...BASE_LAYOUT.yaxis,
              title: { text: "RMS Force (eV/Å)", standoff: 10 },
            },
            height: 380,
            margin: { l: 70, r: 20, t: 30, b: 100 },
          }}
          config={BASE_CONFIG}
          className="w-full"
        />
      </Card>

      {/* Force comparison table */}
      <Card className="gap-0 rounded-lg bg-[var(--color-bg-secondary)] p-4">
        <h3 className="mb-2 font-sans text-sm font-bold text-[var(--color-text-primary)]">
          Per-Atom Force Magnitudes
        </h3>
        <div className="max-h-96 overflow-auto rounded border border-[var(--color-border-subtle)]">
          <Table className="font-mono text-xs">
            <TableHeader className="sticky top-0 bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-auto px-3 py-2 text-left text-[var(--color-text-muted)]">Structure</TableHead>
                <TableHead className="h-auto px-3 py-2 text-right text-[var(--color-text-muted)]">Atom#</TableHead>
                <TableHead className="h-auto px-3 py-2 text-left text-[var(--color-text-muted)]">Elem</TableHead>
                {modelLabels.map((l, i) => (
                  <TableHead key={i} className="h-auto px-3 py-2 text-right" style={{ color: MODEL_COLORS[i] }}>
                    |F| {l.split(" (")[0]}
                  </TableHead>
                ))}
                <TableHead className="h-auto px-3 py-2 text-right text-[var(--color-text-muted)]">Spread</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-[var(--color-text-secondary)]">
              {forceTable.map((row, i) => (
                <TableRow
                  key={i}
                  className="border-t border-b-0 border-[var(--color-border-subtle)]/60 transition-colors hover:bg-[var(--color-bg-elevated)]"
                >
                  <TableCell className="px-3 py-1.5">{row.structureName}</TableCell>
                  <TableCell className="px-3 py-1.5 text-right tabular-nums">{row.atomIndex}</TableCell>
                  <TableCell className="px-3 py-1.5 font-semibold">{row.element}</TableCell>
                  {row.forces.map((f, fi) => (
                    <TableCell key={fi} className="px-3 py-1.5 text-right tabular-nums">
                      {f != null ? f.toFixed(4) : "—"}
                    </TableCell>
                  ))}
                  <TableCell className="px-3 py-1.5 text-right tabular-nums text-[var(--color-text-muted)]">
                    {row.spread.toFixed(4)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
