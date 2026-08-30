import { createWorker } from "tesseract.js";
import { parseReceiptText } from "./receipt-parser";

export type OcrProgress = {
  label: string;
  progress: number;
};

export type OcrResult = {
  text: string;
  confidence: number;
};

export type RecognizeReceipt = (
  file: File,
  onProgress?: (progress: OcrProgress) => void,
) => Promise<OcrResult>;

export function calculateReceiptScale(width: number, height: number) {
  return Math.min(4, 1800 / width, 2400 / height);
}

export function receiptOcrScore(text: string, confidence: number) {
  const receipt = parseReceiptText(text);
  return (receipt.items.length > 0 ? 1000 : 0)
    + (receipt.receiptTotal > 0 ? 500 : 0)
    + (receipt.matched ? 250 : 0)
    + receipt.items.length * 10
    + confidence / 100;
}

export function shouldEnhanceReceipt(confidence: number, text = "") {
  if (confidence < 65) return true;
  if (!text) return false;
  const receipt = parseReceiptText(text);
  return receipt.items.length === 0 || receipt.receiptTotal === 0 || !receipt.matched;
}

async function enhanceReceipt(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = calculateReceiptScale(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable in this browser.");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const gray = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114;
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
    image.data[index] = contrasted;
    image.data[index + 1] = contrasted;
    image.data[index + 2] = contrasted;
  }
  context.putImageData(image, 0, 0);

  return canvas.toDataURL("image/png");
}

export const recognizeReceipt: RecognizeReceipt = async (file, onProgress) => {
  onProgress?.({ label: "Reading original", progress: 8 });
  let enhancedPass = false;
  const worker = await createWorker("eng", undefined, {
    logger: (message) => {
      if (message.status !== "recognizing text") return;
      onProgress?.({
        label: enhancedPass ? "Enhancing difficult text" : "Reading receipt",
        progress: Math.round((enhancedPass ? 55 : 12) + message.progress * 43),
      });
    },
  });

  try {
    const original = await worker.recognize(file);
    let result = original;

    if (shouldEnhanceReceipt(original.data.confidence, original.data.text)) {
      enhancedPass = true;
      const preparedImage = await enhanceReceipt(file);
      const enhanced = await worker.recognize(preparedImage);
      if (receiptOcrScore(enhanced.data.text, enhanced.data.confidence)
        > receiptOcrScore(original.data.text, original.data.confidence)) result = enhanced;
    }

    onProgress?.({ label: "Structuring items", progress: 100 });
    return {
      text: result.data.text,
      confidence: result.data.confidence,
    };
  } finally {
    await worker.terminate();
  }
};
