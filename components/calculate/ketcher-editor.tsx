"use client";

/**
 * KetcherEditor — Wrapper around EPAM Ketcher molecular editor.
 *
 * Provides a full 2D/3D molecular drawing canvas with a toolbar to
 * export the drawn structure as SMILES, convert to 3D via RDKit,
 * and send it to the MACE calculator.
 *
 * This entire component is loaded via next/dynamic (ssr: false) from
 * page.tsx, so all top-level imports here are safe — they only execute
 * in the browser.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  ArrowRight,
  Copy,
  Check,
  AlertCircle,
} from "lucide-react";
import { Editor } from "ketcher-react";
import type { StructServiceProvider } from "ketcher-core";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import "ketcher-react/dist/index.css";
import "./ketcher-overrides.css";

interface KetcherEditorProps {
  onStructureReady: (files: File[]) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KetcherInstance = any;

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-()[\]=#+.@]/g, "_").slice(0, 60);
}

// Instantiate once — lives for the lifetime of the module (browser tab).
const structServiceProvider = new StandaloneStructServiceProvider() as unknown as StructServiceProvider;

export function KetcherEditorInner({ onStructureReady }: KetcherEditorProps) {
  const ketcherRef = useRef<KetcherInstance>(null);
  const [isReady, setIsReady] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset ready state if component remounts
  useEffect(() => {
    return () => {
      ketcherRef.current = null;
    };
  }, []);

  const handleInit = useCallback((ketcher: KetcherInstance) => {
    ketcherRef.current = ketcher;
    setIsReady(true);
  }, []);

  const handleUseInCalculator = useCallback(async () => {
    if (!ketcherRef.current) return;

    setIsConverting(true);
    setError(null);

    try {
      const smiles: string = await ketcherRef.current.getSmiles();
      if (!smiles || !smiles.trim()) {
        throw new Error("No molecule drawn. Please draw a structure first.");
      }

      const response = await fetch("/api/smiles-to-xyz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smiles: smiles.trim() }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.error || `Conversion failed (HTTP ${response.status})`
        );
      }

      const data = await response.json();
      if (data.error || data.status === "error") {
        throw new Error(data.error || data.message || "Conversion failed");
      }

      const filename = `smiles_${sanitizeFilename(data.smiles_canonical || smiles)}.xyz`;
      const file = new File([data.xyz], filename, { type: "text/plain" });
      onStructureReady([file]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to export structure"
      );
    } finally {
      setIsConverting(false);
    }
  }, [onStructureReady]);

  const handleCopySmiles = useCallback(async () => {
    if (!ketcherRef.current) return;
    try {
      const smiles: string = await ketcherRef.current.getSmiles();
      if (smiles && smiles.trim()) {
        await navigator.clipboard.writeText(smiles.trim());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // silently fail
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-4">
        <div className="flex items-center gap-2">
          <button
            onClick={handleUseInCalculator}
            disabled={!isReady || isConverting}
            className="flex items-center gap-2 rounded-md border-2 border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/10 px-5 py-2.5 font-sans text-sm font-bold text-[var(--color-accent-strong)] transition-all hover:bg-[var(--color-accent-primary)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--color-accent-primary)]/10 disabled:hover:text-[var(--color-accent-strong)]"
          >
            {isConverting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Converting to 3D...
              </>
            ) : (
              <>
                <ArrowRight className="h-4 w-4" />
                Use in Calculator
              </>
            )}
          </button>

          <button
            onClick={handleCopySmiles}
            disabled={!isReady}
            className="flex items-center gap-1.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] px-3 py-2.5 font-mono text-xs text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent-primary)] hover:text-white disabled:opacity-40"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy SMILES
              </>
            )}
          </button>
        </div>

        <p className="font-mono text-xs text-zinc-500">
          Draw a molecule, then click &quot;Use in Calculator&quot; to run MACE
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-error)]" />
          <p className="font-mono text-xs text-[var(--color-error)]/90">
            {error}
          </p>
        </div>
      )}

      {/* Ketcher Editor */}
      <div className="ketcher-editor-container overflow-hidden rounded-lg border border-[var(--color-border-subtle)]">
        <div style={{ height: 700 }}>
          <Editor
            staticResourcesUrl=""
            structServiceProvider={structServiceProvider}
            errorHandler={(message: string) => {
              console.warn("[Ketcher]", message);
            }}
            onInit={handleInit}
          />
        </div>
      </div>
    </div>
  );
}
