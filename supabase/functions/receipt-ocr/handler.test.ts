import { describe, expect, it, vi } from "vitest";
import { createReceiptOcrHandler } from "./handler";

function receiptRequest(file?: File) {
  const body = new FormData();
  if (file) body.set("receipt", file);
  return new Request("https://example.test/functions/v1/receipt-ocr", {
    method: "POST",
    headers: { Authorization: "Bearer user-token" },
    body,
  });
}

describe("receipt OCR Edge Function", () => {
  it("rejects unauthenticated callers before sending an image to Google", async () => {
    const fetchGoogle = vi.fn();
    const handler = createReceiptOcrHandler({
      authorize: vi.fn().mockResolvedValue(false),
      fetchGoogle,
      visionApiKey: "vision-key",
    });

    const response = await handler(receiptRequest(new File(["receipt"], "receipt.png", { type: "image/png" })));

    expect(response.status).toBe(401);
    expect(fetchGoogle).not.toHaveBeenCalled();
  });

  it("requires a supported receipt image", async () => {
    const handler = createReceiptOcrHandler({
      authorize: vi.fn().mockResolvedValue(true),
      fetchGoogle: vi.fn(),
      visionApiKey: "vision-key",
    });

    const missing = await handler(receiptRequest());
    const unsupported = await handler(receiptRequest(new File(["receipt"], "receipt.txt", { type: "text/plain" })));

    expect(missing.status).toBe(400);
    expect(unsupported.status).toBe(415);
  });

  it("rejects images that cannot fit in a synchronous Vision request", async () => {
    const fetchGoogle = vi.fn();
    const handler = createReceiptOcrHandler({
      authorize: vi.fn().mockResolvedValue(true),
      fetchGoogle,
      visionApiKey: "vision-key",
    });

    const receipt = {
      arrayBuffer: async () => new ArrayBuffer(7_000_001),
      size: 7_000_001,
      type: "image/png",
    };
    const response = await handler({
      method: "POST",
      formData: async () => ({ get: () => receipt }) as unknown as FormData,
    } as Request);

    expect(response.status).toBe(413);
    expect(fetchGoogle).not.toHaveBeenCalled();
  });

  it("requests document OCR and normalizes word confidence", async () => {
    const fetchGoogle = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      responses: [{
        fullTextAnnotation: {
          text: "PAKNSAVE\nBREAD $3.89\nTOTAL $3.89",
          pages: [{
            blocks: [{
              paragraphs: [{ words: [{ confidence: 0.9 }, { confidence: 0.8 }] }],
            }],
          }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const handler = createReceiptOcrHandler({
      authorize: vi.fn().mockResolvedValue(true),
      fetchGoogle,
      visionApiKey: "vision-key",
    });

    const response = await handler(receiptRequest(new File(["receipt"], "receipt.png", { type: "image/png" })));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      text: "PAKNSAVE\nBREAD $3.89\nTOTAL $3.89",
      confidence: 85,
    });
    expect(fetchGoogle).toHaveBeenCalledOnce();
    const [url, request] = fetchGoogle.mock.calls[0];
    expect(url).toBe("https://vision.googleapis.com/v1/images:annotate?key=vision-key");
    expect(JSON.parse(request.body)).toMatchObject({
      requests: [{ features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }],
    });
  });

  it("returns a stable error when Google rejects the request", async () => {
    const handler = createReceiptOcrHandler({
      authorize: vi.fn().mockResolvedValue(true),
      fetchGoogle: vi.fn().mockResolvedValue(new Response("quota exceeded", { status: 429 })),
      visionApiKey: "vision-key",
    });

    const response = await handler(receiptRequest(new File(["receipt"], "receipt.png", { type: "image/png" })));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Cloud OCR could not read this receipt." });
  });

  it("contains network and malformed-response failures", async () => {
    const image = new File(["receipt"], "receipt.png", { type: "image/png" });
    const dependencies = {
      authorize: vi.fn().mockResolvedValue(true),
      visionApiKey: "vision-key",
    };
    const networkFailure = createReceiptOcrHandler({
      ...dependencies,
      fetchGoogle: vi.fn().mockRejectedValue(new Error("request included a sensitive URL")),
    });
    const malformedResponse = createReceiptOcrHandler({
      ...dependencies,
      fetchGoogle: vi.fn().mockResolvedValue(new Response("not JSON", { status: 200 })),
    });

    const networkResponse = await networkFailure(receiptRequest(image));
    const malformed = await malformedResponse(receiptRequest(image));

    expect(networkResponse.status).toBe(502);
    expect(malformed.status).toBe(502);
    await expect(networkResponse.json()).resolves.toEqual({ error: "Cloud OCR could not read this receipt." });
    await expect(malformed.json()).resolves.toEqual({ error: "Cloud OCR could not read this receipt." });
  });
});
