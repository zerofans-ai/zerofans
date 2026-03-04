const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_MAX_HEIGHT = 1600;
const DEFAULT_QUALITY = 0.82;
const DEFAULT_MAX_BYTES = 1_500_000;

export interface CompressImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  maxBytes?: number;
  mimeType?: "image/webp" | "image/jpeg";
}

export interface CompressedImageResult {
  file: File;
  originalBytes: number;
  compressedBytes: number;
  width: number;
  height: number;
  mimeType: string;
  compressionRatio: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height };
  }

  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "bin";
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);

  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not decode selected image"));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Image encoding failed"));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

function buildQualitySteps(baseQuality: number): number[] {
  const steps = [baseQuality, baseQuality - 0.08, baseQuality - 0.16, baseQuality - 0.24];
  return Array.from(new Set(steps.map((value) => clamp(value, 0.55, 0.92))));
}

export async function compressImageForUpload(
  file: File,
  options: CompressImageOptions = {},
): Promise<CompressedImageResult> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Selected file is not an image");
  }

  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const preferredMimeType = options.mimeType ?? "image/webp";
  const baseQuality = clamp(options.quality ?? DEFAULT_QUALITY, 0.55, 0.92);
  const qualitySteps = buildQualitySteps(baseQuality);

  const image = await loadImage(file);
  const initialSize = fitWithin(image.width, image.height, maxWidth, maxHeight);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Could not create canvas context for compression");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  let workingWidth = initialSize.width;
  let workingHeight = initialSize.height;
  let bestBlob: Blob | null = null;
  let bestWidth = workingWidth;
  let bestHeight = workingHeight;
  let bestMimeType = preferredMimeType;

  for (let resizePass = 0; resizePass < 4; resizePass += 1) {
    canvas.width = workingWidth;
    canvas.height = workingHeight;
    ctx.clearRect(0, 0, workingWidth, workingHeight);
    ctx.drawImage(image, 0, 0, workingWidth, workingHeight);

    for (const quality of qualitySteps) {
      let encoded: Blob | null = null;
      try {
        encoded = await canvasToBlob(canvas, preferredMimeType, quality);
      } catch {
        encoded = null;
      }

      if (!encoded) {
        encoded = await canvasToBlob(canvas, "image/jpeg", quality);
      }

      if (!bestBlob || encoded.size < bestBlob.size) {
        bestBlob = encoded;
        bestWidth = workingWidth;
        bestHeight = workingHeight;
        bestMimeType =
          encoded.type && (encoded.type === "image/webp" || encoded.type === "image/jpeg")
            ? encoded.type
            : preferredMimeType;
      }

      if (encoded.size <= maxBytes) {
        break;
      }
    }

    if (bestBlob && bestBlob.size <= maxBytes) {
      break;
    }

    if (workingWidth <= 720 || workingHeight <= 720) {
      break;
    }

    workingWidth = Math.max(720, Math.round(workingWidth * 0.85));
    workingHeight = Math.max(720, Math.round(workingHeight * 0.85));
  }

  if (!bestBlob) {
    throw new Error("Image compression failed");
  }

  if (bestBlob.size >= file.size && file.size <= maxBytes) {
    return {
      file,
      originalBytes: file.size,
      compressedBytes: file.size,
      width: image.width,
      height: image.height,
      mimeType: file.type,
      compressionRatio: 1,
    };
  }

  const outputName = `${fileBaseName(file.name)}.${extensionForMime(bestMimeType)}`;
  const optimizedFile = new File([bestBlob], outputName, {
    type: bestMimeType,
    lastModified: Date.now(),
  });

  return {
    file: optimizedFile,
    originalBytes: file.size,
    compressedBytes: optimizedFile.size,
    width: bestWidth,
    height: bestHeight,
    mimeType: optimizedFile.type,
    compressionRatio: optimizedFile.size / file.size,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
