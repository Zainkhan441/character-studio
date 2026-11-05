/**
 * Tests for the extraction silhouette analysis (M3).
 *
 * Synthetic masks are drawn with a tiny rasterizer (filled circles
 * + thick lines) so the tests never depend on a model download or
 * a real photo — the geometry must be right on its own.
 */
import { describe, expect, it } from "vitest";
import {
  analyzeSilhouette,
  angleDown,
  draftCharacterFromAnalysis,
  extractPalette,
  largestComponent,
  nearestPose,
  thresholdMask,
  type MaskGrid,
  type RgbaImage,
} from "./extract";
import { validateCharacter } from "./character";

/* ------------------------------------------------------------------ */
/* Tiny rasterizer for synthetic test figures                          */
/* ------------------------------------------------------------------ */

function blankGrid(w: number, h: number): MaskGrid {
  return { data: new Uint8Array(w * h), width: w, height: h };
}

function setPx(g: MaskGrid, x: number, y: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi >= 0 && xi < g.width && yi >= 0 && yi < g.height) g.data[yi * g.width + xi] = 1;
}

function drawDisc(g: MaskGrid, cx: number, cy: number, r: number): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) setPx(g, x, y);
    }
  }
}

function drawLine(g: MaskGrid, x0: number, y0: number, x1: number, y1: number, w: number): void {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2 + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    drawDisc(g, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2);
  }
}

/** A stick figure: head + torso + arms + legs, all in one component. */
function stickFigure(opts: {
  frontArmTo: [number, number];
  backArmTo: [number, number];
  frontLegTo: [number, number];
  backLegTo: [number, number];
}): MaskGrid {
  const g = blankGrid(200, 300);
  drawDisc(g, 100, 50, 30); // head
  drawLine(g, 100, 80, 100, 150, 8); // torso
  drawLine(g, 100, 90, opts.backArmTo[0], opts.backArmTo[1], 6);
  drawLine(g, 100, 90, opts.frontArmTo[0], opts.frontArmTo[1], 6);
  drawLine(g, 100, 150, opts.backLegTo[0], opts.backLegTo[1], 7);
  drawLine(g, 100, 150, opts.frontLegTo[0], opts.frontLegTo[1], 7);
  return g;
}

const STAND = stickFigure({
  backArmTo: [84, 150],
  frontArmTo: [116, 150],
  backLegTo: [88, 240],
  frontLegTo: [112, 240],
});

const WAVE = stickFigure({
  backArmTo: [84, 150],
  frontArmTo: [150, 35],
  backLegTo: [88, 240],
  frontLegTo: [112, 240],
});

const POINT = stickFigure({
  backArmTo: [84, 150],
  frontArmTo: [165, 88],
  backLegTo: [88, 240],
  frontLegTo: [112, 240],
});

/* ------------------------------------------------------------------ */

describe("thresholdMask", () => {
  it("binarizes at 128 by default", () => {
    expect(thresholdMask(new Uint8Array([0, 127, 128, 255]))).toEqual(new Uint8Array([0, 0, 1, 1]));
  });
});

describe("largestComponent", () => {
  it("keeps the biggest blob and drops stray noise", () => {
    const g = blankGrid(10, 10);
    drawDisc(g, 5, 5, 3);
    setPx(g, 0, 0);
    setPx(g, 9, 9);
    const out = largestComponent(g);
    expect(out.data[0]).toBe(0);
    expect(out.data[99]).toBe(0);
    expect(out.data[5 * 10 + 5]).toBe(1);
  });
});

