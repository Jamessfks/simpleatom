"use client";

/**
 * BenchmarkMpComparison — MACE-MP-0 formation energies against the Materials
 * Project's published PBE(+U) values.
 *
 * This is the numeric half of SimpleAtom's quality bar, so it is built to be
 * argued with rather than admired:
 *
 *   - a declared pass/fail tolerance, stated before the table, with its
 *     rationale — a comparison without a threshold is decoration;
 *   - the caveats that decide whether the number means anything, on screen and
 *     not in a tooltip;
 *   - the elemental reference energies the formation energies were built from,
 *     printed, so a reader can redo the arithmetic;
 *   - every structure in the run that CANNOT be compared, listed with its
 *     reason. Nothing is silently dropped;
 *   - no band gap anywhere: MACE has no electronic structure.
 *
 * Every value carries its unit inline. See lib/mp-reference.ts for the science
 * and docs/v2/bars/materials-project.md for the bar this answers.
 */

import { useMemo } from "react";
import { ExternalLink, Info, MinusCircle, Ban } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  buildMpComparison,
  formatSigned,
  MP_CAVEATS,
  MP_REFERENCE_PROVENANCE,
  MP_TIGHT_EV_PER_ATOM,
  MP_TOLERANCE_EV_PER_ATOM,
  MP_TOLERANCE_RATIONALE,
  MP_COMPOUNDS,
  type MpCompoundRow,
  type MpModelComparison,
} from "@/lib/mp-reference";
import type { BenchmarkResult } from "@/types/mace";

interface Props {
  result: BenchmarkResult;
}

const VERDICT_STYLE: Record<
  MpCompoundRow["verdict"],
  { label: string; color: string; bg: string }
> = {
  "pass-tight": {
    label: `within ${(MP_TIGHT_EV_PER_ATOM * 1000).toFixed(0)} meV/atom`,
    color: "var(--color-success)",
    bg: "var(--color-success)",
  },
  pass: {
    label: "pass",
    color: "var(--color-success)",
    bg: "var(--color-success)",
  },
  fail: {
    label: "outside tolerance",
    color: "var(--color-error)",
    bg: "var(--color-error)",
  },
  unscored: {
    label: "not scored",
    color: "var(--color-text-muted)",
    bg: "var(--color-text-muted)",
  },
};

