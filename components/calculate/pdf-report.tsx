"use client";

/**
 * "Download PDF report" button. The @react-pdf/renderer document lives in
 * pdf-report-document.tsx and is imported only when the button is pressed:
 * it used to be a static import, so every results page — including shared
 * MACE Links and their embeds — shipped the whole PDF engine up front.
 */

import { useState } from "react";
import { FileText } from "lucide-react";
import type { CalculationResult } from "@/types/mace";
import { Button } from "@/components/ui/button";

interface PDFReportButtonProps {
  result: CalculationResult;
}

export function PDFReportButton({ result }: PDFReportButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const { renderReportBlob } = await import("./pdf-report-document");
      const blob = await renderReportBlob(result);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mace-calculation-report.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleDownload} disabled={loading} variant="outline" size="sm">
      <FileText className="h-3.5 w-3.5" />
      {loading ? "Generating…" : "Download PDF report"}
    </Button>
  );
}
