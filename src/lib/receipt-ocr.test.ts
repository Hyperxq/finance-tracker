import { describe, expect, it, vi } from "vitest";

const ocrRuntime = vi.hoisted(() => ({ loaded: false }));

vi.mock("tesseract.js", () => {
  ocrRuntime.loaded = true;
  return { createWorker: vi.fn() };
});

import { calculateReceiptScale, receiptOcrScore, shouldEnhanceReceipt } from "./receipt-ocr";

describe("OCR runtime", () => {
  it("loads with the receipt module instead of waiting for a photo upload", () => {
    expect(ocrRuntime.loaded).toBe(true);
  });
});

describe("calculateReceiptScale", () => {
  it("upscales a small receipt without exceeding four times its source size", () => {
    expect(calculateReceiptScale(267, 408)).toBe(4);
  });

  it("caps a long narrow receipt at the maximum processing height", () => {
    expect(calculateReceiptScale(313, 1435)).toBeCloseTo(2400 / 1435);
  });

  it("downscales a large phone photo to the processing bounds", () => {
    expect(calculateReceiptScale(3024, 4032)).toBeCloseTo(1800 / 3024);
  });
});

describe("shouldEnhanceReceipt", () => {
  it("retries low-confidence OCR with image enhancement", () => {
    expect(shouldEnhanceReceipt(38)).toBe(true);
  });

  it("keeps a clear original scan instead of degrading it", () => {
    expect(shouldEnhanceReceipt(75)).toBe(false);
  });

  it("retries high-confidence text when required receipt structure is missing", () => {
    expect(shouldEnhanceReceipt(79, "PAKNSAVE\nBREAD $3.89")).toBe(true);
  });

  it("retries high-confidence text when extracted items do not reconcile", () => {
    expect(shouldEnhanceReceipt(79, "PAKNSAVE\nBREAD $3.89\nTOTAL $4.89")).toBe(true);
  });
});

describe("receiptOcrScore", () => {
  it("prefers itemized text with a printed total over higher-confidence incomplete text", () => {
    const incomplete = receiptOcrScore("PAKNSAVE\nBREAD $3.89", 90);
    const complete = receiptOcrScore("PAKNSAVE\nBREAD $3.89\nTOTAL $3.89", 70);

    expect(complete).toBeGreaterThan(incomplete);
  });

  it("prefers a reconciled scan over a higher-confidence mismatch", () => {
    const mismatched = receiptOcrScore("PAKNSAVE\nBREAD $3.89\nTOTAL $4.89", 90);
    const reconciled = receiptOcrScore("PAKNSAVE\nBREAD $3.89\nTOTAL $3.89", 70);

    expect(reconciled).toBeGreaterThan(mismatched);
  });
});
