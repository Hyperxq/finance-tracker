import { getSupabaseClient } from "./supabase";
import type { OcrResult, RecognizeReceipt } from "./receipt-ocr";

type FunctionResult = {
  data: unknown;
  error: unknown;
};

type InvokeFunction = (
  name: string,
  options: { body: FormData },
) => Promise<FunctionResult>;

const cloudImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxCloudImageBytes = 7_000_000;

function cloudResponse(data: unknown): OcrResult | undefined {
  if (!data || typeof data !== "object") return undefined;
  const { text, confidence } = data as Record<string, unknown>;
  if (typeof text !== "string" || typeof confidence !== "number") return undefined;
  return { text, confidence };
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("The receipt photo could not be prepared.")),
      "image/jpeg",
      quality,
    );
  });
}

async function prepareCloudReceipt(file: File) {
  if (cloudImageTypes.has(file.type) && file.size <= maxCloudImageBytes) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / bitmap.width, 2400 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("The receipt photo could not be prepared.");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let blob = await canvasBlob(canvas, 0.9);
  if (blob.size > maxCloudImageBytes) blob = await canvasBlob(canvas, 0.72);
  if (blob.size > maxCloudImageBytes) throw new Error("The receipt photo is too large for cloud OCR.");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "receipt"}.jpg`, { type: "image/jpeg" });
}

async function recognizeWithGoogleVision(
  invoke: InvokeFunction,
  file: File,
  onProgress?: Parameters<RecognizeReceipt>[1],
) {
  onProgress?.({ label: "Preparing secure upload", progress: 15 });
  const prepared = await prepareCloudReceipt(file);
  const body = new FormData();
  body.set("receipt", prepared);
  onProgress?.({ label: "Reading with Google Vision", progress: 40 });

  const { data, error } = await invoke("receipt-ocr", { body });
  if (error) throw new Error("Cloud OCR is temporarily unavailable.");
  const result = cloudResponse(data);
  if (!result) throw new Error("Cloud OCR returned an invalid response.");

  onProgress?.({ label: "Structuring items", progress: 100 });
  return result;
}

export function createGoogleVisionRecognizer(invoke: InvokeFunction): RecognizeReceipt {
  return (file, onProgress) => recognizeWithGoogleVision(invoke, file, onProgress);
}

export const recognizeReceiptWithGoogleVision: RecognizeReceipt = (file, onProgress) => (
  recognizeWithGoogleVision(
    (name, options) => getSupabaseClient().functions.invoke(name, options),
    file,
    onProgress,
  )
);
