"use client";

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { CalculationParams, CalculationResult } from "@/types/mace";
import { getSiteUrl } from "@/lib/site";
import { reportNotes } from "./report-notes";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
  },
  title: {
    fontSize: 18,
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: "#4A7BF7",
    paddingBottom: 8,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    marginBottom: 8,
    color: "#4A7BF7",
  },
  row: {
    flexDirection: "row",
    marginBottom: 4,
  },
  label: {
    width: 120,
    color: "#666",
  },
  value: {
    flex: 1,
  },
  table: {
    marginTop: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingVertical: 4,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: "#4A7BF7",
    paddingBottom: 6,
    marginBottom: 4,
    fontWeight: "bold",
  },
  tableCol1: { width: "10%", textAlign: "left" },
  tableCol2: { width: "15%", textAlign: "left" },
  tableCol3: { width: "20%", textAlign: "right" },
  tableCol4: { width: "20%", textAlign: "right" },
  tableCol5: { width: "20%", textAlign: "right" },
  tableCol6: { width: "15%", textAlign: "right" },
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

function formatParams(params: Partial<CalculationParams> | undefined): string {
  if (!params) return "N/A";
  const parts: string[] = [];
  if (params.calculationType) parts.push(`Type: ${params.calculationType}`);
  if (params.temperature != null) parts.push(`Temperature: ${params.temperature} K`);
  if (params.pressure != null) parts.push(`Pressure: ${params.pressure} GPa`);
  if (params.timeStep != null) parts.push(`Time step: ${params.timeStep} fs`);
  if (params.friction != null) parts.push(`Friction: ${params.friction}`);
  if (params.mdSteps != null) parts.push(`MD steps: ${params.mdSteps}`);
  if (params.mdEnsemble) parts.push(`Ensemble: ${params.mdEnsemble}`);
  if (params.forceThreshold != null) parts.push(`Force threshold: ${params.forceThreshold} eV/Å`);
  if (params.modelSize) parts.push(`Model: ${params.modelType || "N/A"} (${params.modelSize})`);
  return parts.length ? parts.join("; ") : "N/A";
}

function MACEReportPDF({ result }: { result: CalculationResult }) {
  const forceMag = (f: number[]) =>
    Math.sqrt(f[0] ** 2 + f[1] ** 2 + f[2] ** 2).toFixed(4);
  const siteHost = new URL(getSiteUrl()).host;
  const notes = reportNotes(result);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>MACE Calculation Report</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Outcome:</Text>
            <Text style={styles.value}>{notes.outcome.headline}</Text>
          </View>
          {notes.outcome.detail && (
            <View style={styles.row}>
              <Text style={styles.label}>Detail:</Text>
              <Text style={styles.value}>{notes.outcome.detail}</Text>
            </View>
          )}
          {result.timeTaken != null && (
            <View style={styles.row}>
              <Text style={styles.label}>Time taken:</Text>
              <Text style={styles.value}>{result.timeTaken} s</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>Total Energy:</Text>
            <Text style={styles.value}>{result.energy?.toFixed(6)} eV</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Energy per atom:</Text>
            <Text style={styles.value}>
              {result.symbols && result.energy
                ? (result.energy / result.symbols.length).toFixed(4)
                : "N/A"}{" "}
              eV
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Number of atoms:</Text>
            <Text style={styles.value}>{result.symbols?.length || 0}</Text>
          </View>
          {result.properties?.volume && (
            <View style={styles.row}>
              <Text style={styles.label}>Volume:</Text>
              <Text style={styles.value}>{result.properties.volume} Å³</Text>
            </View>
          )}
          {result.message && (
            <View style={styles.row}>
              <Text style={styles.label}>Note:</Text>
              <Text style={styles.value}>{result.message}</Text>
            </View>
          )}
        </View>

        {notes.warnings.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Warnings from the calculation</Text>
            {notes.warnings.map((warning, i) => (
              <Text key={i} style={styles.value}>{`\u2022 ${warning}`}</Text>
            ))}
          </View>
        )}

        {notes.licenseNotice && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Model licence</Text>
            <Text style={styles.value}>{notes.licenseNotice}</Text>
          </View>
        )}

        {result.params && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Physical Parameters</Text>
            <Text style={styles.value}>{formatParams(result.params)}</Text>
          </View>
        )}

        {result.forces && result.symbols && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Atomic Forces (eV/Å)</Text>
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={styles.tableCol1}>#</Text>
                <Text style={styles.tableCol2}>Element</Text>
                <Text style={styles.tableCol3}>Fx</Text>
                <Text style={styles.tableCol4}>Fy</Text>
                <Text style={styles.tableCol5}>Fz</Text>
                <Text style={styles.tableCol6}>|F|</Text>
              </View>
              {result.forces.slice(0, 50).map((force, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={styles.tableCol1}>{i + 1}</Text>
                  {/* symbols may be shorter than forces — guard with a fallback */}
                  <Text style={styles.tableCol2}>{result.symbols![i] ?? "?"}</Text>
                  <Text style={styles.tableCol3}>{force[0].toFixed(4)}</Text>
                  <Text style={styles.tableCol4}>{force[1].toFixed(4)}</Text>
                  <Text style={styles.tableCol5}>{force[2].toFixed(4)}</Text>
                  <Text style={styles.tableCol6}>{forceMag(force)}</Text>
                </View>
              ))}
              {result.forces.length > 50 && (
                <Text style={{ marginTop: 8, color: "#666" }}>
                  ... and {result.forces.length - 50} more atoms
                </Text>
              )}
            </View>
          </View>
        )}

        <Text style={styles.footer}>
          SimpleAtom • Powered by MACE • Generated from {siteHost}
        </Text>
      </Page>
    </Document>
  );
}

/** Render the report to a PDF blob. Imported on demand by PDFReportButton. */
export function renderReportBlob(result: CalculationResult): Promise<Blob> {
  return pdf(<MACEReportPDF result={result} />).toBlob();
}
