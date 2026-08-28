import { describe, expect, it } from "vitest";
import { calculateReceiptScale, shouldEnhanceReceipt } from "./receipt-ocr";

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
});
