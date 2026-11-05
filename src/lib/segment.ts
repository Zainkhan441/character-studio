/**
 * In-browser figure segmentation for the extraction wizard (M3).
 *
 * Primary path: BiRefNet-lite (MIT licence — weights + code) via
 * @huggingface/transformers 4.3.2, `background-removal` pipeline,
 * model id `onnx-community/BiRefNet_lite` (verified on the model
 * card 2026-11-05). The model (~98 MB) downloads once from the
 * Hugging Face Hub and is then cached by the browser (Cache API);
 * the image itself NEVER leaves the browser — segmentation runs
 * locally with onnxruntime-web (WASM/WebGPU).
 *
 * NEVER use RMBG-1.4 (CC BY-NC — non-commercial) or
 * @imgly/background-removal (AGPL-3.0) in this app.
 *
 * Fallback path: if the AI model cannot load (offline, blocked
 * network), a plain-background flood fill segments cartoons drawn
 * on a flat light background. It is honest about what it is — the
 * wizard labels it "simple mode".
 *
 * This module is browser-only (dynamic import, no top-level
 * transformers import) so the Next.js build never bundles the
 * ~100 MB ONNX runtime into the server bundle.
 */

export interface SegmentProgress {
  stage: "loading-model" | "segmenting" | "done";
  /** 0-100 while the model downloads; -1 when indeterminate. */
  percent: number;
  note: string;
}

export interface SegmentResult {
  /** 0-255 grayscale mask, row-major, length width*height. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** Downscaled original pixels (RGBA) at the mask resolution. */
  image: { data: Uint8ClampedArray; width: number; height: number };
  /** 'ai' = BiRefNet, 'simple' = flood-fill fallback. */
  method: "ai" | "simple";
}

export const BIREFNET_MODEL_ID = "onnx-community/BiRefNet_lite";
/** Longest side of the image sent to the model (speed + memory). */
export const MAX_SEGMENT_SIDE = 1024;

export class SegmentationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SegmentationError";
  }
}

/* ------------------------------------------------------------------ */
/* Image loading (browser)                                             */
/* ------------------------------------------------------------------ */

/**
 * Load a File/Blob into RGBA pixels, downscaled so the longest side
 * is at most MAX_SEGMENT_SIDE. Throws SegmentationError on bad input.
 */
export async function loadImagePixels(
  file: Blob,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new SegmentationError("That file could not be read as an image. Try a PNG or JPG.");
  });
  try {
    const scale = Math.min(1, MAX_SEGMENT_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new SegmentationError("Canvas is unavailable in this browser.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return { data: imageData.data, width, height };
  } finally {
    bitmap.close();
  }
}

/* ------------------------------------------------------------------ */
/* Simple fallback: flood fill from the borders                        */
/* ------------------------------------------------------------------ */

/**
 * Segment by flood-filling the background colour from the image
 * borders. Works for cartoons on a flat light background; useless
 * on photos or busy backgrounds (the wizard says so). Tolerance is
 * in RGB distance from the border colour.
 *
 * Pure function (no DOM) — unit-tested.
 */
export function simpleMaskFromBackground(
  image: { data: Uint8ClampedArray; width: number; height: number },
  tolerance = 48,
): Uint8Array {
  const { data, width, height } = image;
  const mask = new Uint8Array(width * height).fill(1); // 1 = figure
  const seen = new Uint8Array(width * height);
  // Background colour = median of the four corners.
  const corners = [0, (width - 1) * 4, (height - 1) * width * 4, ((height - 1) * width + width - 1) * 4];
  const cr: number[] = [];
  const cg: number[] = [];
  const cb: number[] = [];
  for (const i of corners) {
    cr.push(data[i]);
    cg.push(data[i + 1]);
    cb.push(data[i + 2]);
  }
  cr.sort((a, b) => a - b);
  cg.sort((a, b) => a - b);
  cb.sort((a, b) => a - b);
  const br = cr[1];
  const bg = cg[1];
  const bb = cb[1];
  const close = (x: number, y: number): boolean => {
    const i = (y * width + x) * 4;
    return (
      Math.abs(data[i] - br) <= tolerance &&
      Math.abs(data[i + 1] - bg) <= tolerance &&
      Math.abs(data[i + 2] - bb) <= tolerance
    );
  };
  const stack: Array<[number, number]> = [];
  for (let x = 0; x < width; x++) {
    stack.push([x, 0], [x, height - 1]);
  }
  for (let y = 0; y < height; y++) {
    stack.push([0, y], [width - 1, y]);
  }
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [number, number];
    const idx = y * width + x;
    if (seen[idx] === 1) continue;
    seen[idx] = 1;
    if (!close(x, y)) continue;
    mask[idx] = 0; // background
    if (x > 0) stack.push([x - 1, y]);
    if (x < width - 1) stack.push([x + 1, y]);
    if (y > 0) stack.push([x, y - 1]);
    if (y < height - 1) stack.push([x, y + 1]);
  }
  return mask;
}

