/**
 * Tests for the simple (non-AI) segmentation fallback (M3).
 * The AI path (BiRefNet) cannot run in vitest's node environment —
 * it needs a browser + a ~98 MB model download — so it is covered
 * by the headless-browser QA pass instead. The fallback is pure and
 * fully tested here.
 */
import { describe, expect, it } from "vitest";
import { BIREFNET_MODEL_ID, simpleMaskFromBackground } from "./segment";

function makeImage(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number],
): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe("BIREFNET_MODEL_ID", () => {
  it("is the MIT-licensed onnx-community model (never RMBG/imgly)", () => {
    expect(BIREFNET_MODEL_ID).toBe("onnx-community/BiRefNet_lite");
    expect(BIREFNET_MODEL_ID).not.toContain("RMBG");
    expect(BIREFNET_MODEL_ID).not.toContain("imgly");
  });
});

describe("simpleMaskFromBackground", () => {
  it("removes a flat white background and keeps a dark figure", () => {
    const img = makeImage(100, 100, (x, y) => {
      const dx = x - 50;
      const dy = y - 50;
      return dx * dx + dy * dy <= 30 * 30 ? [40, 30, 20] : [255, 255, 255];
    });
    const mask = simpleMaskFromBackground(img);
    // Figure centre kept.
    expect(mask[50 * 100 + 50]).toBe(1);
    // Corners removed.
    expect(mask[0]).toBe(0);
    expect(mask[99]).toBe(0);
    expect(mask[99 * 100 + 99]).toBe(0);
    // Roughly the disc area is figure.
    let kept = 0;
    for (const v of mask) kept += v;
    expect(kept).toBeGreaterThan(2500);
    expect(kept).toBeLessThan(3500);
  });

  it("keeps a figure that touches the border on one side only", () => {
    // Red bar touches the LEFT border in the middle rows; all four
    // corners are white, so the background colour is unambiguous.
    const img = makeImage(60, 60, (x, y) => (x < 30 && y >= 20 && y < 40 ? [200, 50, 50] : [255, 255, 255]));
    const mask = simpleMaskFromBackground(img);
    expect(mask[30 * 60 + 10]).toBe(1); // red bar kept
    expect(mask[30 * 60 + 50]).toBe(0); // white area removed
    expect(mask[10 * 60 + 10]).toBe(0); // white above the bar removed
  });

  it("does not remove a figure on a noisy background (honest limit)", () => {
    // Random noise background: the flood fill finds almost no
    // background-coloured pixels, so most of the image stays figure.
    // The test pins the behaviour (keeps almost everything) so a
    // future change cannot silently claim it works on photos.
    const img = makeImage(40, 40, (x, y) => [(x * 7 + y * 13) % 256, (x * 3 + y * 11) % 256, (x * 5 + y * 17) % 256]);
    const mask = simpleMaskFromBackground(img);
    let kept = 0;
    for (const v of mask) kept += v;
    expect(kept).toBeGreaterThan(40 * 40 * 0.9);
  });
});