export function BenchmarkMpComparison({ result }: Props) {
  const comparison = useMemo(() => buildMpComparison(result), [result]);

  return (
    <div className="space-y-6">
      {/* What is being measured */}
      <section className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-5">
        <h3 className="font-serif text-lg font-semibold text-[var(--color-text-primary)]">
          Formation energy vs the Materials Project
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-text-secondary)]">
          For each compound below, a formation energy is built from this run&rsquo;s own MACE
          energies and compared against the value the Materials Project publishes for the same
          material. Total energies are never compared: MP&rsquo;s come from VASP with PAW
          reference states and are not on the same absolute scale as MACE&rsquo;s.
        </p>
        <p className="mt-3 max-w-3xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          E_f = [ E(compound) &minus; &Sigma;<sub>i</sub> n<sub>i</sub> &middot;
          e_ref(element<sub>i</sub>) ] / N_atoms &nbsp;&nbsp;[eV/atom]
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Each e_ref is the same MACE model evaluated on MP&rsquo;s own reference phase for that
          element, in this same batch. No MP elemental energy is mixed in — that substitution
          would hide the whole VASP-to-MACE offset inside the answer.
        </p>
      </section>

      {/* The declared tolerance */}
      <section className="rounded-lg border border-[var(--color-accent-primary)]/30 bg-[var(--color-accent-soft)] p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-sans text-sm font-bold text-[var(--color-text-primary)]">
            Tolerance
          </span>
          <span className="font-mono text-sm text-[var(--color-accent-strong)]">
            pass if |&Delta;E_f| &le; {MP_TOLERANCE_EV_PER_ATOM.toFixed(3)} eV/atom (
            {(MP_TOLERANCE_EV_PER_ATOM * 1000).toFixed(0)} meV/atom)
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {MP_TOLERANCE_RATIONALE} A tighter band of{" "}
          {(MP_TIGHT_EV_PER_ATOM * 1000).toFixed(0)} meV/atom is reported separately; it is not
          the pass line.
        </p>
      </section>

      {/* Empty state — never a fabricated table */}
      {!comparison.hasCompounds && (
        <section className="rounded-lg border border-dashed border-[var(--color-border-emphasis)] p-6">
          <p className="font-sans text-sm font-semibold text-[var(--color-text-primary)]">
            This run contains no Materials Project reference structures, so there is nothing to
            compare.
          </p>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-text-secondary)]">
            Select the <span className="font-semibold">Materials Project reference set</span> in
            the benchmark configuration and run again. The set contains{" "}
            {MP_COMPOUNDS.length} compound{MP_COMPOUNDS.length === 1 ? "" : "s"} plus the
            elemental reference phases they need; both halves must run for a formation energy to
            exist.
          </p>
          {comparison.exclusions.length > 0 && <Exclusions comparison={comparison} />}
        </section>
      )}

      {/* Per-model results */}
      {comparison.hasCompounds &&
        comparison.models.map((model) => (
          <ModelBlock key={model.modelLabel} model={model} />
        ))}

      {/* Caveats — visible, not hidden in a tooltip */}
      <section className="rounded-lg border border-[var(--color-warning)]/25 bg-[var(--color-warning)]/5 p-5">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 flex-shrink-0 text-[var(--color-warning)]" />
          <h4 className="font-sans text-sm font-bold text-[var(--color-text-primary)]">
            What this number does and does not mean
          </h4>
        </div>
        <dl className="mt-3 space-y-3">
          {MP_CAVEATS.map((c) => (
            <div key={c.title}>
              <dt className="font-sans text-xs font-semibold text-[var(--color-text-primary)]">
                {c.title}
              </dt>
              <dd className="mt-0.5 max-w-3xl text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {c.body}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Excluded structures */}
      {comparison.hasCompounds && comparison.exclusions.length > 0 && (
        <Exclusions comparison={comparison} />
      )}

      {/* Compounds in the set that were not run */}
      {comparison.hasCompounds && comparison.compoundsNotRun.length > 0 && (
        <section className="rounded-lg border border-[var(--color-border-subtle)] p-4">
          <h4 className="font-sans text-xs font-semibold text-[var(--color-text-muted)]">
            In the reference set but not in this run
          </h4>
          <p className="mt-2 font-mono text-xs text-[var(--color-text-secondary)]">
            {comparison.compoundsNotRun.map((c) => `${c.formula} (${c.mpId})`).join(" · ")}
          </p>
          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
            Not selected for this benchmark. Their absence lowers the number of scored rows; it
            does not affect the rows above.
          </p>
        </section>
      )}

      {/* Provenance */}
      <section className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-4">
        <h4 className="font-sans text-xs font-semibold text-[var(--color-text-muted)]">
          Reference data provenance
        </h4>
        <dl className="mt-2.5 grid gap-x-6 gap-y-1.5 font-mono text-xs sm:grid-cols-2">
          <ProvenanceRow label="Source" value={MP_REFERENCE_PROVENANCE.endpoint} />
          <ProvenanceRow
            label="OPTIMADE version"
            value={MP_REFERENCE_PROVENANCE.optimadeApiVersion}
          />
          <ProvenanceRow
            label="MP dataset key"
            value={`${MP_REFERENCE_PROVENANCE.datasetKey} — ${MP_REFERENCE_PROVENANCE.datasetLabel}`}
          />
          <ProvenanceRow label="Authentication" value={MP_REFERENCE_PROVENANCE.authentication} />
          <ProvenanceRow label="Fetched" value={MP_REFERENCE_PROVENANCE.fetchedAtUtc} />
          <ProvenanceRow label="Generated by" value={MP_REFERENCE_PROVENANCE.generator} />
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
          Values are a fixture captured at the timestamp above, not a live fetch — a page that
          silently rendered a stale number would be worse than one that dates it. Geometries are
          MP&rsquo;s PBE-relaxed cells from the same records. Re-fetch with{" "}
          <span className="font-mono">
            python {MP_REFERENCE_PROVENANCE.generator} --fetch
          </span>
          , and re-check the whole comparison offline with{" "}
          <span className="font-mono">--verify</span>.
        </p>
      </section>
    </div>
  );
}

function ProvenanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="flex-shrink-0 text-[var(--color-text-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-[var(--color-text-secondary)]">{value}</dd>
    </div>
  );
}

