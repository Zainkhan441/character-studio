/**
 * SVG → raster helpers (M3, browser-only).
 *
 * Our scenes are SVG strings; MP4 export and PNG downloads both
 * need them as pixels. An <img> with an SVG blob URL renders the
 * SVG (including its feTurbulence hand filter) onto a canvas.
 *
 * Known limit: fonts referenced by the SVG (Patrick Hand) do NOT
 * load inside an <img> — text falls back to the SVG's cursive
 * fallback. The on-screen preview (inline SVG) uses the real font;
 * exported pixels use the fallback. Noted in the QA report.
 */

/** Draw an SVG string onto a canvas at the given pixel size. */
export async function svgToCanvas(
  svg: string,
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The scene could not be rasterized (SVG image failed to load)."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser.");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Render an SVG string to a PNG blob. */
export async function svgToPng(svg: string, width: number, height: number): Promise<Blob> {
  const canvas = await svgToCanvas(svg, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The PNG could not be encoded.");
  return blob;
}

/** Trigger a browser download of a blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
