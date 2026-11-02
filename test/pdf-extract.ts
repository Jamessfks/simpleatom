import { inflateSync } from "node:zlib";

/**
 * The text a PDF built by @react-pdf/renderer would show, read back from the
 * file: inflate every content stream, join each TJ array's hex strings, and
 * decode the bytes as Windows-1252, which is the encoding Helvetica's standard
 * font uses. Lines come back newline-separated. A character the font cannot draw
 * is not recovered, it shows up as the wrong glyph, exactly as in a viewer.
 */
export function pdfTextOf(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const decoder = new TextDecoder("windows-1252");
  const lines: string[] = [];
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m = streams.exec(raw); m; m = streams.exec(raw)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      continue; // not a Flate stream (an image or a font program)
    }
    const arrays = /\[((?:<[0-9a-fA-F]*>|[-\d.\s])*)\]\s*TJ/g;
    for (let t = arrays.exec(content); t; t = arrays.exec(content)) {
      const hex = [...t[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]).join("");
      const bytes = new Uint8Array(Math.floor(hex.length / 2));
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      lines.push(decoder.decode(bytes));
    }
  }
  return lines.join("\n");
}

/** The same text with every run of whitespace removed, for matching across line wraps. */
export const squash = (s: string): string => s.replace(/\s+/g, "");
