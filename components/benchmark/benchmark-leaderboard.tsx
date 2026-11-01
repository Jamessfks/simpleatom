"use client";

/**
 * BenchmarkLeaderboard — Sortable table comparing model results.
 *
 * Rows = structures, columns = models (energy/atom). Sortable by any
 * column. Cells are color-coded: green for lowest energy per row,
 * yellow/red for high ΔE_max (>5 / >10 meV/atom). Rows expand to show
 * per-atom force magnitudes.
 *
 * Aggregate footer shows, per model, how many structures it succeeded on and
 * the total time of those runs, and, under the spread column, the mean
 * per-structure spread between models. There is no mean energy per atom: it
 * would mix unrelated structures.
 */

import { useState, useMemo, Fragment } from "react";
import { ChevronDown, ChevronUp, AlertTriangle, ChevronRight } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { DATA_COLORS } from "@/components/calculate/charts/chart-config";
import { energySpread, formatSpread, meanSpread } from "./benchmark-spread";
import type { BenchmarkResult, BenchmarkStructureResult } from "@/types/mace";

const MODEL_COLORS = [DATA_COLORS.blue, DATA_COLORS.red, DATA_COLORS.green];

type SortKey = "structure" | "category" | "atoms" | "deltaE" | `model-${number}`;
type SortDir = "asc" | "desc";

interface LeaderboardProps {
  result: BenchmarkResult;
}

/**
 * Sort indicator. Defined at module scope: declared inside the component it
 * was a new component type on every render, so React remounted it each time.
 */
function SortIcon({ k, active, dir }: { k: SortKey; active: SortKey; dir: SortDir }) {
  if (active !== k) return null;
  return dir === "asc" ? (
    <ChevronUp className="inline h-3 w-3" />
  ) : (
    <ChevronDown className="inline h-3 w-3" />
  );
}

