/**
 * Silhouette analysis for the extraction wizard (M3, 2026-11-05).
 *
 * After segmentation (see ./segment.ts) we have a binary mask of the
 * figure. Everything in this module is PURE and deterministic — no
 * model, no DOM, no randomness — so it runs in milliseconds and is
 * fully unit-testable with synthetic masks.
 *
 * Honest limits (research, 2026-11-05): pose AI scores only 20-40%
 * on doodles, so we do NOT detect a pose with a neural net. We
 * derive it from the silhouette: head blob, limb extremities, then
 * snap to the nearest of our 21 poses. A wrong snap is one click to
 * fix in the correction UI — the AI gets you 80%, the human gets
 * you 100%.
 *
 * Coordinate note: mask pixels are (x right, y DOWN), origin top-left.
 * Character units use y DOWN too (head radius = 1), so angles map
 * directly: an angle of 0 = straight down, + = forward (right).
 */

import {
  HAIR_COLORS,
  POSES,
  defaultCharacter,
  type Character,
  type HairColorName,
  type HairStyle,
  type OutfitName,
  type PoseName,
} from "./character";

export interface MaskGrid {
  /** 0 = background, 1 = figure. Row-major, length width*height. */
  data: Uint8Array;
  width: number;
  height: number;
}

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Limb upper angles (degrees, 0 = straight down, + = forward). */
export interface LimbAngleEstimate {
  backArm: number;
  frontArm: number;
  backLeg: number;
  frontLeg: number;
}

export interface PaletteEstimate {
  /** Most common light fill colour inside the figure (skin guess). */
  skin: string;
  /** Most common dark colour in the head band (hair guess). */
  hair: string;
  /** Most common saturated colour in the torso band (outfit guess). */
  outfit: string;
  /** Most common very dark colour on the figure boundary (outline). */
  outline: string;
}

export interface SilhouetteAnalysis {
  /** Fraction of the image covered by the figure (0-1). */
  coverage: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  headCenter: Point;
  /** Head radius in mask pixels. */
  headRadius: number;
  /** Head diameter / total figure height (reference: ~0.39). */
  headRatio: number;
  /** Neck-to-hip length in head radii (reference: ~1.3). */
  torsoRadii: number;
  /** Hand/foot extremity points, in mask pixels. */
  extremities: { frontHand: Point | null; backHand: Point | null; frontFoot: Point | null; backFoot: Point | null };
  limbAngles: LimbAngleEstimate;
  /** Nearest of the 21 poses, by limb-angle distance. */
  snappedPose: PoseName;
  /** 0-1 distance to the snapped pose (lower = closer snap). */
  poseDistance: number;
  palette: PaletteEstimate;
  /** Dark blobs inside the head circle that look like eyes. */
  eyes: { left: Point; right: Point } | null;
  /** 0-1: how much to trust this analysis (coverage, head roundness, eyes). */
  confidence: number;
  /** Human-readable caveats, shown in the wizard. */
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function toHex(r: number, g: number, b: number): string {
  const h = (c: number): string => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Binarize a 0-255 mask at the given threshold. */
export function thresholdMask(data: Uint8Array, threshold = 128): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] >= threshold ? 1 : 0;
  return out;
}

/**
 * Keep only the largest 4-connected component of a binary mask.
 * Segmentation often leaves stray blobs (shadows, text, a second
 * figure); the character is the biggest one.
 */
export function largestComponent(mask: MaskGrid): MaskGrid {
  const { data, width, height } = mask;
  const seen = new Uint8Array(data.length);
  const out = new Uint8Array(data.length);
  let best: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < data.length; start++) {
    if (data[start] === 0 || seen[start] === 1) continue;
    const comp: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      comp.push(i);
      const x = i % width;
      const y = Math.floor(i / width);
      if (x > 0 && data[i - 1] === 1 && seen[i - 1] === 0) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < width - 1 && data[i + 1] === 1 && seen[i + 1] === 0) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && data[i - width] === 1 && seen[i - width] === 0) { seen[i - width] = 1; stack.push(i - width); }
      if (y < height - 1 && data[i + width] === 1 && seen[i + width] === 0) { seen[i + width] = 1; stack.push(i + width); }
    }
    if (comp.length > best.length) best = comp;
  }
  for (const i of best) out[i] = 1;
  return { data: out, width, height };
}

