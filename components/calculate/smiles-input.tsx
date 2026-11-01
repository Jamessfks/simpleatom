"use client";

/**
 * SmilesInput — SMILES string input with example molecules panel.
 *
 * Converts a SMILES string to 3D XYZ via the /api/smiles-to-xyz endpoint,
 * then feeds the resulting File into the existing upload pipeline.
 */

import { useState, useCallback } from "react";
import { Loader2, FlaskConical, Sparkles, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { smilesToFile } from "@/lib/api-client";
import { useCapabilities } from "@/lib/use-capabilities";

interface SmilesInputProps {
  onFilesChange: (files: File[]) => void;
}

export interface ExampleMolecule {
  name: string;
  smiles: string;
  formula: string;
  /** Which stereoisomer this is, where the molecule has stereocentres. */
  detail?: string;
}

/**
 * Every stereocentre is written out, so the 3D structure is the isomer the name
 * says. A SMILES that leaves one unspecified is filled in arbitrarily by the
 * converter (D109: "Alanine" came out D, ibuprofen R). The isomeric SMILES for
 * L-alanine (PubChem CID 5950) and beta-D-glucopyranose (CID 64689) are
 * PubChem's, as docs/v2/validation/structure-references.json records them;
 * ibuprofen is (S) on purpose. CIP labels were checked with RDKit's CIP labeller.
 */
export const SMILES_EXAMPLES: ExampleMolecule[] = [
  { name: "Ethanol", smiles: "CCO", formula: "C₂H₆O" },
  { name: "Water", smiles: "O", formula: "H₂O" },
  { name: "Methane", smiles: "C", formula: "CH₄" },
  { name: "Benzene", smiles: "c1ccccc1", formula: "C₆H₆" },
  { name: "Acetic acid", smiles: "CC(=O)O", formula: "C₂H₄O₂" },
  { name: "Aspirin", smiles: "CC(=O)Oc1ccccc1C(=O)O", formula: "C₉H₈O₄" },
  { name: "Caffeine", smiles: "Cn1c(=O)c2c(ncn2C)n(C)c1=O", formula: "C₈H₁₀N₄O₂" },
  {
    name: "L-Alanine",
    smiles: "C[C@@H](C(=O)O)N",
    formula: "C₃H₇NO₂",
    detail: "(S)-alanine, PubChem CID 5950",
  },
  {
    name: "β-D-Glucopyranose",
    smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O",
    formula: "C₆H₁₂O₆",
    detail: "PubChem CID 64689: the anomeric carbon is R, as in the β anomer",
  },
  {
    name: "(S)-Ibuprofen",
    smiles: "CC(C)Cc1ccc(cc1)[C@H](C)C(=O)O",
    formula: "C₁₃H₁₈O₂",
    detail:
      "the (S) enantiomer, the active enantiomer, chosen on purpose; the marketed drug is the racemate (PubChem CID 3672)",
  },
];

export function SmilesInput({ onFilesChange }: SmilesInputProps) {
  const [smiles, setSmiles] = useState("");
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caps = useCapabilities();

  const handleConvert = useCallback(async () => {
    const trimmed = smiles.trim();
    if (!trimmed) {
      setError("Please enter a SMILES string");
      return;
    }

    setIsConverting(true);
    setError(null);

    try {
      const file = await smilesToFile(trimmed);
      onFilesChange([file]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SMILES conversion failed");
    } finally {
      setIsConverting(false);
    }
  }, [smiles, onFilesChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isConverting && smiles.trim()) {
      handleConvert();
    }
  };

  const handleExampleClick = (example: ExampleMolecule) => {
    setSmiles(example.smiles);
    setError(null);
  };

  return (
    <div className="space-y-4">
      {/* SMILES text input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Label htmlFor="smiles-string-input" className="sr-only">
            SMILES string
          </Label>
          <FlaskConical
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            strokeWidth={1.75}
          />
          <Input
            id="smiles-string-input"
            type="text"
            value={smiles}
            onChange={(e) => {
              setSmiles(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Enter SMILES (e.g., CCO for ethanol)"
            disabled={isConverting}
            maxLength={caps.limits.maxSmilesLength}
            className="pl-9 font-mono text-sm"
          />
        </div>
        <Button
          type="button"
          onClick={handleConvert}
          disabled={isConverting || !smiles.trim()}
          className="shrink-0 gap-2 font-mono text-xs"
        >
          {isConverting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
              Converting...
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
              Convert to 3D
            </>
          )}
        </Button>
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-error/30 bg-error/5 px-3 py-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-error" strokeWidth={1.75} />
          <p className="font-mono text-xs text-error/90">{error}</p>
        </div>
      )}

      {/* Example molecules */}
      <div>
        <p className="mb-2 font-mono text-xs text-text-muted">
          Common molecules — click to use:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SMILES_EXAMPLES.map((mol) => (
            <button
              key={mol.smiles}
              type="button"
              onClick={() => handleExampleClick(mol)}
              disabled={isConverting}
              title={`SMILES: ${mol.smiles}${mol.detail ? ` — ${mol.detail}` : ""}`}
              className="min-h-11 rounded-md border border-border-subtle bg-bg-surface px-3 py-1 font-mono text-xs text-text-secondary transition-colors hover:border-accent-primary/50 hover:text-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary disabled:opacity-50"
            >
              <span>{mol.name}</span>
              <span className="ml-1 text-text-muted">{mol.formula}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          L-alanine, β-D-glucopyranose and (S)-ibuprofen are written with every stereocentre fixed, so
          the 3D structure is the isomer named. A SMILES you type keeps only the stereochemistry you write.
        </p>
      </div>
    </div>
  );
}