/* ------------------------------------------------------------------ */
/* AI path (BiRefNet via transformers.js)                              */
/* ------------------------------------------------------------------ */

type BackgroundRemovalFn = (
  image: unknown,
) => Promise<{ data: Uint8ClampedArray; width: number; height: number; channels: number }>;

let cachedSegmenter: BackgroundRemovalFn | null = null;
let cachedSegmenterPromise: Promise<BackgroundRemovalFn> | null = null;

/**
 * Load the BiRefNet-lite pipeline once (module-level cache). The
 * dynamic import keeps transformers.js out of the server bundle.
 * Throws SegmentationError with a human-readable reason.
 */
export async function loadSegmenter(
  onProgress?: (p: SegmentProgress) => void,
): Promise<BackgroundRemovalFn> {
  if (cachedSegmenter) return cachedSegmenter;
  if (cachedSegmenterPromise) return cachedSegmenterPromise;
  cachedSegmenterPromise = (async () => {
    onProgress?.({ stage: "loading-model", percent: 0, note: "Loading the background-removal model (~98 MB, first time only)…" });
    let mod: typeof import("@huggingface/transformers");
    try {
      mod = await import("@huggingface/transformers");
    } catch {
      throw new SegmentationError(
        "The AI model library could not be loaded. Check your connection, or use simple mode instead.",
      );
    }
    // Never send the image anywhere: local models only, remote fetch
    // is only for the model weights themselves (first download).
    mod.env.allowLocalModels = false;
    try {
      const segmenter = await mod.pipeline("background-removal", BIREFNET_MODEL_ID, {
        progress_callback: (progress: { status: string; progress?: number; file?: string }) => {
          const pct =
            typeof progress.progress === "number" ? Math.round(progress.progress) : -1;
          onProgress?.({
            stage: "loading-model",
            percent: pct,
            note:
              progress.status === "downloading"
                ? `Downloading model… ${pct >= 0 ? `${pct}%` : ""}`
                : progress.status === "ready"
                  ? "Model ready."
                  : `Model: ${progress.status}`,
          });
        },
      });
      const fn = (async (image: Parameters<typeof segmenter>[0]) => segmenter(image)) as BackgroundRemovalFn;
      cachedSegmenter = fn;
      return fn;
    } catch (err) {
      cachedSegmenterPromise = null;
      if (err instanceof SegmentationError) throw err;
      throw new SegmentationError(
        "The AI model could not be downloaded (it needs internet the first time, ~98 MB). Simple mode still works for cartoons on a plain background.",
      );
    }
  })();
  return cachedSegmenterPromise;
}

/**
 * Segment with the AI model. `image` is the downscaled original
 * (from loadImagePixels). Returns a 0-255 mask (alpha channel of
 * the pipeline's RGBA output) at the same resolution.
 */
export async function segmentWithAI(
  image: { data: Uint8ClampedArray; width: number; height: number },
  onProgress?: (p: SegmentProgress) => void,
): Promise<SegmentResult> {
  const segmenter = await loadSegmenter(onProgress);
  onProgress?.({ stage: "segmenting", percent: -1, note: "Removing the background…" });
  let out: { data: Uint8ClampedArray; width: number; height: number; channels: number };
  try {
    // RawImage input: the pipeline accepts a canvas/ImageData-like
    // object; we pass the pixels via an offscreen canvas.
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new SegmentationError("Canvas is unavailable in this browser.");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    out = await segmenter(canvas);
  } catch (err) {
    if (err instanceof SegmentationError) throw err;
    throw new SegmentationError(
      `Segmentation failed (${err instanceof Error ? err.message : "unknown error"}). Try a clearer image, or use simple mode.`,
    );
  }
  if (out.width !== image.width || out.height !== image.height) {
    throw new SegmentationError("The model returned a mask at the wrong size — please retry.");
  }
  const mask = new Uint8Array(out.width * out.height);
  if (out.channels === 4) {
    for (let i = 0; i < mask.length; i++) mask[i] = out.data[i * 4 + 3];
  } else if (out.channels === 1) {
    mask.set(out.data);
  } else {
    // RGB output: use luminance as a rough alpha.
    for (let i = 0; i < mask.length; i++) {
      mask[i] = Math.round(0.299 * out.data[i * 3] + 0.587 * out.data[i * 3 + 1] + 0.114 * out.data[i * 3 + 2]);
    }
  }
  onProgress?.({ stage: "done", percent: 100, note: "Background removed." });
  return { mask, width: out.width, height: out.height, image, method: "ai" };
}

/** Segment with the simple flood-fill fallback (no model download). */
export function segmentSimple(
  image: { data: Uint8ClampedArray; width: number; height: number },
): SegmentResult {
  const raw = simpleMaskFromBackground(image);
  const mask = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) mask[i] = raw[i] === 1 ? 255 : 0;
  return { mask, width: image.width, height: image.height, image, method: "simple" };
}
