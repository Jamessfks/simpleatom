import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WCAG AA: unselected tab labels sit on the segment background (bg-secondary)
// and must reach 4.5:1. `text-foreground/60` came to about 4.0:1 there.
const css = readFileSync("app/globals.css", "utf8");
const tabs = readFileSync("components/ui/tabs.tsx", "utf8");

function token(name: string): string {
  const light = css.slice(css.indexOf(":root"));
  const m = light.match(new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`no --color-${name}`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("unselected tab labels (WCAG AA)", () => {
  it("use a solid text token, not a faded foreground", () => {
    expect(tabs).not.toMatch(/\btext-foreground\/\d+/);
    expect(tabs).toMatch(/\btext-text-secondary\b/);
  });

  it("reach 4.5:1 on the segment background", () => {
    expect(contrast(token("text-secondary"), token("bg-secondary"))).toBeGreaterThanOrEqual(4.5);
  });
});
