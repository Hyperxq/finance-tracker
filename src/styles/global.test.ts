// @ts-expect-error Vitest runs in Node while the application excludes Node typings.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd: () => string };

const stylesheet = readFileSync(`${process.cwd()}/src/styles/global.css`, "utf8");

const colorToken = (name: string) => {
  const value = stylesheet.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  if (!value) throw new Error(`Missing color token ${name}`);
  return value;
};

const relativeLuminance = (hex: string) => {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  const [red, green, blue] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
};

const contrastRatio = (foreground: string, background: string) => {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

describe("Night Ledger accent palette", () => {
  it("keeps accent text and filled controls readable on their intended surfaces", () => {
    const canvas = colorToken("--canvas");
    const ink = colorToken("--ink");

    expect(contrastRatio(colorToken("--accent"), canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ink, colorToken("--accent-strong"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ink, colorToken("--accent-hover"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colorToken("--accent-soft"), colorToken("--accent-deep"))).toBeGreaterThanOrEqual(3);
  });
});

describe("Bank dashboard responsive containment", () => {
  it("allows cards and long merchant names to shrink within the viewport", () => {
    expect(stylesheet).toMatch(/\.chart-card,[^{]+\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
    expect(stylesheet).toMatch(/\.merchant-chart li strong\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s);
  });

  it("shares the small-spend chart width between every day", () => {
    expect(stylesheet).toMatch(/\.small-spend-pulse li\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 0;[^}]*width:\s*auto;/s);
  });
});
