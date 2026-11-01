import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WCAG AA: 4.5:1 for body text. The design critic measured the amber warning
// text (#946414) on its own tinted banner (#F0EBE0) at 4.32:1. The tint is the
// warning colour at 10-15 % over any of the four canvas tiers, so the token has
// to clear 4.5:1 on every one of those, not only on the page background.

const css = readFileSync("app/globals.css", "utf8");
const light = css.slice(css.indexOf(":root {"), css.indexOf(".dark {") > 0 ? css.indexOf(".dark {") : undefined);
const token = (name: string): string => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(light)![1];

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const blend = (fg: string, bg: string, alpha: number) =>
  "#" +
  rgb(fg)
    .map((c, i) => Math.round(alpha * c + (1 - alpha) * rgb(bg)[i]))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");

describe("amber warning text meets WCAG AA wherever it is drawn", () => {
  const warning = token("--color-warning");
  const tiers = ["--color-bg-primary", "--color-bg-secondary", "--color-bg-surface", "--color-bg-elevated"].map(token);

  it("on every canvas tier", () => {
    for (const bg of tiers) expect(contrast(warning, bg), `${warning} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("on its own 10 % and 15 % tint over every canvas tier", () => {
    for (const bg of tiers)
      for (const alpha of [0.1, 0.15]) {
        const tint = blend(warning, bg, alpha);
        expect(contrast(warning, tint), `${warning} on ${tint}`).toBeGreaterThanOrEqual(4.5);
      }
  });

  it("on the tinted banner the critic measured", () => {
    expect(contrast(warning, "#F0EBE0")).toBeGreaterThanOrEqual(4.5);
  });
});
