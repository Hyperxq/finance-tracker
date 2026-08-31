type FetchGoogle = (url: string, init: RequestInit) => Promise<Response>;

type ReceiptOcrDependencies = {
  authorize: (request: Request) => Promise<boolean>;
  fetchGoogle: FetchGoogle;
  visionApiKey: string;
};

type GoogleWord = { confidence?: number };
type GoogleAnnotation = {
  text?: string;
  pages?: Array<{
    blocks?: Array<{
      paragraphs?: Array<{ words?: GoogleWord[] }>;
    }>;
  }>;
};

const maxInlineImageBytes = 7_000_000;
const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const responseHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function annotationConfidence(annotation: GoogleAnnotation) {
  const confidences = annotation.pages?.flatMap((page) => (
    page.blocks?.flatMap((block) => (
      block.paragraphs?.flatMap((paragraph) => (
        paragraph.words?.flatMap((word) => word.confidence ?? []) ?? []
      )) ?? []
    )) ?? []
  )) ?? [];
  if (confidences.length === 0) return 0;
  return Math.round(confidences.reduce((total, confidence) => total + confidence, 0) * 100 / confidences.length);
}

function isReceiptFile(value: unknown): value is File {
  return typeof value === "object"
    && value !== null
    && "arrayBuffer" in value
    && typeof value.arrayBuffer === "function"
    && "size" in value
    && typeof value.size === "number"
    && "type" in value
    && typeof value.type === "string";
}

export function createReceiptOcrHandler({ authorize, fetchGoogle, visionApiKey }: ReceiptOcrDependencies) {
  return async (request: Request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (!await authorize(request)) return json({ error: "Authentication required." }, 401);
    if (!visionApiKey) return json({ error: "Cloud OCR is not configured." }, 503);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "A receipt image is required." }, 400);
    }
    const receipt = form.get("receipt");
    if (!isReceiptFile(receipt)) return json({ error: "A receipt image is required." }, 400);
    if (!supportedImageTypes.has(receipt.type)) return json({ error: "Unsupported receipt image." }, 415);
    if (receipt.size > maxInlineImageBytes) return json({ error: "Receipt image is too large." }, 413);

    let googleResponse: Response;
    try {
      googleResponse = await fetchGoogle(
        `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(visionApiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [{
              image: { content: base64(new Uint8Array(await receipt.arrayBuffer())) },
              features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            }],
          }),
        },
      );
    } catch {
      return json({ error: "Cloud OCR could not read this receipt." }, 502);
    }
    if (!googleResponse.ok) return json({ error: "Cloud OCR could not read this receipt." }, 502);

    let result: { responses?: Array<{ error?: unknown; fullTextAnnotation?: GoogleAnnotation }> };
    try {
      result = await googleResponse.json() as typeof result;
    } catch {
      return json({ error: "Cloud OCR could not read this receipt." }, 502);
    }
    const visionResult = result.responses?.[0];
    const annotation = visionResult?.fullTextAnnotation;
    if (visionResult?.error || !annotation?.text?.trim()) {
      return json({ error: "Cloud OCR could not read this receipt." }, 422);
    }

    return json({
      text: annotation.text,
      confidence: annotationConfidence(annotation),
    });
  };
}