describe("angleDown", () => {
  it("0 = straight down, 90 = horizontal forward, 180 = straight up", () => {
    expect(angleDown({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(0, 6);
    expect(angleDown({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90, 6);
    expect(angleDown({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(180, 6);
    expect(angleDown({ x: 0, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(-90, 6);
  });
});

describe("nearestPose", () => {
  it("snaps exact pose-table angles to themselves", () => {
    expect(nearestPose({ backArm: -10, frontArm: 10, backLeg: -8, frontLeg: 8 }).pose).toBe("stand");
    expect(nearestPose({ backArm: -8, frontArm: 115, backLeg: -5, frontLeg: 5 }).pose).toBe("wave");
    expect(nearestPose({ backArm: -8, frontArm: 92, backLeg: -5, frontLeg: 6 }).pose).toBe("point");
  });
});

describe("analyzeSilhouette", () => {
  it("returns null for an empty mask (no figure — never a broken draft)", () => {
    expect(analyzeSilhouette(blankGrid(100, 100), null)).toBeNull();
  });

  it("returns null for a tiny noise blob", () => {
    const g = blankGrid(100, 100);
    drawDisc(g, 50, 50, 3);
    expect(analyzeSilhouette(g, null)).toBeNull();
  });

  it("measures the head of a standing figure", () => {
    const a = analyzeSilhouette(STAND, null);
    expect(a).not.toBeNull();
    // Head centre is estimated from the top band (the torso neck
    // pulls the centroid a few px down) — tolerance is ±3px.
    expect(a!.headCenter.x).toBeCloseTo(100, -0.5);
    expect(Math.abs(a!.headCenter.y - 50)).toBeLessThanOrEqual(3);
    expect(Math.abs(a!.headRadius - 30)).toBeLessThanOrEqual(2);
    // Head diameter 60 / figure height ~220.
    expect(a!.headRatio).toBeCloseTo(0.27, 1);
    expect(a!.coverage).toBeGreaterThan(0.01);
    expect(a!.coverage).toBeLessThan(0.5);
  });

  it("snaps a standing figure to stand", () => {
    const a = analyzeSilhouette(STAND, null);
    expect(a!.snappedPose).toBe("stand");
  });

  it("snaps a raised front arm to wave, not cheer", () => {
    const a = analyzeSilhouette(WAVE, null);
    expect(a!.snappedPose).toBe("wave");
  });

  it("snaps a horizontal front arm to point", () => {
    const a = analyzeSilhouette(POINT, null);
    expect(a!.snappedPose).toBe("point");
  });

  it("finds hand and foot extremities", () => {
    const a = analyzeSilhouette(POINT, null);
    expect(a!.extremities.frontHand).not.toBeNull();
    expect(a!.extremities.frontHand!.x).toBeGreaterThan(150);
    expect(a!.extremities.frontFoot).not.toBeNull();
    expect(a!.extremities.frontFoot!.y).toBeGreaterThan(220);
  });

  it("warns when no eyes are detected (no image pixels)", () => {
    const a = analyzeSilhouette(STAND, null);
    expect(a!.eyes).toBeNull();
    expect(a!.warnings.some((w) => w.includes("Eyes"))).toBe(true);
  });

  it("detects two dark eye dots inside the head", () => {
    // Build a coloured image: white head, two black eye dots.
    const w = 200;
    const h = 300;
    const img: RgbaImage = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = 255;
      }
    }
    // Eye dots at (88, 52) and (112, 52) — inside the head circle.
    for (const [ex, ey] of [[88, 52], [112, 52]] as const) {
      for (let y = ey - 3; y <= ey + 3; y++) {
        for (let x = ex - 3; x <= ex + 3; x++) {
          const i = (y * w + x) * 4;
          img.data[i] = 0;
          img.data[i + 1] = 0;
          img.data[i + 2] = 0;
        }
      }
    }
    const a = analyzeSilhouette(STAND, img);
    expect(a!.eyes).not.toBeNull();
    expect(a!.eyes!.left.x).toBeCloseTo(88, 0);
    expect(a!.eyes!.right.x).toBeCloseTo(112, 0);
  });
});

describe("extractPalette", () => {
  it("picks skin/hair/outfit colours from the right bands", () => {
    const w = 200;
    const h = 300;
    const img: RgbaImage = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    const paint = (x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = (y * w + x) * 4;
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          img.data[i + 3] = 255;
        }
      }
    };
    paint(0, 0, 199, 299, 240, 210, 180); // warm light (skin-ish) everywhere
    paint(70, 20, 130, 60, 60, 35, 20); // dark brown hair in the head band
    paint(80, 100, 120, 170, 70, 120, 200); // blue outfit in the torso band
    const p = extractPalette(STAND, img);
    expect(p).not.toBeNull();
    // Skin: light warm fill.
    expect(p!.skin).toMatch(/^#[0-9a-f]{6}$/);
    // Hair: dark brown in the head band.
    const hr = parseInt(p!.hair.slice(1, 3), 16);
    expect(hr).toBeLessThan(110);
    // Outfit: blue in the torso band.
    const ob = parseInt(p!.outfit.slice(5, 7), 16);
    const orr = parseInt(p!.outfit.slice(1, 3), 16);
    expect(ob).toBeGreaterThan(orr);
  });

  it("returns null when the image dimensions do not match the mask", () => {
    const img: RgbaImage = { data: new Uint8ClampedArray(10 * 10 * 4), width: 10, height: 10 };
    expect(extractPalette(STAND, img)).toBeNull();
  });
});

describe("draftCharacterFromAnalysis", () => {
  it("builds a valid Character from a standing figure", () => {
    const a = analyzeSilhouette(STAND, null);
    expect(a).not.toBeNull();
    const c = draftCharacterFromAnalysis(a!, "Test Import");
    expect(c.name).toBe("Test Import");
    expect(c.pose).toBe("stand");
    const v = validateCharacter(c);
    expect(v.ok).toBe(true);
  });

  it("maps a wave figure's pose into the draft", () => {
    const a = analyzeSilhouette(WAVE, null);
    const c = draftCharacterFromAnalysis(a!, "Waver");
    expect(c.pose).toBe("wave");
  });
});