/** Angle (degrees, 0 = straight down, + = right/forward) from a to b. */
export function angleDown(from: Point, to: Point): number {
  return (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;
}

/**
 * Distance from a limb-angle estimate to a pose in the POSES table.
 * Upper-arm/leg angles matter most (weight 1); bends matter less
 * (weight 0.5) because the silhouette only estimates straight limbs.
 */
export function poseDistance(est: LimbAngleEstimate, pose: PoseName): number {
  const p = POSES[pose];
  const d = (a: number, b: number): number => {
    const diff = Math.abs(((a - b + 180) % 360) - 180);
    return diff * diff;
  };
  // The estimate has no bend information (straight limbs), so compare
  // upper angles at full weight and bends only as a tiny tiebreaker
  // (weight 0.05): a pose with a big bend (wave, 45°) must not lose
  // to a straight-arm pose just because the estimate has bend 0.
  return Math.sqrt(
    d(est.backArm, p.backArm[0]) +
      d(est.frontArm, p.frontArm[0]) +
      d(est.backLeg, p.backLeg[0]) +
      d(est.frontLeg, p.frontLeg[0]) +
      0.05 * (d(0, p.backArm[1]) + d(0, p.frontArm[1]) + d(0, p.backLeg[1]) + d(0, p.frontLeg[1])),
  );
}

/** Nearest pose to an angle estimate, with its distance. */
export function nearestPose(est: LimbAngleEstimate): { pose: PoseName; distance: number } {
  let best: PoseName = "stand";
  let bestD = Number.POSITIVE_INFINITY;
  for (const name of Object.keys(POSES) as PoseName[]) {
    const d = poseDistance(est, name);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return { pose: best, distance: bestD };
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

function quantKey(r: number, g: number, b: number): number {
  return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Most common colours inside the figure, by region. Returns null
 * when the figure has too few pixels to judge.
 */
export function extractPalette(mask: MaskGrid, image: RgbaImage | null): PaletteEstimate | null {
  if (!image || image.width !== mask.width || image.height !== mask.height) return null;
  const { data, width, height } = mask;
  const px = image.data;
  let total = 0;
  for (let i = 0; i < data.length; i++) total += data[i];
  if (total < 50) return null;

  // Bounding box (for the head/torso bands).
  let y0 = height;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] === 1) {
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const h = Math.max(1, y1 - y0 + 1);
  const headBottom = y0 + Math.round(h * 0.32);
  const torsoBottom = y0 + Math.round(h * 0.62);

  interface Bucket {
    r: number;
    g: number;
    b: number;
    n: number;
  }
  const count = (yFrom: number, yTo: number, pred: (r: number, g: number, b: number) => boolean): Bucket | null => {
    const buckets = new Map<number, Bucket>();
    for (let y = yFrom; y <= yTo; y++) {
      for (let x = 0; x < width; x++) {
        if (data[y * width + x] !== 1) continue;
        const i = (y * width + x) * 4;
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        if (!pred(r, g, b)) continue;
        const k = quantKey(r, g, b);
        const cur = buckets.get(k);
        if (cur) {
          cur.r += r;
          cur.g += g;
          cur.b += b;
          cur.n += 1;
        } else {
          buckets.set(k, { r, g, b, n: 1 });
        }
      }
    }
    let best: Bucket | null = null;
    for (const bkt of buckets.values()) {
      if (!best || bkt.n > best.n) best = bkt;
    }
    return best;
  };

  const avg = (bkt: Bucket | null, fallback: string): string =>
    bkt ? toHex(bkt.r / bkt.n, bkt.g / bkt.n, bkt.b / bkt.n) : fallback;

  // Skin: lightest common fill (not pure white background leakage).
  const skin = count(y0, y1, (r, g, b) => {
    const l = luminance(r, g, b);
    return l > 120 && l < 245;
  });
  // Hair: darkest common colour in the head band.
  const hair = count(y0, headBottom, (r, g, b) => luminance(r, g, b) < 110);
  // Outfit: most saturated common colour in the torso band.
  const outfit = count(headBottom, torsoBottom, (r, g, b) => {
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    return mx - mn > 25 && luminance(r, g, b) > 60 && luminance(r, g, b) < 220;
  });
  // Outline: darkest colour anywhere on the figure.
  const outline = count(y0, y1, (r, g, b) => luminance(r, g, b) < 60);

  return {
    skin: avg(skin, "#ffffff"),
    hair: avg(hair, "#2a2420"),
    outfit: avg(outfit, "#5b8dc9"),
    outline: avg(outline, "#211c19"),
  };
}

/** Nearest of our 5 hair colours to a hex colour (RGB distance). */
export function nearestHairColor(hex: string): HairColorName {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  let best: HairColorName = "brown";
  let bestD = Number.POSITIVE_INFINITY;
  for (const name of Object.keys(HAIR_COLORS) as HairColorName[]) {
    const c = HAIR_COLORS[name].base;
    const cr = parseInt(c.slice(1, 3), 16);
    const cg = parseInt(c.slice(3, 5), 16);
    const cb = parseInt(c.slice(5, 7), 16);
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/** Nearest outfit to a hex colour (hue + lightness match). */
export function nearestOutfit(hex: string): OutfitName {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const l = luminance(r, g, b);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx - mn < 30) {
    // Near-grey: dark = suit, mid = hoodie, light = robe.
    if (l < 70) return "suit";
    if (l > 210) return "robe";
    return "hoodie";
  }
  if (r > g && r > b) return l > 150 ? "shirt_red" : "shirt_red";
  if (g > r && g > b) return "shirt_green";
  if (b > r && b > g) return "shirt";
  return "shirt";
}

/* ------------------------------------------------------------------ */
/* Main analysis                                                       */
/* ------------------------------------------------------------------ */

/**
 * Analyse a binary figure mask (+ optional original pixels for the
 * palette). Returns null when there is no figure at all (empty mask)
 * — the caller must show the "no figure found" state, never a
 * broken draft.
 */
export function analyzeSilhouette(mask: MaskGrid, image: RgbaImage | null): SilhouetteAnalysis | null {
  const clean = largestComponent(mask);
  const { data, width, height } = clean;
  let total = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] !== 1) continue;
      total += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const coverage = total / (width * height);
  if (total < 100 || coverage < 0.005) return null;

  const warnings: string[] = [];
  const figH = Math.max(1, y1 - y0 + 1);
  const figW = Math.max(1, x1 - x0 + 1);

  // Head: the top of the figure. Two-pass, because a raised arm
  // can draw a LONGER horizontal run than the head (a horizontal
  // pointing arm at head height) and a naive "widest run" then
  // measures the arm, not the head (caught by tests 2026-11-05).
  // Pass 1: centroid of the top 25% band — arms attach at the
  // shoulder (~30% down), so this band is essentially head only.
  // Pass 2: widest run in the top 32% band whose centre is close
  // to the pass-1 anchor x — that run is the head's diameter.
  const headBandEnd = y0 + Math.round(figH * 0.25);
  let headArea = 0;
  let headCx = 0;
  let headCy = 0;
  for (let y = y0; y <= headBandEnd; y++) {
    for (let x = x0; x <= x1; x++) {
      if (data[y * width + x] === 1) {
        headArea += 1;
        headCx += x;
        headCy += y;
      }
    }
  }
  if (headArea === 0) return null;
  headCx /= headArea;
  headCy /= headArea;
  const areaRadius = Math.sqrt(headArea / Math.PI);
  let maxRun = 0;
  const runBandEnd = y0 + Math.round(figH * 0.32);
  for (let y = y0; y <= runBandEnd; y++) {
    let runStart = -1;
    for (let x = x0; x <= x1 + 1; x++) {
      const on = x <= x1 && data[y * width + x] === 1;
      if (on && runStart < 0) runStart = x;
      if (!on && runStart >= 0) {
        const runLen = x - runStart;
        const runCenter = (runStart + x - 1) / 2;
        // Keep only runs centred near the head anchor — an
        // outstretched arm's run is far from the head's centre x.
        if (Math.abs(runCenter - headCx) <= figW * 0.25 && runLen > maxRun) maxRun = runLen;
        runStart = -1;
      }
    }
  }
  const runRadius = maxRun / 2;
  // A round head: area radius ≈ run radius. Take the larger — hair
  // makes the band wider than the face, never narrower.
  const headRadius = Math.max(areaRadius, runRadius);
  const headCenter: Point = { x: headCx, y: headCy };
  const headRatio = (2 * headRadius) / figH;
  if (headRatio < 0.15 || headRatio > 0.65) {
    warnings.push("Head size looks unusual — check the pose and proportions in the next step.");
  }

  // Torso: neck (head bottom) to hip (~62% of figure height).
  const neckY = headCenter.y + headRadius;
  const hipY = y0 + figH * 0.62;
  const torsoRadii = Math.max(0.5, (hipY - neckY) / headRadius);

  // Body axis: the head centre x, NOT the bounding-box centre —
  // an outstretched arm skews the bbox, and the feet then fall on
  // the wrong side of the split (caught by tests 2026-11-05).
  const axisX = headCenter.x;

  // Extremities: hands = leftmost/rightmost pixels from the top of
  // the figure to 78% height, skipping the head circle itself (a
  // raised hand can be ABOVE the shoulder); feet = leftmost/
  // rightmost pixels in the bottom 12%.
  const handBandEnd = y0 + Math.round(figH * 0.78);
  const footBandStart = y0 + Math.round(figH * 0.88);
  let leftHand: Point | null = null;
  let rightHand: Point | null = null;
  let leftFoot: Point | null = null;
  let rightFoot: Point | null = null;
  for (let y = y0; y <= handBandEnd; y++) {
    for (let x = x0; x <= x1; x++) {
      if (data[y * width + x] !== 1) continue;
      const dx = x - headCenter.x;
      const dy = y - headCenter.y;
      if (dx * dx + dy * dy < (headRadius * 1.05) ** 2) continue; // the head itself
      if (x < axisX - headRadius * 0.6 && (!leftHand || x < leftHand.x)) leftHand = { x, y };
      if (x > axisX + headRadius * 0.6 && (!rightHand || x > rightHand.x)) rightHand = { x, y };
    }
  }
  for (let y = footBandStart; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (data[y * width + x] !== 1) continue;
      if (x < axisX && (!leftFoot || x < leftFoot.x)) leftFoot = { x, y };
      if (x >= axisX && (!rightFoot || x > rightFoot.x)) rightFoot = { x, y };
    }
  }

  const shoulder: Point = { x: axisX, y: neckY + headRadius * 0.15 };
  const hip: Point = { x: axisX, y: hipY };
  const limbAngles: LimbAngleEstimate = {
    backArm: leftHand ? angleDown(shoulder, leftHand) : -10,
    frontArm: rightHand ? angleDown(shoulder, rightHand) : 10,
    backLeg: leftFoot ? angleDown(hip, leftFoot) : -8,
    frontLeg: rightFoot ? angleDown(hip, rightFoot) : 8,
  };
  const { pose: snappedPose, distance: poseDistanceValue } = nearestPose(limbAngles);

  const palette =
    extractPalette(clean, image) ?? { skin: "#ffffff", hair: "#2a2420", outfit: "#5b8dc9", outline: "#211c19" };

  // Eyes: dark blobs inside the head circle. A doodle face has two
  // roughly symmetric dark dots; if we find them, the eye spacing
  // is real, otherwise the wizard defaults to the style-guide value.
  let eyes: { left: Point; right: Point } | null = null;
  if (image) {
    const px = image.data;
    const dark: Point[] = [];
    const r0 = Math.max(0, Math.floor(headCenter.y - headRadius * 0.7));
    const r1 = Math.min(height - 1, Math.ceil(headCenter.y + headRadius * 0.5));
    for (let y = r0; y <= r1; y++) {
      for (let x = Math.floor(headCenter.x - headRadius); x <= Math.ceil(headCenter.x + headRadius); x++) {
        if (x < 0 || x >= width) continue;
        if (data[y * width + x] !== 1) continue;
        const dx = x - headCenter.x;
        const dy = y - headCenter.y;
        if (dx * dx + dy * dy > headRadius * headRadius) continue;
        const i = (y * width + x) * 4;
        if (luminance(px[i], px[i + 1], px[i + 2]) < 70) dark.push({ x, y });
      }
    }
    if (dark.length >= 4) {
      // Two clusters: split by x around the head centre.
      const left = dark.filter((p) => p.x < headCenter.x);
      const right = dark.filter((p) => p.x >= headCenter.x);
      if (left.length >= 2 && right.length >= 2) {
        const avgPt = (pts: Point[]): Point => ({
          x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
          y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
        });
        const l = avgPt(left);
        const r = avgPt(right);
        if (Math.abs(l.y - r.y) < headRadius * 0.5 && r.x - l.x > headRadius * 0.2) {
          eyes = { left: l, right: r };
        }
      }
    }
  }
  if (!eyes) warnings.push("Eyes not detected — default eye placement used; check the face in the next step.");

  // Confidence: coverage sanity + head roundness + eyes.
  const roundness = Math.min(1, areaRadius / Math.max(1, runRadius));
  let confidence = 0.55 + 0.2 * roundness + (eyes ? 0.15 : 0);
  if (figW > figH * 1.6) {
    confidence -= 0.2;
    warnings.push("Figure is much wider than tall — it may be lying down or cropped; check the pose.");
  }
  if (coverage > 0.6) {
    confidence -= 0.25;
    warnings.push("The figure fills most of the image — a plain background segments much better.");
  }
  confidence = Math.max(0.1, Math.min(0.98, confidence));

  return {
    coverage,
    bbox: { x0, y0, x1, y1 },
    headCenter,
    headRadius,
    headRatio,
    torsoRadii,
    extremities: { frontHand: rightHand, backHand: leftHand, frontFoot: rightFoot, backFoot: leftFoot },
    limbAngles,
    snappedPose,
    poseDistance: poseDistanceValue,
    palette,
    eyes,
    confidence,
    warnings,
  };
}

/**
 * Build a draft Character from a silhouette analysis. Pure: the
 * wizard then lets the user correct every field.
 */
export function draftCharacterFromAnalysis(a: SilhouetteAnalysis, name: string): Character {
  const base = defaultCharacter();
  const skinLum = (() => {
    const h = a.palette.skin;
    return luminance(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
  })();
  // Hair style guess from the head band: wide dark mass above the
  // eyes = messy/wild, compact = short. Never claim certainty — the
  // picker in the wizard is one click away.
  const hairStyle: HairStyle = a.headRatio > 0.45 ? "messy" : "short";
  return {
    ...base,
    id: `import-${Date.now().toString(36)}`,
    name,
    pose: a.snappedPose,
    proportions: {
      ...base.proportions,
      // Our renderer at headRadius 1 has head diameter / total height
      // ≈ 0.39 (style guide R1). Scale the head so the measured
      // ratio is preserved; torso comes straight from the measurement.
      headRadius: Math.max(0.5, Math.min(2, a.headRatio / 0.39)),
      torso: Math.max(0.8, Math.min(3, a.torsoRadii)),
    },
    hair: { ...base.hair, style: hairStyle, color: nearestHairColor(a.palette.hair) },
    outfit: { ...base.outfit, outfit: nearestOutfit(a.palette.outfit) },
    face: {
      ...base.face,
      eyeSpacing: a.eyes ? Math.max(0.5, Math.min(2, (a.eyes.right.x - a.eyes.left.x) / (a.headRadius * 0.6))) : 1,
    },
    style: {
      ...base.style,
      ink: a.palette.outline,
      skin: skinLum < 170 ? "tan" : "white",
    },
  };
}