export function BenchmarkLeaderboard({ result }: LeaderboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>("structure");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const modelLabels = useMemo(() => {
    if (result.results.length === 0) return [];
    return result.results[0].models.map((m) => m.modelLabel);
  }, [result]);


  const sorted = useMemo(() => {
    const rows = [...result.results];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "structure":
          cmp = a.structureName.localeCompare(b.structureName);
          break;
        case "category":
          cmp = a.category.localeCompare(b.category);
          break;
        case "atoms":
          cmp = a.atomCount - b.atomCount;
          break;
        case "deltaE":
          // Rows that could not be compared sort after every row that could.
          cmp = (energySpread(a) ?? Infinity) === (energySpread(b) ?? Infinity) ? 0 : (energySpread(a) ?? Infinity) < (energySpread(b) ?? Infinity) ? -1 : 1;
          break;
        default:
          if (sortKey.startsWith("model-")) {
            const idx = parseInt(sortKey.split("-")[1]);
            const aE = a.models[idx]?.energyPerAtom ?? Infinity;
            const bE = b.models[idx]?.energyPerAtom ?? Infinity;
            cmp = aE - bE;
          }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [result, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const lowestEnergyPerRow = (row: BenchmarkStructureResult): number | null => {
    const energies = row.models
      .filter((m) => m.status === "success" && m.energyPerAtom != null)
      .map((m) => m.energyPerAtom!);
    return energies.length > 0 ? Math.min(...energies) : null;
  };

  const aggregates = useMemo(() => {
    return modelLabels.map((_, mi) => {
      const energies: number[] = [];
      let totalTime = 0;
      result.results.forEach((r) => {
        const m = r.models[mi];
        if (m?.status === "success") {
          if (m.energyPerAtom != null) energies.push(m.energyPerAtom);
          totalTime += m.timeTaken ?? 0;
        }
      });
      return { succeeded: energies.length, totalTime };
    });
  }, [result, modelLabels]);

  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <Table className="font-mono text-xs">
        <TableHeader className="sticky top-0 z-10 bg-bg-elevated text-text-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-auto w-5 px-2 py-2.5" />
            <TableHead
              className="h-auto cursor-pointer whitespace-normal px-3 py-2.5 text-left text-text-muted hover:text-text-secondary"
              onClick={() => handleSort("structure")}
            >
              Structure <SortIcon k="structure" active={sortKey} dir={sortDir} />
            </TableHead>
            <TableHead
              className="h-auto cursor-pointer whitespace-normal px-3 py-2.5 text-left text-text-muted hover:text-text-secondary"
              onClick={() => handleSort("category")}
            >
              Category <SortIcon k="category" active={sortKey} dir={sortDir} />
            </TableHead>
            <TableHead
              className="h-auto cursor-pointer px-3 py-2.5 text-right text-text-muted hover:text-text-secondary"
              onClick={() => handleSort("atoms")}
            >
              Atoms <SortIcon k="atoms" active={sortKey} dir={sortDir} />
            </TableHead>
            <TableHead
              className="h-auto whitespace-normal px-3 py-2.5 text-right"
              style={{ color: DATA_COLORS.yellow }}
              title={
                "Experimental cohesive energy from the literature. NOT a DFT total energy and " +
                "not comparable to the model columns beside it."
              }
            >
              Exp. cohesive (eV/atom)
            </TableHead>
            {modelLabels.map((label, i) => (
              <TableHead
                key={label}
                className="h-auto cursor-pointer px-3 py-2.5 text-right text-text-muted hover:text-text-secondary"
                onClick={() => handleSort(`model-${i}`)}
              >
                <span style={{ color: MODEL_COLORS[i] }}>{label}</span>{" "}
                <span className="text-text-muted">(eV/atom)</span>{" "}
                <SortIcon k={`model-${i}`} active={sortKey} dir={sortDir} />
              </TableHead>
            ))}
            <TableHead
              className="h-auto cursor-pointer px-3 py-2.5 text-right text-text-muted hover:text-text-secondary"
              onClick={() => handleSort("deltaE")}
            >
              ΔE<sub>max</sub> (meV/atom) <SortIcon k="deltaE" active={sortKey} dir={sortDir} />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="text-text-secondary">
          {sorted.map((row) => {
            const de = energySpread(row); // meV/atom, null with fewer than two successes
            const highDisagreement = de !== null && de > 10;
            const lowest = lowestEnergyPerRow(row);
            const isExpanded = expandedRow === row.structureId;

            return (
              <Fragment key={row.structureId}>
                <TableRow
                  className={`cursor-pointer border-t border-b-0 border-border-subtle/60 transition-colors hover:bg-bg-elevated ${
                    highDisagreement ? "bg-error/3" : ""
                  }`}
                  onClick={() =>
                    setExpandedRow(isExpanded ? null : row.structureId)
                  }
                >
                  <TableCell className="text-center text-text-muted">
                    <ChevronRight
                      className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </TableCell>
                  <TableCell className="whitespace-normal font-semibold text-text-primary">
                    {row.structureName}
                  </TableCell>
                  <TableCell className="whitespace-normal text-text-muted">
                    {formatCategoryName(row.category)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.atomCount}</TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    style={{ color: DATA_COLORS.yellow }}
                    title={row.reference?.cohesiveEnergy?.source ?? "No reference data"}
                  >
                    {row.reference?.cohesiveEnergy
                      ? `${row.reference.cohesiveEnergy.value.toFixed(2)}`
                      : "—"}
                  </TableCell>
                  {row.models.map((m, mi) => {
                    if (m.status === "error") {
                      return (
                        <TableCell key={mi} className="text-right">
                          <span className="inline-flex items-center gap-1 text-error" title={m.error}>
                            <AlertTriangle className="h-3 w-3" /> Error
                          </span>
                        </TableCell>
                      );
                    }
                    const isLowest = m.energyPerAtom != null && lowest != null && m.energyPerAtom === lowest;
                    return (
                      <TableCell
                        key={mi}
                        className={`text-right tabular-nums ${isLowest ? "bg-success/8 text-success" : ""}`}
                        title={m.energy?.toFixed(8) ?? ""}
                      >
                        {m.energyPerAtom?.toFixed(4) ?? "N/A"}
                      </TableCell>
                    );
                  })}
                  <TableCell
                    className={`text-right tabular-nums font-bold ${
                      highDisagreement
                        ? "text-error"
                        : de !== null && de > 5
                          ? "text-warning"
                          : "text-text-muted"
                    }`}
                    title={de === null ? "Fewer than two models succeeded, so there is nothing to compare." : undefined}
                  >
                    {de === null ? "—" : `${de.toFixed(1)} meV/atom`}
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow className="border-b-0 hover:bg-transparent">
                    <TableCell
                      colSpan={5 + modelLabels.length + 1}
                      className="whitespace-normal border-t border-border-subtle/30 bg-bg-primary px-4 py-3"
                    >
                      {row.reference?.cohesiveEnergy && (
                        <p className="mb-2 font-mono text-xs text-data-yellow">
                          Ref. cohesive energy: {row.reference.cohesiveEnergy.value.toFixed(2)} eV/atom
                          ({row.reference.cohesiveEnergy.source})
                          {row.reference.latticeConstant && (
                            <> · Lattice: {row.reference.latticeConstant.value.toFixed(3)} Å
                            ({row.reference.latticeConstant.source})</>
                          )}
                        </p>
                      )}
                      <ExpandedForceDetails row={row} modelColors={MODEL_COLORS} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>

        {/* Aggregate footer */}
        <TableFooter className="border-t-2 border-border-emphasis bg-bg-elevated">
          <TableRow className="hover:bg-transparent">
            <TableCell />
            <TableCell className="font-sans text-xs font-semibold text-text-muted">
              Aggregate
            </TableCell>
            <TableCell />
            <TableCell />
            <TableCell />
            {aggregates.map((agg, i) => (
              <TableCell key={i} className="text-right">
                <div className="font-mono text-xs tabular-nums text-text-secondary">
                  {agg.succeeded}/{result.results.length} succeeded
                </div>
                <div className="font-mono text-xs text-text-muted">
                  Time: {agg.totalTime.toFixed(1)}s
                </div>
              </TableCell>
            ))}
            <TableCell
              className="text-right font-mono text-xs tabular-nums text-text-secondary"
              title="Mean of the per-structure spreads, over the structures where at least two models succeeded."
            >
              Mean {formatSpread(meanSpread(result.results))}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      {/*
        The "Exp. cohesive" column sits next to model energies per atom, which
        invites exactly the comparison that is invalid: a cohesive energy is
        measured against isolated atoms, a MACE energy against the model's own
        reference. CLAUDE.md requires the experimental provenance to be noted in
        comparisons, and a caption is the only place a reader will actually see
        it. The valid numeric comparison lives on the "vs Materials Project" tab.
      */}
      <p className="border-t border-border-subtle px-4 py-3 font-mono text-xs leading-relaxed text-text-muted">
        <span style={{ color: DATA_COLORS.yellow }}>Exp. cohesive</span> is an{" "}
        <span className="font-semibold">experimental</span> cohesive energy from the literature
        (each row names its source: Kittel 8th ed. as tabulated by KnowledgeDoor, NIST-JANAF for NaCl)
        — not a DFT total energy, and not comparable to the model
        energy-per-atom columns beside it: the two use different reference states. It is context,
        not a score. For a comparison with a declared tolerance, see the{" "}
        <span className="font-semibold">vs Materials Project</span> tab, which compares formation
        energies against published PBE values.
      </p>
    </div>
  );
}

function ExpandedForceDetails({
  row,
  modelColors,
}: {
  row: BenchmarkStructureResult;
  modelColors: string[];
}) {
  const maxAtoms = Math.min(
    20,
    Math.max(...row.models.map((m) => m.forces?.length ?? 0))
  );

  if (maxAtoms === 0) {
    return (
      <p className="font-mono text-xs text-text-muted">
        No force data available for this structure.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-2 text-xs text-text-muted">
        Per-Atom Force Magnitudes (eV/Å)
      </p>
      <div className="max-h-48 overflow-auto rounded border border-border-subtle">
        <Table className="font-mono text-xs">
          <TableHeader className="sticky top-0 bg-bg-elevated text-text-muted">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-auto px-2 py-1 text-left text-text-muted">#</TableHead>
              <TableHead className="h-auto px-2 py-1 text-left text-text-muted">Elem</TableHead>
              {row.models.map((m, i) => (
                <TableHead key={i} className="h-auto px-2 py-1 text-right" style={{ color: modelColors[i] }}>
                  |F| {m.modelLabel.split(" ")[0]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="text-text-secondary">
            {Array.from({ length: maxAtoms }).map((_, ai) => {
              const sym = row.models.find((m) => m.symbols?.[ai])?.symbols?.[ai] ?? "—";
              return (
              <TableRow key={ai} className="border-t border-b-0 border-border-subtle/40">
                <TableCell className="px-2 py-0.5 text-text-muted">{ai + 1}</TableCell>
                <TableCell className="px-2 py-0.5 font-semibold">{sym}</TableCell>
                {row.models.map((m, mi) => {
                  const f = m.forces?.[ai];
                  const mag = f
                    ? Math.sqrt(f[0] ** 2 + f[1] ** 2 + f[2] ** 2)
                    : null;
                  return (
                    <TableCell key={mi} className="px-2 py-0.5 text-right tabular-nums">
                      {mag != null ? mag.toFixed(4) : "—"}
                    </TableCell>
                  );
                })}
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {maxAtoms < Math.max(...row.models.map((m) => m.forces?.length ?? 0)) && (
        <p className="mt-1 font-mono text-xs text-text-muted">
          Showing first {maxAtoms} atoms
        </p>
      )}
    </div>
  );
}

function formatCategoryName(id: string): string {
  const MAP: Record<string, string> = {
    "bulk-crystals": "Crystal",
    molecular: "Molecule",
    "non-covalent": "Non-Cov.",
    surfaces: "Surface",
    uploaded: "Uploaded",
  };
  return MAP[id] ?? id;
}
