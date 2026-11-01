import type { ParsedStructure } from "@/lib/parse-structure";

/** A parse that finished: for which file, and what came out (null when it failed). */
export interface ParseResult {
  file: File;
  structure: ParsedStructure | null;
}

/**
 * The structure to use for `file`, and whether it is still being read.
 *
 * A parse result belongs to the exact File object it was made from. Offering
 * the previous file's structure while a new one is read let a Run pressed in
 * that window pair the new upload with the old structure (D98). While `parsing`
 * the page offers none and blocks Run.
 */
export function parsedFor(
  file: File | undefined,
  parsed: ParseResult | null,
): { structure: ParsedStructure | null; parsing: boolean } {
  if (!file) return { structure: null, parsing: false };
  if (parsed && parsed.file === file) return { structure: parsed.structure, parsing: false };
  return { structure: null, parsing: true };
}
