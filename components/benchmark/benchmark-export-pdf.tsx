/**
 * Benchmark PDF document (@react-pdf/renderer). Imported on demand by
 * BenchmarkExport so the PDF engine is not part of the benchmark page bundle.
 */

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import { getSiteUrl } from "@/lib/site";
import type { BenchmarkResult } from "@/types/mace";

const pdfStyles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  title: {
    fontSize: 18,
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: "#3A7A40",
    paddingBottom: 8,
  },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 12, marginBottom: 8, color: "#3A7A40" },
  row: { flexDirection: "row", marginBottom: 4 },
  label: { width: 160, color: "#666" },
  value: { flex: 1 },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingVertical: 3,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: "#3A7A40",
    paddingBottom: 5,
    marginBottom: 4,
    fontWeight: "bold",
  },
  col: { flex: 1, textAlign: "right", paddingHorizontal: 2 },
  colLeft: { flex: 1.5, textAlign: "left", paddingHorizontal: 2 },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#999",
    textAlign: "center",
  },
});

function BenchmarkPDF({ result }: { result: BenchmarkResult }) {
  const modelLabels =
    result.results.length > 0
      ? result.results[0].models.map((m) => m.modelLabel)
      : [];

  let maxDisagreement = { structure: "", delta: 0 };
  for (const r of result.results) {
    const energies = r.models
      .filter((m) => m.status === "success" && m.energyPerAtom != null)
      .map((m) => m.energyPerAtom!);
    if (energies.length >= 2) {
      const d = (Math.max(...energies) - Math.min(...energies)) * 1000;
      if (d > maxDisagreement.delta) {
        maxDisagreement = { structure: r.structureName, delta: d };
      }
    }
  }

  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        <Text style={pdfStyles.title}>MACE Benchmark Report</Text>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Configuration</Text>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.label}>Models compared:</Text>
            <Text style={pdfStyles.value}>{modelLabels.join(", ")}</Text>
          </View>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.label}>Structures tested:</Text>
            <Text style={pdfStyles.value}>
              {result.summary.totalStructures} structures
            </Text>
          </View>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.label}>Total calculations:</Text>
            <Text style={pdfStyles.value}>
              {result.summary.totalCalculations} ({result.summary.successCount} success,{" "}
              {result.summary.errorCount} errors)
            </Text>
          </View>
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.label}>Total time:</Text>
            <Text style={pdfStyles.value}>{result.summary.totalTime.toFixed(1)}s</Text>
          </View>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Energy per Atom Leaderboard (eV)</Text>
          <View style={pdfStyles.tableHeader}>
            <Text style={pdfStyles.colLeft}>Structure</Text>
            {/* Labelled "Exp." to match the Leaderboard: this is an experimental
                cohesive energy, not a DFT reference, and not comparable to the
                model columns next to it. The footnote below spells it out. */}
            <Text style={pdfStyles.col}>Exp.</Text>
            {modelLabels.map((l) => (
              <Text key={l} style={pdfStyles.col}>
                {l.replace("MACE-", "")}
              </Text>
            ))}
            <Text style={pdfStyles.col}>dE (meV)</Text>
          </View>
          {result.results.map((r) => {
            const energies = r.models
              .filter((m) => m.status === "success" && m.energyPerAtom != null)
              .map((m) => m.energyPerAtom!);
            const de =
              energies.length >= 2
                ? ((Math.max(...energies) - Math.min(...energies)) * 1000).toFixed(1)
                : "N/A";
            return (
              <View key={r.structureId} style={pdfStyles.tableRow}>
                <Text style={pdfStyles.colLeft}>{r.structureName}</Text>
                <Text style={pdfStyles.col}>
                  {r.reference?.cohesiveEnergy
                    ? r.reference.cohesiveEnergy.value.toFixed(2)
                    : "—"}
                </Text>
                {r.models.map((m, i) => (
                  <Text key={i} style={pdfStyles.col}>
                    {m.status === "success" && m.energyPerAtom != null
                      ? m.energyPerAtom.toFixed(4)
                      : "err"}
                  </Text>
                ))}
                <Text style={pdfStyles.col}>{de}</Text>
              </View>
            );
          })}
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Timing Summary</Text>
          {modelLabels.map((label, mi) => {
            const total = result.results.reduce(
              (s, r) => s + (r.models[mi]?.timeTaken ?? 0),
              0
            );
            return (
              <View key={label} style={pdfStyles.row}>
                <Text style={pdfStyles.label}>{label}:</Text>
                <Text style={pdfStyles.value}>{total.toFixed(1)}s total</Text>
              </View>
            );
          })}
        </View>

        {maxDisagreement.delta > 0 && (
          <View style={pdfStyles.section}>
            <Text style={pdfStyles.sectionTitle}>Key Findings</Text>
            <Text style={pdfStyles.value}>
              Largest model disagreement: {maxDisagreement.structure} (dE ={" "}
              {maxDisagreement.delta.toFixed(1)} meV/atom)
            </Text>
          </View>
        )}

        <View style={pdfStyles.section}>
          <Text style={{ fontSize: 7, color: "#999", lineHeight: 1.4 }}>
            Reference values are experimental cohesive energies (Kittel 8th ed., CRC Handbook).
            MACE is trained on PBE DFT and inherits PBE&rsquo;s differences from experiment, which depend on the material and the property.
            Direct comparison of model total energy to experimental cohesive energy is not valid
            without accounting for isolated atom references and DFT functional biases.
            See Miret et al. (arXiv:2502.03660) for discussion of MLIP evaluation beyond
            energy/force regression.
          </Text>
        </View>

        <Text style={pdfStyles.footer}>
          MACE Benchmark Suite — Generated from {getSiteUrl()}
        </Text>
      </Page>
    </Document>
  );
}

export function renderBenchmarkBlob(result: BenchmarkResult): Promise<Blob> {
  return pdf(<BenchmarkPDF result={result} />).toBlob();
}
