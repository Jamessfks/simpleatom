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
  const [failed, setFailed] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const { renderReportBlob } = await import("./pdf-report-document");
      const blob = await renderReportBlob(result);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mace-calculation-report.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // The PDF engine is a separate chunk: a dropped connection or a render
      // error would otherwise leave the button silently doing nothing.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Button onClick={handleDownload} disabled={loading} variant="outline" size="sm" className="min-h-11">
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        {loading ? "Generating…" : (
          <>
            <span className="sm:hidden">PDF report</span>
            <span className="max-sm:hidden">Download PDF report</span>
          </>
        )}
      </Button>
      {failed && (
        <p role="alert" className="text-xs text-error">
          The PDF could not be created. Try again, or download the JSON.
        </p>
      )}
    </div>
  );
}
