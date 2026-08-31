import { describe, expect, it, vi } from "vitest";
import type { OcrResult, RecognizeReceipt } from "./receipt-ocr";
import { createReceiptRecognizer, resolveReceiptOcrProvider } from "./receipt-ocr-strategy";

const file = new File(["receipt"], "receipt.png", { type: "image/png" });
const reconciled: OcrResult = {
  text: "PAKNSAVE\nBREAD $3.89\nTOTAL $3.89",
  confidence: 72,
};
const incomplete: OcrResult = {
  text: "PAKNSAVE\nBREAD $3.89",
  confidence: 90,
};

function recognizer(result: OcrResult): RecognizeReceipt {
  return vi.fn().mockResolvedValue(result);
}

describe("resolveReceiptOcrProvider", () => {
  it.each(["local", "google", "local-first", "google-first"] as const)("accepts %s", (provider) => {
    expect(resolveReceiptOcrProvider(provider)).toBe(provider);
  });

  it("defaults to Google with a local fallback", () => {
    expect(resolveReceiptOcrProvider(undefined)).toBe("google-first");
    expect(resolveReceiptOcrProvider("unknown")).toBe("google-first");
  });
});

describe("createReceiptRecognizer", () => {
  it("selects either provider directly", async () => {
    const local = recognizer(reconciled);
    const google = recognizer(incomplete);

    await expect(createReceiptRecognizer("local", { local, google })(file)).resolves.toBe(reconciled);
    await expect(createReceiptRecognizer("google", { local, google })(file)).resolves.toBe(incomplete);
  });

  it("keeps a complete local result without uploading the receipt", async () => {
    const local = recognizer(reconciled);
    const google = recognizer(incomplete);

    await expect(createReceiptRecognizer("local-first", { local, google })(file)).resolves.toBe(reconciled);

    expect(google).not.toHaveBeenCalled();
  });

  it("uses Google when it produces a more useful receipt", async () => {
    const local = recognizer(incomplete);
    const google = recognizer(reconciled);

    await expect(createReceiptRecognizer("local-first", { local, google })(file)).resolves.toBe(reconciled);

    expect(google).toHaveBeenCalledWith(file, undefined);
  });

  it("retains the local result when the cloud fallback is unavailable", async () => {
    const local = recognizer(incomplete);
    const google = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(createReceiptRecognizer("local-first", { local, google })(file)).resolves.toBe(incomplete);
  });

  it("uses Google when local OCR cannot read the image", async () => {
    const local = vi.fn().mockRejectedValue(new Error("local OCR failed"));
    const google = recognizer(reconciled);

    await expect(createReceiptRecognizer("local-first", { local, google })(file)).resolves.toBe(reconciled);
  });

  it("keeps fallback progress moving forward", async () => {
    const local: RecognizeReceipt = async (_file, onProgress) => {
      onProgress?.({ label: "Local OCR", progress: 100 });
      return incomplete;
    };
    const google: RecognizeReceipt = async (_file, onProgress) => {
      onProgress?.({ label: "Cloud OCR", progress: 15 });
      onProgress?.({ label: "Cloud OCR", progress: 100 });
      return reconciled;
    };
    const progress = vi.fn();

    await createReceiptRecognizer("local-first", { local, google })(file, progress);

    expect(progress.mock.calls.map(([update]) => update.progress)).toEqual([60, 66, 100]);
  });

  it("uses Google first without starting local OCR when cloud OCR succeeds", async () => {
    const local = recognizer(incomplete);
    const google = recognizer(reconciled);

    await expect(createReceiptRecognizer("google-first", { local, google })(file)).resolves.toBe(reconciled);

    expect(local).not.toHaveBeenCalled();
  });

  it("falls back to local OCR when Google rejects the request", async () => {
    const local = recognizer(reconciled);
    const google = vi.fn().mockRejectedValue(new Error("billing disabled"));
    const onGoogleFallback = vi.fn();

    await expect(createReceiptRecognizer(
      "google-first",
      { local, google },
      onGoogleFallback,
    )(file)).resolves.toBe(reconciled);

    expect(local).toHaveBeenCalledWith(file, undefined);
    expect(onGoogleFallback).toHaveBeenCalledOnce();
  });

  it("keeps Google-first fallback progress moving forward", async () => {
    const google: RecognizeReceipt = async (_file, onProgress) => {
      onProgress?.({ label: "Cloud OCR", progress: 40 });
      throw new Error("quota exceeded");
    };
    const local: RecognizeReceipt = async (_file, onProgress) => {
      onProgress?.({ label: "Local OCR", progress: 8 });
      onProgress?.({ label: "Local OCR", progress: 100 });
      return reconciled;
    };
    const progress = vi.fn();

    await createReceiptRecognizer("google-first", { local, google })(file, progress);

    expect(progress.mock.calls.map(([update]) => update.progress)).toEqual([24, 63, 100]);
  });
});
