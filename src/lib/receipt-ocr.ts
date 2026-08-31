import { createWorker, PSM } from "tesseract.js";
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

type PixelImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type ReceiptBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const fullBounds = (width: number, height: number): ReceiptBounds => ({ x: 0, y: 0, width, height });

export function detectReceiptBounds({ data, width, height }: PixelImage): ReceiptBounds {
  const rowCounts = new Uint32Array(height);
  const columnCounts = new Uint32Array(width);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const gray = red * 0.299 + green * 0.587 + blue * 0.114;
      const colorSpread = Math.max(red, green, blue) - Math.min(red, green, blue);
      if (gray < 175 || colorSpread > 58) continue;
      rowCounts[y] += 1;
      columnCounts[x] += 1;
    }
  }

  const activeRows = [...rowCounts]
    .map((count, index) => ({ count, index }))
    .filter(({ count }) => count >= Math.max(1, width * 0.25));
  const activeColumns = [...columnCounts]
    .map((count, index) => ({ count, index }))
    .filter(({ count }) => count >= Math.max(1, height * 0.4));
  if (activeRows.length === 0 || activeColumns.length === 0) return fullBounds(width, height);

  const x = activeColumns[0].index;
  const detectedY = activeRows[0].index;
  const detectedWidth = activeColumns.at(-1)!.index - x + 1;
  const detectedHeight = activeRows.at(-1)!.index - detectedY + 1;
  if (detectedWidth < width * 0.25 || detectedHeight < height * 0.5) return fullBounds(width, height);

  return detectedHeight < height * 0.8
    ? { x, y: 0, width: detectedWidth, height }
    : { x, y: detectedY, width: detectedWidth, height: detectedHeight };
}

export function adaptiveThresholdPixels(
  { data, width, height }: PixelImage,
  radius = 18,
  bias = 12,
) {
  const integralWidth = width + 1;
  const integral = new Float64Array(integralWidth * (height + 1));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const dataIndex = pixelIndex * 4;
      const gray = data[dataIndex] * 0.299 + data[dataIndex + 1] * 0.587 + data[dataIndex + 2] * 0.114;
      const integralIndex = (y + 1) * integralWidth + x + 1;
      integral[integralIndex] = gray
        + integral[integralIndex - 1]
        + integral[integralIndex - integralWidth]
        - integral[integralIndex - integralWidth - 1];
    }
  }

  const output = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const sum = integral[(bottom + 1) * integralWidth + right + 1]
        - integral[top * integralWidth + right + 1]
        - integral[(bottom + 1) * integralWidth + left]
        + integral[top * integralWidth + left];
      const mean = sum / ((right - left + 1) * (bottom - top + 1));
      const outputIndex = (y * width + x) * 4;
      const gray = data[outputIndex] * 0.299 + data[outputIndex + 1] * 0.587 + data[outputIndex + 2] * 0.114;
      const value = gray < mean - bias ? 0 : 255;
      output[outputIndex] = value;
      output[outputIndex + 1] = value;
      output[outputIndex + 2] = value;
      output[outputIndex + 3] = 255;
    }
  }

  return output;
}

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

function expandReceiptBounds(bounds: ReceiptBounds, width: number, height: number) {
  const horizontalMargin = Math.round(bounds.width * 0.025);
  const verticalMargin = Math.round(bounds.height * 0.015);
  const x = Math.max(0, bounds.x - horizontalMargin);
  const y = Math.max(0, bounds.y - verticalMargin);
  const right = Math.min(width, bounds.x + bounds.width + horizontalMargin);
  const bottom = Math.min(height, bounds.y + bounds.height + verticalMargin);
  return { x, y, width: right - x, height: bottom - y };
}

async function prepareReceiptVariants(file: File) {
  const bitmap = await createImageBitmap(file);
  const analysisScale = Math.min(1, 1200 / bitmap.width, 1600 / bitmap.height);
  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = Math.max(1, Math.round(bitmap.width * analysisScale));
  analysisCanvas.height = Math.max(1, Math.round(bitmap.height * analysisScale));
  const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
  if (!analysisContext) throw new Error("Canvas is unavailable in this browser.");
  analysisContext.drawImage(bitmap, 0, 0, analysisCanvas.width, analysisCanvas.height);
  const detected = expandReceiptBounds(
    detectReceiptBounds(analysisContext.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height)),
    analysisCanvas.width,
    analysisCanvas.height,
  );
  const sourceX = Math.floor(detected.x / analysisScale);
  const sourceY = Math.floor(detected.y / analysisScale);
  const sourceWidth = Math.min(bitmap.width - sourceX, Math.ceil(detected.width / analysisScale));
  const sourceHeight = Math.min(bitmap.height - sourceY, Math.ceil(detected.height / analysisScale));
  const scale = calculateReceiptScale(sourceWidth, sourceHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable in this browser.");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
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

  const thresholdCanvas = document.createElement("canvas");
  thresholdCanvas.width = canvas.width;
  thresholdCanvas.height = canvas.height;
  const thresholdContext = thresholdCanvas.getContext("2d");
  if (!thresholdContext) throw new Error("Canvas is unavailable in this browser.");
  const thresholdImage = thresholdContext.createImageData(canvas.width, canvas.height);
  thresholdImage.data.set(adaptiveThresholdPixels(image));
  thresholdContext.putImageData(thresholdImage, 0, 0);

  return [canvas.toDataURL("image/png"), thresholdCanvas.toDataURL("image/png")];
}

export const recognizeReceipt: RecognizeReceipt = async (file, onProgress) => {
  onProgress?.({ label: "Reading original", progress: 8 });
  let passLabel = "Reading receipt";
  let passStart = 12;
  let passRange = 30;
  const worker = await createWorker("eng", undefined, {
    logger: (message) => {
      if (message.status !== "recognizing text") return;
      onProgress?.({
        label: passLabel,
        progress: Math.round(passStart + message.progress * passRange),
      });
    },
  });

  try {
    const original = await worker.recognize(file);
    let result = original;

    if (shouldEnhanceReceipt(original.data.confidence, original.data.text)) {
      onProgress?.({ label: "Finding receipt edges", progress: 44 });
      const preparedImages = await prepareReceiptVariants(file);
      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        user_defined_dpi: "300",
      });

      for (const [index, preparedImage] of preparedImages.entries()) {
        passLabel = index === 0 ? "Enhancing difficult text" : "Recovering uneven lighting";
        passStart = index === 0 ? 48 : 73;
        passRange = 22;
        const enhanced = await worker.recognize(preparedImage);
        if (receiptOcrScore(enhanced.data.text, enhanced.data.confidence)
          > receiptOcrScore(result.data.text, result.data.confidence)) result = enhanced;
        if (parseReceiptText(result.data.text).matched) break;
      }
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
