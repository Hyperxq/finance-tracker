import { describe, expect, it, vi } from "vitest";
import { createGoogleVisionRecognizer } from "./google-vision-ocr";

describe("createGoogleVisionRecognizer", () => {
  it("sends the receipt to the authenticated Edge Function", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { text: "PAKNSAVE\nBREAD $3.89\nTOTAL $3.89", confidence: 94 },
      error: null,
    });
    const progress = vi.fn();
    const file = new File(["receipt"], "receipt.png", { type: "image/png" });

    await expect(createGoogleVisionRecognizer(invoke)(file, progress)).resolves.toEqual({
      text: "PAKNSAVE\nBREAD $3.89\nTOTAL $3.89",
      confidence: 94,
    });

    expect(invoke).toHaveBeenCalledOnce();
    const [functionName, options] = invoke.mock.calls[0];
    expect(functionName).toBe("receipt-ocr");
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get("receipt")).toBe(file);
    expect(progress).toHaveBeenCalledWith({ label: "Reading with Google Vision", progress: 40 });
    expect(progress).toHaveBeenLastCalledWith({ label: "Structuring items", progress: 100 });
  });

  it("does not expose provider errors to the receipt screen", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: new Error("Function returned 500") });
    const file = new File(["receipt"], "receipt.png", { type: "image/png" });

    await expect(createGoogleVisionRecognizer(invoke)(file)).rejects.toThrow(
      "Cloud OCR is temporarily unavailable.",
    );
  });

  it("rejects malformed successful responses", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { confidence: 80 }, error: null });
    const file = new File(["receipt"], "receipt.png", { type: "image/png" });

    await expect(createGoogleVisionRecognizer(invoke)(file)).rejects.toThrow(
      "Cloud OCR returned an invalid response.",
    );
  });
});
