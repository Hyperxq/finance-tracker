import { describe, expect, it, vi } from "vitest";

const ocrRuntime = vi.hoisted(() => ({ loaded: false }));

vi.mock("tesseract.js", () => {
  ocrRuntime.loaded = true;
  return { createWorker: vi.fn() };
});

import {
  adaptiveThresholdPixels,
  calculateReceiptScale,
  detectReceiptBounds,
  receiptOcrScore,
  shouldEnhanceReceipt,
} from "./receipt-ocr";

function pixels(width: number, height: number, color: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = color[0];
    data[index + 1] = color[1];
    data[index + 2] = color[2];
    data[index + 3] = 255;
  }
  return data;
}

function paint(
  data: Uint8ClampedArray,
  width: number,
  bounds: { x: number; y: number; width: number; height: number },
  color: [number, number, number],
) {
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
    }
  }
}

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

describe("detectReceiptBounds", () => {
  it("finds a light receipt on a darker colored surface without following a finger", () => {
    const width = 24;
    const height = 20;
    const data = pixels(width, height, [150, 112, 82]);
    paint(data, width, { x: 7, y: 1, width: 10, height: 19 }, [235, 229, 218]);
    paint(data, width, { x: 18, y: 0, width: 5, height: 4 }, [232, 181, 176]);

    expect(detectReceiptBounds({ data, width, height })).toEqual({ x: 7, y: 1, width: 10, height: 19 });
  });

  it("keeps an already cropped receipt at full frame", () => {
    const width = 12;
    const height = 18;

    expect(detectReceiptBounds({ data: pixels(width, height, [242, 239, 232]), width, height }))
      .toEqual({ x: 0, y: 0, width, height });
  });

  it("keeps the full height when a shadow hides the lower receipt edge", () => {
    const width = 24;
    const height = 20;
    const data = pixels(width, height, [148, 108, 78]);
    paint(data, width, { x: 7, y: 1, width: 10, height: 11 }, [235, 229, 218]);
    paint(data, width, { x: 7, y: 12, width: 10, height: 8 }, [162, 154, 143]);

    expect(detectReceiptBounds({ data, width, height })).toEqual({ x: 7, y: 0, width: 10, height });
  });
});

describe("adaptiveThresholdPixels", () => {
  it("keeps text dark across uneven receipt lighting", () => {
    const width = 5;
    const height = 3;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const gray = 150 + x * 20;
        data[index] = gray;
        data[index + 1] = gray;
        data[index + 2] = gray;
        data[index + 3] = 255;
      }
    }
    paint(data, width, { x: 2, y: 1, width: 1, height: 1 }, [100, 100, 100]);

    const thresholded = adaptiveThresholdPixels({ data, width, height }, 1, 12);

    expect([...thresholded.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...thresholded.slice((width + 2) * 4, (width + 3) * 4)]).toEqual([0, 0, 0, 255]);
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