function ModelBlock({ model }: { model: MpModelComparison }) {
  const { stats } = model;

  return (
    <section className="rounded-lg border border-[var(--color-border-subtle)]">
      {/* Model header + summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] px-5 py-3">
        <span className="font-sans text-sm font-bold text-[var(--color-text-primary)]">
          {model.modelLabel}
        </span>

        {model.scorable && stats ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs">
            <span
              className={
                stats.passed === stats.scored
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-warning)]"
              }
            >
              {stats.passed}/{stats.scored} within {MP_TOLERANCE_EV_PER_ATOM.toFixed(3)} eV/atom
            </span>
            <span className="text-[var(--color-text-secondary)]">
              MAE {stats.mae.toFixed(4)} eV/atom ({(stats.mae * 1000).toFixed(1)} meV/atom)
            </span>
            <span className="text-[var(--color-text-secondary)]">
              bias {formatSigned(stats.bias)} eV/atom
            </span>
            <span className="text-[var(--color-text-secondary)]">
              max |&Delta;| {stats.maxAbs.toFixed(4)} eV/atom
            </span>
          </div>
        ) : (
          <Badge
            variant="outline"
            className="rounded border-[var(--color-text-muted)]/30 font-mono text-xs text-[var(--color-text-muted)]"
          >
            not scored
          </Badge>
        )}
      </div>

      {/* Not-scorable explanation */}
      {!model.scorable && (
        <div className="flex items-start gap-2.5 border-b border-[var(--color-border-subtle)] px-5 py-3">
          <Ban className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--color-text-muted)]" />
          <p className="max-w-3xl text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {model.notScorableReason}
          </p>
        </div>
      )}

      {/* Missing references */}
      {model.scorable && model.missingElementReferences.length > 0 && (
        <div className="flex items-start gap-2.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-warning)]/5 px-5 py-3">
          <MinusCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--color-warning)]" />
          <p className="max-w-3xl text-xs leading-relaxed text-[var(--color-text-secondary)]">
            No elemental reference ran for{" "}
            <span className="font-mono font-semibold">
              {model.missingElementReferences.join(", ")}
            </span>
            . Rows needing those elements are left unscored — MP&rsquo;s own elemental energies
            are not substituted, because that would not be a formation energy.
          </p>
        </div>
      )}

      {/* The comparison table */}
      <div className="overflow-x-auto">
        <Table className="font-mono text-xs">
          <TableHeader className="bg-[var(--color-bg-elevated)]/60 text-[var(--color-text-muted)]">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-auto px-4 py-2.5 text-left text-[var(--color-text-muted)]">
                Compound
              </TableHead>
              <TableHead className="h-auto px-3 py-2.5 text-left text-[var(--color-text-muted)]">
                MP id
              </TableHead>
              <TableHead className="h-auto px-3 py-2.5 text-right text-[var(--color-text-muted)]">
                MP E_f (eV/atom)
              </TableHead>
              <TableHead className="h-auto px-3 py-2.5 text-right text-[var(--color-text-muted)]">
                MACE E_f (eV/atom)
              </TableHead>
              <TableHead className="h-auto px-3 py-2.5 text-right text-[var(--color-text-muted)]">
                &Delta; (eV/atom)
              </TableHead>
              <TableHead className="h-auto px-3 py-2.5 text-right text-[var(--color-text-muted)]">
                &Delta; (meV/atom)
              </TableHead>
              <TableHead className="h-auto px-4 py-2.5 text-left text-[var(--color-text-muted)]">
                Verdict
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-[var(--color-text-secondary)]">
            {model.rows.map((row) => {
              const style = VERDICT_STYLE[row.verdict];
              const scored = row.deviation != null;
              return (
                <TableRow
                  key={row.entry.id}
                  className="border-t border-b-0 border-[var(--color-border-subtle)]/60 hover:bg-[var(--color-bg-elevated)]/50"
                >
                  <TableCell className="px-4 font-semibold text-[var(--color-text-primary)]">
                    {row.entry.formula}
                  </TableCell>
                  <TableCell className="px-3">
                    <a
                      href={`${MP_REFERENCE_PROVENANCE.materialUrlPrefix}${row.entry.mpId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[var(--color-accent-strong)] hover:underline"
                    >
                      {row.entry.mpId}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </TableCell>
                  <TableCell className="px-3 text-right tabular-nums">
                    {formatSigned(row.mpFormationEnergyPerAtom)}
                  </TableCell>
                  <TableCell className="px-3 text-right tabular-nums">
                    {row.maceFormationEnergyPerAtom != null
                      ? formatSigned(row.maceFormationEnergyPerAtom)
                      : "—"}
                  </TableCell>
                  <TableCell
                    className="px-3 text-right font-semibold tabular-nums"
                    style={scored ? { color: style.color } : undefined}
                  >
                    {row.deviation != null ? formatSigned(row.deviation) : "—"}
                  </TableCell>
                  <TableCell
                    className="px-3 text-right tabular-nums"
                    style={scored ? { color: style.color } : undefined}
                  >
                    {row.deviation != null ? formatSigned(row.deviation * 1000, 1) : "—"}
                  </TableCell>
                  <TableCell className="px-4">
                    {scored ? (
                      <span
                        className="rounded px-1.5 py-0.5 text-xs font-semibold"
                        style={{ color: style.color, backgroundColor: `${style.bg}14` }}
                      >
                        {style.label}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {row.unscoredReason}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Sign convention + the references used */}
      <div className="space-y-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          &Delta; = MACE E_f &minus; MP E_f. Negative means MACE binds the compound more
          strongly than MP&rsquo;s PBE value.
        </p>
        {model.elementReferences.length > 0 && (
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Elemental references used — {model.modelLabel}, this run
            </p>
            <p className="mt-1 font-mono text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {model.elementReferences
                .map(
                  (r) =>
                    `e_ref(${r.element}) = ${r.energyPerAtom.toFixed(6)} eV/atom [${r.mpId}]`,
                )
                .join("  ·  ")}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Exclusions({
  comparison,
}: {
  comparison: ReturnType<typeof buildMpComparison>;
}) {
  return (
    <section className="mt-4 rounded-lg border border-[var(--color-border-subtle)] p-4">
      <h4 className="font-sans text-xs font-semibold text-[var(--color-text-muted)]">
        Excluded from the comparison ({comparison.exclusions.length})
      </h4>
      <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-[var(--color-text-muted)]">
        These structures ran in this benchmark but cannot be compared against the Materials
        Project. Each reason is specific — a structure that cannot be compared is named, not
        quietly omitted.
      </p>
      <dl className="mt-3 space-y-2">
        {comparison.exclusions.map((ex) => (
          <div key={ex.structureId} className="sm:flex sm:gap-3">
            <dt className="flex-shrink-0 font-mono text-xs font-semibold text-[var(--color-text-secondary)] sm:w-44">
              {ex.name}
            </dt>
            <dd className="max-w-2xl text-xs leading-relaxed text-[var(--color-text-muted)]">
              {ex.reason}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
