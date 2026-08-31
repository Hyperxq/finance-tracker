import { recognizeReceiptWithGoogleVision } from "./google-vision-ocr";
import {
  receiptOcrScore,
  recognizeReceipt,
  shouldEnhanceReceipt,
  type OcrProgress,
  type RecognizeReceipt,
} from "./receipt-ocr";

export type ReceiptOcrProvider = "local" | "google" | "local-first" | "google-first";

export type ReceiptRecognizers = {
  local: RecognizeReceipt;
  google: RecognizeReceipt;
};

export function resolveReceiptOcrProvider(value: unknown): ReceiptOcrProvider {
  return value === "local" || value === "google" || value === "local-first" || value === "google-first"
    ? value
    : "google-first";
}

export function createReceiptRecognizer(
  provider: ReceiptOcrProvider,
  recognizers: ReceiptRecognizers,
  onGoogleFallback?: () => void,
): RecognizeReceipt {
  if (provider === "local") return recognizers.local;
  if (provider === "google") return recognizers.google;

  if (provider === "google-first") {
    return async (file, onProgress) => {
      const googleProgress = onProgress
        ? (update: OcrProgress) => onProgress({
          ...update,
          progress: Math.round(update.progress * 0.6),
        })
        : undefined;
      const localProgress = onProgress
        ? (update: OcrProgress) => onProgress({
          ...update,
          progress: Math.round(60 + update.progress * 0.4),
        })
        : undefined;

      try {
        return await recognizers.google(file, googleProgress);
      } catch {
        onGoogleFallback?.();
        return recognizers.local(file, localProgress);
      }
    };
  }

  return async (file, onProgress) => {
    const localProgress = onProgress
      ? (update: OcrProgress) => onProgress({
        ...update,
        progress: Math.round(update.progress * 0.6),
      })
      : undefined;
    const googleProgress = onProgress
      ? (update: OcrProgress) => onProgress({
        ...update,
        progress: Math.round(60 + update.progress * 0.4),
      })
      : undefined;
    let localResult;
    try {
      localResult = await recognizers.local(file, localProgress);
    } catch {
      return recognizers.google(file, googleProgress);
    }
    if (!shouldEnhanceReceipt(localResult.confidence, localResult.text)) return localResult;

    try {
      const googleResult = await recognizers.google(file, googleProgress);
      return receiptOcrScore(googleResult.text, googleResult.confidence)
        > receiptOcrScore(localResult.text, localResult.confidence)
        ? googleResult
        : localResult;
    } catch {
      return localResult;
    }
  };
}

export const configuredReceiptOcrProvider = resolveReceiptOcrProvider(
  import.meta.env.PUBLIC_RECEIPT_OCR_PROVIDER,
);

export const defaultReceiptRecognizers: ReceiptRecognizers = {
  local: recognizeReceipt,
  google: recognizeReceiptWithGoogleVision,
};
