/**
 * SVG renderer — TypeScript port of the reference Python engine
 * `engine/ink.py` (Ink Studio v2). Geometry is ported, not redesigned:
 * POSES + limb() forward kinematics, hair/face/hat/outfit part builders,
 * character() z-order assembly, and the `hand` filter that makes the
 * whole hand-drawn look.
 *
 * Determinism: the ONLY source of randomness is a seeded RNG passed in
 * (see ./rng.ts). Same character + same seed => byte-identical SVG.
 * Never call Math.random() or Date.now() here.
 *
 * Differences from the Python original (deliberate, documented):
 * - Python's random.Random(seed) is Mersenne Twister; we use mulberry32.
 *   Numbers differ from the Python output, but determinism holds in TS.
 * - Coordinates are formatted to 3 decimals (Python used .3f in most
 *   places, .2f in a few) — visually identical, deterministic either way.
 * - robe_svg()/shirt_svg() are dead code in the Python character path
 *   (top_svg handles those collars) and are not ported.
 */
import type {
  Character,
  FaceName,
  HairStyle,
  HatName,
  LimbAngles,
  LookName,
  OutfitDef,
  OutfitName,
  PoseKind,
  PoseName,
  PropName,
} from "./character";
import { HAIR_COLORS, OUTFITS, POSES } from "./character";
import type { Rng } from "./rng";
import { mulberry32 } from "./rng";

/* ------------------------------------------------------------------ */
/* Constants — ink.py: INK, LW, OW, limb lengths.                     */
/* ------------------------------------------------------------------ */

export const DEFAULT_INK = "#211c19";

/* ------------------------------------------------------------------ */
/* Number formatting — mirrors Python f"{x:.3f}" / f"{x:.2f}".         */
/* ------------------------------------------------------------------ */

function fmt(n: number, decimals = 3): string {
  // Guard against -0.000 and NaN leaking into output: never fail silently.
  if (!Number.isFinite(n)) {
    throw new Error(`renderer: non-finite coordinate ${n}`);
  }
  const v = Object.is(n, -0) ? 0 : n;
  return v.toFixed(decimals);
}

type Pt = readonly [number, number];

function pathFromPoints(pts: readonly Pt[]): string {
  return "M" + pts.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(" L");
}

function closedPath(pts: readonly Pt[]): string {
  return pathFromPoints(pts) + " Z";
}

/**
 * Corner points for rounding a polyline joint: p1 sits `r` before the
 * joint on the incoming segment, p2 sits `r` after it on the outgoing
 * segment. The joint position itself never moves — only the drawn
 * path rounds the corner (M3 drawing, 2026-11-05).
 */
export function cornerPoints(a: Pt, k: Pt, b: Pt, r = 0.15): { p1: Pt; p2: Pt } {
  const d1 = Math.hypot(k[0] - a[0], k[1] - a[1]) || 1;
  const d2 = Math.hypot(b[0] - k[0], b[1] - k[1]) || 1;
  const rr = Math.min(r, d1 * 0.4, d2 * 0.4);
  return {
    p1: [k[0] - ((k[0] - a[0]) / d1) * rr, k[1] - ((k[1] - a[1]) / d1) * rr],
    p2: [k[0] + ((b[0] - k[0]) / d2) * rr, k[1] + ((b[1] - k[1]) / d2) * rr],
  };
}

/**
 * Polyline path with a small quadratic curve at every interior joint,
 * so elbows/knees (and sleeve/trouser tubes) read as smooth bends
 * instead of sharp angles. Endpoints and joint positions are
 * identical to the straight polyline — computeSkeleton and the pose
 * editor are unaffected. With < 3 points it is just a straight path.
 */
export function roundedPolyline(pts: readonly Pt[], r = 0.15): string {
  if (pts.length < 3) return pathFromPoints(pts);
  let d = `M${fmt(pts[0][0])},${fmt(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const k = pts[i];
    const { p1, p2 } = cornerPoints(pts[i - 1], k, pts[i + 1], r);
    d += ` L${fmt(p1[0])},${fmt(p1[1])} Q${fmt(k[0])},${fmt(k[1])} ${fmt(p2[0])},${fmt(p2[1])}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${fmt(last[0])},${fmt(last[1])}`;
  return d;
}

function polar(cx: number, cy: number, angDeg: number, rad: number): Pt {
  const a = (angDeg * Math.PI) / 180;
  return [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
}

/**
 * Forward kinematics for one two-segment limb.
 * Angles in degrees, measured from straight down, positive = forward.
 * Ported verbatim from ink.py limb().
 */
export function limb(
  x: number,
  y: number,
  upper: number,
  lower: number,
  a1: number,
  a2: number,
): { knee: Pt; end: Pt } {
  const t1 = (a1 * Math.PI) / 180;
  const kx = x + upper * Math.sin(t1);
  const ky = y + upper * Math.cos(t1);
  const t2 = ((a1 + a2) * Math.PI) / 180;
  return { knee: [kx, ky], end: [kx + lower * Math.sin(t2), ky + lower * Math.cos(t2)] };
}

function shade(hexcol: string, k: number): string {
  const h = hexcol.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = (c: number): number => Math.max(0, Math.min(255, Math.round(c * k)));
  const hex = (c: number): string => f(c).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function tube(pts: readonly Pt[], width: number, color: string, ink: string, ow: number): string {
  // Rounded at the joint (M3): a sleeved elbow/knee bends smoothly.
  const d = roundedPolyline(pts);
  return (
    `<path d="${d}" stroke="${ink}" stroke-width="${fmt(width + 2 * ow)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" stroke="${color}" stroke-width="${fmt(width)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" stroke="${shade(color, 0.82)}" stroke-width="${fmt(width * 0.25)}" fill="none" stroke-linecap="round" opacity="0.6" transform="translate(${fmt(width * 0.22)},0)"/>`
  );
}

/**
 * Subtle two-sided shading for a torso garment (M3): a soft darker
 * edge on one side, a light edge on the other — the same trick tube()
 * uses for limbs, so the body reads less flat. Drawn in upright torso
 * space; `hemY` is the garment's hem, `edge` its half-width at the hem.
 */
function torsoShade(color: string, torso: number, hemY: number, edge = 0.58): string {
  const dk = shade(color, 0.78);
  const lt = shade(color, 1.3);
  const top = -torso + 0.35;
  const ex = edge * 0.82;
  return (
    `<path d="M0.44,${fmt(top, 2)} Q0.52,-0.5 ${fmt(ex, 2)},${fmt(hemY - 0.06, 2)}" stroke="${dk}" stroke-width="0.09" fill="none" opacity="0.45" stroke-linecap="round" data-torso-shade="dark"/>` +
    `<path d="M-0.44,${fmt(top, 2)} Q-0.52,-0.5 ${fmt(-ex, 2)},${fmt(hemY - 0.06, 2)}" stroke="${lt}" stroke-width="0.07" fill="none" opacity="0.55" stroke-linecap="round" data-torso-shade="light"/>`
  );
}

function partWay(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function scallopPath(pointsAlong: readonly Pt[], depth: number, rng: Rng): string {
  let d = "";
  for (let i = 0; i < pointsAlong.length - 1; i++) {
    const [x1, y1] = pointsAlong[i];
    const [x2, y2] = pointsAlong[i + 1];
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = (y2 - y1) / len;
    const ny = -(x2 - x1) / len;
    const k = depth * rng.uniform(0.8, 1.2);
    d += `Q${fmt(mx - nx * k)},${fmt(my - ny * k)} ${fmt(x2)},${fmt(y2)} `;
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* Hair — ported from ink.py hair_svg() / hair_back_svg() / beard_svg() */
/* ------------------------------------------------------------------ */

interface HairCtx {
  hx: number;
  hy: number;
  ink: string;
  ow: number;
  rng: Rng;
}

function hairColors(color: string): { base: string; dark: string; light: string } {
  const found = (HAIR_COLORS as Record<string, { base: string; dark: string; light: string }>)[color];
  if (!found) throw new Error(`renderer: unknown hair color "${color}"`);
  return found;
}

function hairMessy(ctx: HairCtx, style: HairStyle, color: string): string {
  const { hx, hy, ink, ow, rng } = ctx;
  const { base, dark, light } = hairColors(color);
  const out: string[] = [];
  const k = style === "wild" ? 0.28 : 0.2;
  const puff = (p1: Pt, p2: Pt, amt: number): string => {
    const mx = (p1[0] + p2[0]) / 2;
    const my = (p1[1] + p2[1]) / 2;
    const vx = mx - hx;
    const vy = my - hy;
    const len = Math.hypot(vx, vy) || 1;
    return `Q${fmt(mx + (vx / len) * amt)},${fmt(my + (vy / len) * amt)} ${fmt(p2[0])},${fmt(p2[1])} `;
  };
  const angs = [84, 62, 40, 18, -4, -26, -48, -70, -92, -114];
  const rad = (a: number): number => 1.08 + 0.2 * Math.exp(-(((a + 15) / 50) ** 2));
  const pts = angs.map((a) => polar(hx, hy, a, rad(a)));
  let d = `M${fmt(pts[0][0])},${fmt(pts[0][1])} `;
  for (let i = 0; i < pts.length - 1; i++) {
    d += puff(pts[i], pts[i + 1], k * rng.uniform(0.85, 1.1));
  }
  const nape = polar(hx, hy, -128, 0.97);
  d += puff(pts[pts.length - 1], nape, k * 0.6);
  for (const a of [-110, -85, -60]) {
    const [x, y] = polar(hx, hy, a, 0.94);
    d += `L${fmt(x)},${fmt(y)} `;
  }
  const locks: Array<[Pt, Pt, Pt]> = [
    [[hx - 0.35, hy - 0.72], [hx - 0.02, hy - 0.55], [hx + 0.12, hy - 0.74]],
    [[hx + 0.12, hy - 0.74], [hx + 0.45, hy - 0.52], [hx + 0.52, hy - 0.74]],
    [[hx + 0.52, hy - 0.74], [hx + 0.86, hy - 0.5], [hx + 0.9, hy - 0.62]],
  ];
  d += `L${fmt(locks[0][0][0])},${fmt(locks[0][0][1])} `;
  for (const [b0, tip, b1] of locks) {
    d +=
      `Q${fmt(b0[0] + 0.12)},${fmt(tip[1] - 0.02)} ${fmt(tip[0])},${fmt(tip[1])} ` +
      `Q${fmt(tip[0] - 0.02)},${fmt(b1[1] + 0.08)} ${fmt(b1[0])},${fmt(b1[1])} `;
  }
  d += `Q${fmt(hx + 1.02)},${fmt(hy - 0.62)} ${fmt(pts[0][0])},${fmt(pts[0][1])} Z`;
  out.push(`<path d="${d}" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`);
  let st = "";
  for (let i = 1; i < angs.length - 1; i++) {
    const a = angs[i];
    const p1 = polar(hx, hy, a, rad(a) + 0.02);
    const p2 = polar(hx, hy, a + 9, rad(a) - 0.2);
    const c = polar(hx, hy, a - 4, rad(a) - 0.08);
    st += `M${fmt(p1[0])},${fmt(p1[1])} Q${fmt(c[0])},${fmt(c[1])} ${fmt(p2[0])},${fmt(p2[1])} `;
  }
  st += `M${fmt(hx + 0.12)},${fmt(hy - 0.95)} Q${fmt(hx + 0.06)},${fmt(hy - 0.75)} ${fmt(hx)},${fmt(hy - 0.6)} `;
  st += `M${fmt(hx + 0.52)},${fmt(hy - 0.95)} Q${fmt(hx + 0.5)},${fmt(hy - 0.75)} ${fmt(hx + 0.43)},${fmt(hy - 0.58)} `;
  out.push(`<path d="${st}" stroke="${dark}" stroke-width="0.05" fill="none" stroke-linecap="round"/>`);
  const h1 = polar(hx, hy, -60, 1.12);
  const h2 = polar(hx, hy, -18, 1.16);
  const hc = polar(hx, hy, -38, 1.25);
  out.push(
    `<path d="M${fmt(h1[0])},${fmt(h1[1])} Q${fmt(hc[0])},${fmt(hc[1])} ${fmt(h2[0])},${fmt(h2[1])}" stroke="${light}" stroke-width="0.08" fill="none" stroke-linecap="round"/>`,
  );
  return out.join("");
}

function hairShaggy(ctx: HairCtx, color: string): string {
  const { hx, hy, ink, ow, rng } = ctx;
  const { base, dark, light } = hairColors(color);
  const out: string[] = [];
  const tufts = (bases: readonly Pt[], tipDy: number, sweep: number, dIn: string): string => {
    let d = dIn;
    for (let i = 0; i < bases.length - 1; i++) {
      const [x1, y1] = bases[i];
      const [x2, y2] = bases[i + 1];
      const tx = (x1 + x2) / 2 + sweep + rng.uniform(-0.03, 0.03);
      const ty = Math.max(y1, y2) + tipDy * rng.uniform(0.8, 1.15);
      d +=
        `Q${fmt(x1 + (tx - x1) * 0.35)},${fmt(ty - tipDy * 0.15)} ${fmt(tx)},${fmt(ty)} ` +
        `Q${fmt(x2 - (x2 - tx) * 0.25)},${fmt((ty + y2) / 2)} ${fmt(x2)},${fmt(y2)} `;
    }
    return d;
  };
  const crown: Pt[] = [];
  for (let a = 84; a > -116; a -= 20) {
    crown.push(polar(hx, hy, a, 1.1 + 0.07 * Math.exp(-(((a + 20) / 55) ** 2))));
  }
  let d = `M${fmt(hx + 0.98)},${fmt(hy - 0.1)} L${fmt(crown[0][0])},${fmt(crown[0][1])} `;
  for (let i = 0; i < crown.length - 1; i++) {
    const [x1, y1] = crown[i];
    const [x2, y2] = crown[i + 1];
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const vx = mx - hx;
    const vy = my - hy;
    const len = Math.hypot(vx, vy);
    d += `Q${fmt(mx + (vx / len) * 0.07)},${fmt(my + (vy / len) * 0.07)} ${fmt(x2)},${fmt(y2)} `;
  }
  d += `Q${fmt(hx - 1.18)},${fmt(hy - 0.05)} ${fmt(hx - 1.12)},${fmt(hy + 0.42)} `;
  d = tufts(
    [[hx - 1.12, hy + 0.42], [hx - 0.94, hy + 0.55], [hx - 0.76, hy + 0.5], [hx - 0.6, hy + 0.36]],
    0.26,
    0.04,
    d,
  );
  d += `Q${fmt(hx - 0.55)},${fmt(hy + 0.05)} ${fmt(hx - 0.62)},${fmt(hy - 0.25)} `;
  const fr: Pt[] = [
    [hx - 0.62, hy - 0.3],
    [hx - 0.35, hy - 0.62],
    [hx - 0.05, hy - 0.68],
    [hx + 0.25, hy - 0.7],
    [hx + 0.55, hy - 0.67],
    [hx + 0.82, hy - 0.56],
  ];
  d = tufts(fr, 0.2, 0.07, d);
  d += `Q${fmt(hx + 0.86)},${fmt(hy - 0.25)} ${fmt(hx + 0.92)},${fmt(hy - 0.02)} Q${fmt(hx + 0.96)},${fmt(hy - 0.2)} ${fmt(hx + 0.98)},${fmt(hy - 0.1)} Z`;
  for (const [a, len] of [[-62, 0.24], [-38, 0.3], [-14, 0.22]] as const) {
    const b1 = polar(hx, hy, a - 9, 1.1);
    const b2 = polar(hx, hy, a + 9, 1.12);
    const tip = polar(hx, hy, a - 16, 1.12 + len);
    out.push(
      `<path d="M${fmt(b1[0])},${fmt(b1[1])} Q${fmt((b1[0] + tip[0]) / 2)},${fmt((b1[1] + tip[1]) / 2 - 0.02)} ${fmt(tip[0])},${fmt(tip[1])} Q${fmt((b2[0] + tip[0]) / 2 + 0.03)},${fmt((b2[1] + tip[1]) / 2)} ${fmt(b2[0])},${fmt(b2[1])} Z" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`,
    );
  }
  out.push(`<path d="${d}" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`);
  let st = "";
  for (const [a, r1, ex, ey] of [
    [-95, 1.08, -1.0, 0.3],
    [-75, 1.12, -0.8, 0.2],
    [-55, 1.15, -0.5, -0.45],
    [-30, 1.16, -0.2, -0.5],
    [-5, 1.15, 0.1, -0.52],
    [20, 1.12, 0.4, -0.52],
    [45, 1.08, 0.66, -0.45],
  ] as const) {
    const [sx, sy] = polar(hx, hy, a, r1 - 0.06);
    const cx = (sx + hx + ex) / 2 + 0.05;
    const cy = (sy + hy + ey) / 2 - 0.12;
    st += `M${fmt(sx)},${fmt(sy)} Q${fmt(cx)},${fmt(cy)} ${fmt(hx + ex)},${fmt(hy + ey)} `;
  }
  out.push(`<path d="${st}" stroke="${dark}" stroke-width="0.045" fill="none" stroke-linecap="round" opacity="0.9"/>`);
  const h1 = polar(hx, hy, -50, 1.06);
  const h2 = polar(hx, hy, -10, 1.1);
  const hc = polar(hx, hy, -30, 1.17);
  out.push(
    `<path d="M${fmt(h1[0])},${fmt(h1[1])} Q${fmt(hc[0])},${fmt(hc[1])} ${fmt(h2[0])},${fmt(h2[1])}" stroke="${light}" stroke-width="0.075" fill="none" stroke-linecap="round"/>`,
  );
  return out.join("");
}

function hairSpiky(ctx: HairCtx, style: HairStyle, color: string): string {
  const { hx, hy, ink, ow, rng } = ctx;
  const { base, dark } = hairColors(color);
  const out: string[] = [];
  const longer = style === "spiky_long" ? 1.25 : 1.0;
  const spike = (
    aDeg: number,
    w: number,
    len: number,
    bend: number,
    r0 = 1.0,
    flow: Pt = [-0.75, 0.35],
  ): string => {
    const ar = (aDeg * Math.PI) / 180;
    const radial: Pt = [Math.sin(ar), -Math.cos(ar)];
    let dx = radial[0] + flow[0];
    let dy = radial[1] + flow[1];
    const n = Math.hypot(dx, dy) || 1;
    dx /= n;
    dy /= n;
    const b = polar(hx, hy, aDeg, r0);
    const v1 = polar(hx, hy, aDeg - w / 2, r0 - 0.05);
    const v2 = polar(hx, hy, aDeg + w / 2, r0 - 0.05);
    const t: Pt = [b[0] + dx * len, b[1] + dy * len];
    const px = -dy;
    const py = dx;
    const c1: Pt = [(v1[0] + t[0]) / 2 + px * bend, (v1[1] + t[1]) / 2 + py * bend];
    const c2: Pt = [(v2[0] + t[0]) / 2 + px * bend * 0.6, (v2[1] + t[1]) / 2 + py * bend * 0.6];
    return (
      `<path d="M${fmt(v1[0])},${fmt(v1[1])} Q${fmt(c1[0])},${fmt(c1[1])} ${fmt(t[0])},${fmt(t[1])} ` +
      `Q${fmt(c2[0])},${fmt(c2[1])} ${fmt(v2[0])},${fmt(v2[1])} Z" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow * 0.85)}" stroke-linejoin="round"/>`
    );
  };
  const spikes: string[] = [];
  for (const aDeg of [-162, -145, -128, -111]) {
    spikes.push(spike(aDeg + rng.uniform(-2, 2), 30, rng.uniform(0.38, 0.5) * longer, 0.1, 1.02, [-0.15, 2.2]));
  }
  for (const aDeg of [-94, -76, -58, -40, -22, -4, 14, 32, 48, 62]) {
    const len = rng.uniform(0.34, 0.48) * longer * (aDeg > -70 && aDeg < 0 ? 1.15 : 0.85);
    spikes.push(spike(aDeg + rng.uniform(-2, 2), 28, len, 0.12, 1.06, [-2.0, 0.35]));
  }
  for (const aDeg of [-30, 2]) {
    spikes.push(spike(aDeg, 10, rng.uniform(0.5, 0.6) * longer, 0.14, 1.08, [-2.2, 0.0]));
  }
  out.push(...spikes);
  const cap: Pt[] = [];
  for (let a = 54; a > -171; a -= 8) {
    cap.push(polar(hx, hy, a, 1.08 + 0.04 * Math.exp(-(((a + 30) / 50) ** 2))));
  }
  const inner: Array<[number, number]> = [
    [-170, 1.0], [-155, 0.86], [-135, 0.76], [-110, 0.72], [-80, 0.72],
    [-50, 0.72], [-20, 0.72], [10, 0.72], [36, 0.76], [54, 0.98],
  ];
  for (const [a, r] of inner) cap.push(polar(hx, hy, a, r));
  out.push(`<path d="${closedPath(cap)}" fill="${base}"/>`);
  const hl = inner.slice(1);
  let d = "";
  for (let i = 0; i < hl.length; i++) {
    const [a1, r1] = hl[i];
    const p1 = polar(hx, hy, a1, r1);
    if (i === 0) {
      d += `M${fmt(p1[0])},${fmt(p1[1])} `;
      continue;
    }
    const [a0, r0] = hl[i - 1];
    const am = (a0 + a1) / 2;
    const rm = Math.min(r0, r1) - (a1 < -60 ? 0.12 : 0.0);
    const pm = polar(hx, hy, am, rm);
    const mid = polar(hx, hy, am - 4, (r0 + rm) / 2);
    d += `Q${fmt(mid[0])},${fmt(mid[1])} ${fmt(pm[0])},${fmt(pm[1])} L${fmt(p1[0])},${fmt(p1[1])} `;
  }
  out.push(`<path d="${d}" fill="none" stroke="${ink}" stroke-width="${fmt(ow * 0.85)}" stroke-linejoin="round"/>`);
  for (const [aDeg, len, lean, w] of [[-28, 0.3, 0.12, 12], [2, 0.36, 0.18, 13], [30, 0.3, 0.22, 12]] as const) {
    const b0 = polar(hx, hy, aDeg - w, 0.74);
    const b1 = polar(hx, hy, aDeg + w, 0.76);
    const t: Pt = [(b0[0] + b1[0]) / 2 + lean, (b0[1] + b1[1]) / 2 + len];
    const c1: Pt = [(b0[0] + t[0]) / 2 - 0.06, (b0[1] + t[1]) / 2 + 0.02];
    const c2: Pt = [(b1[0] + t[0]) / 2 + 0.05, (b1[1] + t[1]) / 2 - 0.05];
    out.push(
      `<path d="M${fmt(b0[0])},${fmt(b0[1])} Q${fmt(c1[0])},${fmt(c1[1])} ${fmt(t[0])},${fmt(t[1])} Q${fmt(c2[0])},${fmt(c2[1])} ${fmt(b1[0])},${fmt(b1[1])} Z" ` +
        `fill="${base}" stroke="${ink}" stroke-width="${fmt(ow * 0.85)}" stroke-linejoin="round"/>`,
    );
  }
  let st = "";
  for (let i = 0; i < 9; i++) {
    const aDeg = rng.uniform(-150, 30);
    const p1 = polar(hx, hy, aDeg, 0.85);
    const p2 = polar(hx, hy, aDeg - 12, 1.15);
    st += `M${fmt(p1[0])},${fmt(p1[1])} Q${fmt((p1[0] + p2[0]) / 2)},${fmt((p1[1] + p2[1]) / 2 - 0.03)} ${fmt(p2[0])},${fmt(p2[1])} `;
  }
  out.push(`<path d="${st}" stroke="${dark}" stroke-width="0.035" fill="none" stroke-linecap="round" opacity="0.8"/>`);
  return out.join("");
}

function hairRagged(ctx: HairCtx, color: string): string {
  const { hx, hy, ink, ow, rng } = ctx;
  const { base, dark, light } = hairColors(color);
  const out: string[] = [];
  const pp = (a: number, r: number): Pt => polar(hx, hy, a, r);
  const f2 = (p: Pt): string => `${fmt(p[0])},${fmt(p[1])}`;
  const start = pp(80, 1.02);
  let d = `M${f2(start)} `;
  const cents = [64, 44, 24, 4, -16, -36, -56, -76, -96, -116];
  // Tuft lengths reduced ~25% (M1, 2026-11-05): the old spikes made
  // the hair a helmet covering half the head.
  const lens = [0.09, 0.13, 0.15, 0.17, 0.15, 0.15, 0.15, 0.14, 0.12, 0.11];
  for (let i = 0; i < cents.length; i++) {
    const c = cents[i];
    const len = lens[i] * rng.uniform(0.85, 1.15);
    const b1 = pp(c + 10, 1.03);
    const tip = pp(c - 9, 1.04 + len);
    const b2 = pp(c - 10, 1.03);
    d += `Q${f2(pp(c + 5, 1.04 + len * 0.35))} ${f2(tip)} Q${f2(pp(c - 4, 1.04 + len * 0.3))} ${f2(b2)} `;
    void b1;
  }
  d += `L${fmt(hx - 1.03)},${fmt(hy + 0.12)} `;
  for (const [tx, ty, bx, by] of [
    [-1.08, 0.48, -0.9, 0.3],
    [-0.8, 0.56, -0.7, 0.28],
    [-0.58, 0.44, -0.54, 0.12],
  ] as const) {
    d +=
      `Q${fmt(hx + tx + 0.07)},${fmt(hy + ty - 0.2)} ${fmt(hx + tx)},${fmt(hy + ty)} ` +
      `Q${fmt(hx + bx - 0.04)},${fmt(hy + by + 0.1)} ${fmt(hx + bx)},${fmt(hy + by)} `;
  }
  d += `Q${fmt(hx - 0.5)},${fmt(hy - 0.1)} ${fmt(hx - 0.5)},${fmt(hy - 0.46)} `;
  const xs = [-0.5, -0.12, 0.26, 0.62, 0.9];
  for (let i = 0; i < 4; i++) {
    const x1 = hx + xs[i];
    const x2 = hx + xs[i + 1];
    const tx = (x1 + x2) / 2 + 0.1;
    // Fringe tips raised (M3, 2026-11-05): the old range
    // (0.27–0.36) put tips as low as hy-0.26, only 0.06 above the
    // brow line — inside the R7 margin. 0.22–0.31 keeps ≥0.11 clear.
    const ty = hy - 0.62 + rng.uniform(0.22, 0.31);
    d +=
      `Q${fmt(x1 + 0.02)},${fmt(ty - 0.12)} ${fmt(tx)},${fmt(ty)} ` +
      `Q${fmt(x2 - 0.05)},${fmt(ty - 0.12)} ${fmt(x2)},${fmt(hy - 0.58)} `;
  }
  d += `Q${fmt(hx + 1.0)},${fmt(hy - 0.42)} ${f2(start)} Z`;
  out.push(`<path d="${d}" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow * 0.9)}" stroke-linejoin="round"/>`);
  let st = "";
  for (const [a, r1, ea, er] of [
    [60, 1.0, 36, 0.78],
    [38, 1.02, 12, 0.76],
    [14, 1.04, -12, 0.78],
    [-10, 1.05, -38, 0.8],
    [-34, 1.05, -64, 0.82],
    [-60, 1.04, -88, 0.86],
    [-84, 1.03, -108, 0.9],
  ] as const) {
    const p1 = pp(a, r1);
    const p2 = pp(ea, er);
    const c = pp((a + ea) / 2 + 6, (r1 + er) / 2 + 0.04);
    st += `M${f2(p1)} Q${f2(c)} ${f2(p2)} `;
  }
  out.push(`<path d="${st}" stroke="${dark}" stroke-width="0.04" fill="none" stroke-linecap="round" opacity="0.85"/>`);
  const h1 = pp(-50, 1.04);
  const h2 = pp(-12, 1.08);
  const hc = pp(-30, 1.12);
  out.push(
    `<path d="M${f2(h1)} Q${f2(hc)} ${f2(h2)}" stroke="${light}" stroke-width="0.07" fill="none" stroke-linecap="round"/>`,
  );
  return out.join("");
}

function hairWavy(ctx: HairCtx, color: string): string {
  const { hx, hy, ink, ow } = ctx;
  const { base, dark, light } = hairColors(color);
  const out: string[] = [];
  const outer: Pt[] = [];
  for (let a = 70; a > -121; a -= 14) outer.push(polar(hx, hy, a, 1.08));
  let d = `M${fmt(outer[0][0])},${fmt(outer[0][1])} `;
  for (let i = 0; i < outer.length - 1; i++) {
    const [x1, y1] = outer[i];
    const [x2, y2] = outer[i + 1];
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const vx = mx - hx;
    const vy = my - hy;
    const len = Math.hypot(vx, vy);
    d += `Q${fmt(mx + (vx / len) * 0.07)},${fmt(my + (vy / len) * 0.07)} ${fmt(x2)},${fmt(y2)} `;
  }
  d += `L${fmt(hx - 0.9)},${fmt(hy + 0.4)} Q${fmt(hx - 0.75)},${fmt(hy - 0.2)} ${fmt(hx - 0.55)},${fmt(hy - 0.6)} `;
  d +=
    `Q${fmt(hx - 0.1)},${fmt(hy - 0.75)} ${fmt(hx + 0.3)},${fmt(hy - 0.5)} Q${fmt(hx + 0.6)},${fmt(hy - 0.32)} ${fmt(hx + 0.92)},${fmt(hy - 0.4)} ` +
    `Q${fmt(hx + 1.02)},${fmt(hy - 0.6)} ${fmt(outer[0][0])},${fmt(outer[0][1])} Z`;
  out.push(`<path d="${d}" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`);
  const st =
    `M${fmt(hx - 0.4)},${fmt(hy - 0.95)} Q${fmt(hx + 0.1)},${fmt(hy - 0.8)} ${fmt(hx + 0.45)},${fmt(hy - 0.5)} ` +
    `M${fmt(hx - 0.75)},${fmt(hy - 0.6)} Q${fmt(hx - 0.4)},${fmt(hy - 0.75)} ${fmt(hx - 0.05)},${fmt(hy - 0.65)}`;
  out.push(`<path d="${st}" stroke="${dark}" stroke-width="0.045" fill="none" stroke-linecap="round"/>`);
  const h1 = polar(hx, hy, -60, 1.0);
  const h2 = polar(hx, hy, -20, 1.02);
  const hc = polar(hx, hy, -40, 1.1);
  out.push(
    `<path d="M${fmt(h1[0])},${fmt(h1[1])} Q${fmt(hc[0])},${fmt(hc[1])} ${fmt(h2[0])},${fmt(h2[1])}" stroke="${light}" stroke-width="0.07" fill="none" stroke-linecap="round"/>`,
  );
  const [bx, by] = polar(hx, hy, -75, 1.12);
  const dots: Pt[] = [[-0.27, -0.05], [-0.27, 0.05], [0.27, -0.05], [0.27, 0.05]];
  out.push(
    `<g transform="translate(${fmt(bx)},${fmt(by)}) rotate(-30)">` +
      `<rect x="-0.26" y="-0.05" width="0.52" height="0.1" fill="#f4ecd8" stroke="${ink}" stroke-width="0.035"/>` +
      dots.map(([sx, sy]) => `<circle cx="${fmt(sx, 2)}" cy="${fmt(sy, 2)}" r="0.075" fill="#f4ecd8" stroke="${ink}" stroke-width="0.035"/>`).join("") +
      `</g>`,
  );
  return out.join("");
}

function hairShort(ctx: HairCtx, color: string): string {
  const { hx, hy, ink, ow, rng } = ctx;
  const { base, dark } = hairColors(color);
  const out: string[] = [];
  const pts: Pt[] = [];
  let i = 0;
  for (let a = -112; a < 80; a += 7) {
    pts.push(polar(hx, hy, a, 1.1 + (i % 2 ? 0.06 : 0) + rng.uniform(-0.02, 0.03)));
    i++;
  }
  pts.push(
    polar(hx, hy, 72, 0.88),
    polar(hx, hy, 58, 0.62),
    polar(hx, hy, 44, 0.74),
    polar(hx, hy, 30, 0.66),
    polar(hx, hy, 14, 0.78),
    polar(hx, hy, -5, 0.84),
  );
  for (let a = -25; a > -113; a -= 15) pts.push(polar(hx, hy, a, 0.92));
  pts.push(polar(hx, hy, -112, 0.98));
  out.push(`<path d="${closedPath(pts)}" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`);
  let st = "";
  for (let a = -90; a < 60; a += 22) {
    const p1 = polar(hx, hy, a, 1.08);
    const p2 = polar(hx, hy, a + 10, 0.9);
    st += `M${fmt(p1[0], 2)},${fmt(p1[1], 2)} L${fmt(p2[0], 2)},${fmt(p2[1], 2)} `;
  }
  out.push(`<path d="${st}" stroke="${dark}" stroke-width="0.045" fill="none" stroke-linecap="round"/>`);
  const [sx, sy] = polar(hx, hy, -100, 0.95);
  out.push(
    `<path d="M${fmt(sx, 2)},${fmt(sy, 2)} l0.12,0.35 l0.12,-0.05 l-0.05,-0.32 Z" fill="${base}" stroke="${ink}" stroke-width="0.04"/>`,
  );
  return out.join("");
}

function hairLong(ctx: HairCtx, color: string): string {
  const { hx, hy, ink, ow, rng } = ctx;
  const { base, dark, light } = hairColors(color);
  const out: string[] = [];
  const pts: Pt[] = [polar(hx, hy, 72, 1.0)];
  for (let a = 60; a > -95; a -= 12) pts.push(polar(hx, hy, a, 1.13 + 0.04 * Math.sin(a)));
  pts.push([hx - 1.17, hy + 0.2], [hx - 1.22, hy + 0.9], [hx - 1.28, hy + 1.6]);
  for (let k = 0; k < 7; k++) {
    const x = hx - 1.3 + 0.13 * k;
    pts.push([x, hy + 1.95 + (k % 2 ? 0.18 : 0) + rng.uniform(-0.04, 0.04)]);
  }
  pts.push([hx - 0.42, hy + 1.75], [hx - 0.5, hy + 1.0], [hx - 0.62, hy + 0.35]);
  pts.push(polar(hx, hy, -55, 0.9), polar(hx, hy, -25, 0.88), polar(hx, hy, 0, 0.86));
  pts.push(polar(hx, hy, 18, 0.62), polar(hx, hy, 36, 0.7), polar(hx, hy, 55, 0.66));
  const d = "M" + pts.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(" L") + " Z";
  out.push(`<path d="${d}" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`);
  const st =
    `M${fmt(hx - 0.95, 2)},${fmt(hy - 0.4, 2)} Q${fmt(hx - 1.05, 2)},${fmt(hy + 0.6, 2)} ${fmt(hx - 1.1, 2)},${fmt(hy + 1.7, 2)} ` +
    `M${fmt(hx - 0.75, 2)},${fmt(hy - 0.1, 2)} Q${fmt(hx - 0.85, 2)},${fmt(hy + 0.8, 2)} ${fmt(hx - 0.85, 2)},${fmt(hy + 1.75, 2)} ` +
    `M${fmt(hx - 0.62, 2)},${fmt(hy + 0.6, 2)} Q${fmt(hx - 0.62, 2)},${fmt(hy + 1.2, 2)} ${fmt(hx - 0.6, 2)},${fmt(hy + 1.7, 2)} ` +
    `M${fmt(hx - 0.2, 2)},${fmt(hy - 1.0, 2)} Q${fmt(hx + 0.25, 2)},${fmt(hy - 0.85, 2)} ${fmt(hx + 0.45, 2)},${fmt(hy - 0.45, 2)}`;
  out.push(`<path d="${st}" stroke="${dark}" stroke-width="0.045" fill="none" stroke-linecap="round"/>`);
  const hl = `M${fmt(hx - 0.4, 2)},${fmt(hy - 1.02, 2)} Q${fmt(hx - 0.8, 2)},${fmt(hy - 0.8, 2)} ${fmt(hx - 1.0, 2)},${fmt(hy - 0.3, 2)}`;
  out.push(`<path d="${hl}" stroke="${light}" stroke-width="0.06" fill="none" stroke-linecap="round"/>`);
  return out.join("");
}

function hairBun(ctx: HairCtx, color: string): string {
  const { hx, hy, ink, ow } = ctx;
  const { base } = hairColors(color);
  const out: string[] = [];
  out.push(`<circle cx="${fmt(hx - 0.55, 2)}" cy="${fmt(hy - 1.05, 2)}" r="0.42" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow)}"/>`);
  const pts: Pt[] = [];
  for (let a = -115; a < 70; a += 10) pts.push(polar(hx, hy, a, 1.05));
  pts.push(polar(hx, hy, 60, 0.9), polar(hx, hy, 25, 0.82));
  for (let a = 0; a > -116; a -= 20) pts.push(polar(hx, hy, a, 0.9));
  out.push(`<path d="${closedPath(pts)}" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`);
  return out.join("");
}

function hairBeardStyle(ctx: HairCtx, color: string): string {
  const { hx, hy, ink, ow } = ctx;
  const { base } = hairColors(color);
  const pts: Pt[] = [];
  for (let a = 95; a < 220; a += 10) pts.push(polar(hx, hy, a, 1.0));
  pts.push(
    polar(hx, hy, 230, 1.0),
    polar(hx, hy, 200, 1.55),
    polar(hx, hy, 175, 1.45),
    polar(hx, hy, 150, 1.5),
    polar(hx, hy, 115, 1.25),
  );
  return `<path d="${closedPath(pts)}" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`;
}

/** Ported from ink.py hair_svg(). Returns "" for none/bald. */
export function hairSvg(hx: number, hy: number, style: HairStyle, color: string, rng: Rng, ink: string, ow: number): string {
  if (style === "none") return "";
  const ctx: HairCtx = { hx, hy, ink, ow, rng };
  switch (style) {
    case "messy":
    case "wild":
    case "mop":
      return hairMessy(ctx, style, color);
    case "shaggy":
      return hairShaggy(ctx, color);
    case "spiky":
    case "spiky_long":
      return hairSpiky(ctx, style, color);
    case "ragged":
      return hairRagged(ctx, color);
    case "wavy":
      return hairWavy(ctx, color);
    case "short":
      return hairShort(ctx, color);
    case "long":
      return hairLong(ctx, color);
    case "bun":
      return hairBun(ctx, color);
    case "beard":
      return hairBeardStyle(ctx, color);
    default: {
      const exhaustive: never = style;
      throw new Error(`renderer: unknown hair style "${String(exhaustive)}"`);
    }
  }
}

/** Ported from ink.py hair_back_svg() — only "wavy" has a back mass. */
export function hairBackSvg(hx: number, hy: number, style: HairStyle, color: string, ink: string, ow: number): string {
  if (style !== "wavy") return "";
  const { base, dark } = hairColors(color);
  const left: Pt[] = [
    [hx - 1.1, hy - 0.2],
    [hx - 1.25, hy + 0.5],
    [hx - 1.15, hy + 1.1],
    [hx - 1.3, hy + 1.7],
    [hx - 1.2, hy + 2.3],
  ];
  const right: Pt[] = [
    [hx + 0.55, hy + 2.2],
    [hx + 0.7, hy + 1.6],
    [hx + 0.55, hy + 1.0],
  ];
  let d = `M${fmt(hx - 0.2)},${fmt(hy - 1.0)} Q${fmt(hx - 1.05)},${fmt(hy - 0.95)} ${fmt(left[0][0])},${fmt(left[0][1])} `;
  for (let i = 1; i < left.length; i++) {
    const [px, py] = left[i - 1];
    const [x, y] = left[i];
    d += `Q${fmt((px + x) / 2 + (i % 2 ? -0.18 : 0.12))},${fmt((py + y) / 2)} ${fmt(x)},${fmt(y)} `;
  }
  const bx = [0, 1, 2, 3, 4, 5].map((k) => hx - 1.2 + 0.35 * k);
  for (let k = 1; k < 6; k++) {
    d += `Q${fmt((bx[k - 1] + bx[k]) / 2)},${fmt(hy + 2.55 + (k % 2 ? 0.05 : -0.02))} ${fmt(bx[k])},${fmt(hy + 2.3 - 0.02 * k)} `;
  }
  for (let i = 0; i < right.length; i++) {
    const [x, y] = right[i];
    d += `Q${fmt(x + (i % 2 ? 0.15 : -0.1))},${fmt(y + 0.3)} ${fmt(x)},${fmt(y)} `;
  }
  d += `Q${fmt(hx + 0.9)},${fmt(hy + 0.3)} ${fmt(hx + 0.6)},${fmt(hy)} Z`;
  const st =
    `M${fmt(hx - 0.9, 2)},${fmt(hy, 2)} Q${fmt(hx - 1.05, 2)},${fmt(hy + 0.9, 2)} ${fmt(hx - 0.95, 2)},${fmt(hy + 2.0, 2)} ` +
    `M${fmt(hx - 0.55, 2)},${fmt(hy + 0.6, 2)} Q${fmt(hx - 0.7, 2)},${fmt(hy + 1.4, 2)} ${fmt(hx - 0.5, 2)},${fmt(hy + 2.1, 2)} ` +
    `M${fmt(hx + 0.2, 2)},${fmt(hy + 1.2, 2)} Q${fmt(hx + 0.35, 2)},${fmt(hy + 1.7, 2)} ${fmt(hx + 0.2, 2)},${fmt(hy + 2.15, 2)}`;
  return (
    `<path d="${d}" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>` +
    `<path d="${st}" stroke="${dark}" stroke-width="0.05" fill="none" stroke-linecap="round"/>`
  );
}

/** Ported from ink.py beard_svg(). style "full" | "long" | "none". */
export function beardSvg(
  hx: number,
  hy: number,
  color: string,
  rng: Rng,
  style: "none" | "full" | "long",
  ink: string,
  ow: number,
): string {
  if (style === "none") return "";
  const { base, dark } = hairColors(color);
  const out: string[] = [];
  const drop = style === "long" ? 2.1 : 1.55;
  const pts: Pt[] = [polar(hx, hy, 98, 1.0)];
  let i = 0;
  for (let a = 108; a < 236; a += 8) {
    const r = 1.0 + (drop - 1.0) * Math.exp(-(((a - 165) / 38) ** 2)) + (i % 2 ? 0.13 : 0);
    pts.push(polar(hx, hy, a + rng.uniform(-2, 2), r));
    i++;
  }
  pts.push(polar(hx, hy, 240, 0.98));
  pts.push(
    [hx - 0.55, hy + 0.35],
    [hx - 0.1, hy + 0.62],
    [hx + 0.24, hy + 0.66],
    [hx + 0.55, hy + 0.58],
    [hx + 0.85, hy + 0.3],
  );
  const d = "M" + pts.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(" L") + " Z";
  out.push(`<path d="${d}" fill="${base}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`);
  let st = "";
  for (let j = 0; j < 12; j++) {
    const x = hx + rng.uniform(-0.5, 0.7);
    const y = hy + rng.uniform(0.75, drop - 0.15);
    st += `M${fmt(x, 2)},${fmt(y, 2)} q${fmt(rng.uniform(-0.05, 0.05), 2)},0.15 ${fmt(rng.uniform(-0.06, 0.06), 2)},0.28 `;
  }
  out.push(`<path d="${st}" stroke="${dark}" stroke-width="0.045" fill="none" stroke-linecap="round"/>`);
  const mx = hx + 0.24;
  const my = hy + 0.33;
  out.push(
    `<path d="M${fmt(mx, 2)},${fmt(my, 2)} C${fmt(mx - 0.15, 2)},${fmt(my - 0.12, 2)} ${fmt(mx - 0.4, 2)},${fmt(my - 0.06, 2)} ${fmt(mx - 0.42, 2)},${fmt(my + 0.14, 2)} ` +
      `C${fmt(mx - 0.25, 2)},${fmt(my + 0.06, 2)} ${fmt(mx - 0.1, 2)},${fmt(my + 0.1, 2)} ${fmt(mx, 2)},${fmt(my + 0.04, 2)} ` +
      `C${fmt(mx + 0.1, 2)},${fmt(my + 0.1, 2)} ${fmt(mx + 0.25, 2)},${fmt(my + 0.06, 2)} ${fmt(mx + 0.42, 2)},${fmt(my + 0.14, 2)} ` +
      `C${fmt(mx + 0.4, 2)},${fmt(my - 0.06, 2)} ${fmt(mx + 0.15, 2)},${fmt(my - 0.12, 2)} ${fmt(mx, 2)},${fmt(my, 2)} Z" fill="${base}" stroke="${ink}" stroke-width="0.05"/>`,
  );
  return out.join("");
}

/* ------------------------------------------------------------------ */
/* Hats — ported from ink.py hat_svg().                                */
/* ------------------------------------------------------------------ */

export function hatSvg(hx: number, hy: number, hat: HatName, ink: string, ow: number): string {
  const f = (n: number): string => fmt(n, 2);
  switch (hat) {
    case "none":
      return "";
    case "explorer":
      return (
        `<path d="M${f(hx - 0.9)},${f(hy - 0.5)} C${f(hx - 0.85)},${f(hy - 1.65)} ${f(hx + 0.95)},${f(hy - 1.7)} ${f(hx + 1.0)},${f(hy - 0.5)} Z" fill="#c9a66b" stroke="${ink}" stroke-width="${fmt(ow)}"/>` +
        `<path d="M${f(hx - 0.88)},${f(hy - 0.72)} L${f(hx + 0.98)},${f(hy - 0.72)}" stroke="#7d5a32" stroke-width="0.17"/>` +
        `<path d="M${f(hx - 0.2)},${f(hy - 1.55)} q0.1,0.4 0.05,0.75 M${f(hx + 0.35)},${f(hy - 1.5)} q0.05,0.4 0,0.7" stroke="#a5834e" stroke-width="0.05" fill="none"/>` +
        `<path d="M${f(hx - 1.5)},${f(hy - 0.42)} Q${f(hx + 0.1)},${f(hy - 0.8)} ${f(hx + 1.65)},${f(hy - 0.42)} Q${f(hx + 0.1)},${f(hy - 0.15)} ${f(hx - 1.5)},${f(hy - 0.42)} Z" fill="#c9a66b" stroke="${ink}" stroke-width="${fmt(ow)}"/>`
      );
    case "crown":
      return (
        `<path d="M${f(hx - 0.7)},${f(hy - 0.8)} L${f(hx - 0.75)},${f(hy - 1.6)} L${f(hx - 0.35)},${f(hy - 1.2)} L${f(hx)},${f(hy - 1.75)} ` +
        `L${f(hx + 0.35)},${f(hy - 1.2)} L${f(hx + 0.75)},${f(hy - 1.6)} L${f(hx + 0.7)},${f(hy - 0.8)} Z" fill="#f2c230" stroke="${ink}" stroke-width="${fmt(ow)}"/>` +
        `<circle cx="${f(hx)}" cy="${f(hy - 1.0)}" r="0.1" fill="#c0392b"/>`
      );
    case "helmet":
      return (
        `<path d="M${f(hx - 1.02)},${f(hy - 0.15)} C${f(hx - 1.08)},${f(hy - 1.55)} ${f(hx + 1.08)},${f(hy - 1.55)} ${f(hx + 1.02)},${f(hy - 0.2)} L${f(hx + 0.8)},${f(hy - 0.25)} L${f(hx + 0.75)},${f(hy - 0.55)} L${f(hx - 0.7)},${f(hy - 0.55)} L${f(hx - 0.8)},${f(hy + 0.35)} Z" fill="#b9b2a6" stroke="${ink}" stroke-width="${fmt(ow)}"/>` +
        `<path d="M${f(hx - 0.6)},${f(hy - 1.15)} C${f(hx - 0.3)},${f(hy - 1.95)} ${f(hx + 0.4)},${f(hy - 1.95)} ${f(hx + 0.65)},${f(hy - 1.15)}" stroke="#b5332b" stroke-width="0.38" fill="none" stroke-linecap="round"/>`
      );
    case "headband":
      return `<path d="M${f(hx - 0.98)},${f(hy - 0.5)} Q${f(hx)},${f(hy - 0.75)} ${f(hx + 0.98)},${f(hy - 0.45)}" stroke="#b5452b" stroke-width="0.2" fill="none"/>`;
    case "fur":
      return (
        `<path d="M${f(hx - 1.12)},${f(hy - 0.35)} C${f(hx - 1.2)},${f(hy - 1.7)} ${f(hx + 1.2)},${f(hy - 1.7)} ${f(hx + 1.12)},${f(hy - 0.35)} Z" fill="#6b4a2c" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>` +
        `<path d="M${f(hx - 1.28)},${f(hy - 0.3)} Q${f(hx)},${f(hy - 0.75)} ${f(hx + 1.28)},${f(hy - 0.3)} Q${f(hx)},${f(hy - 0.05)} ${f(hx - 1.28)},${f(hy - 0.3)} Z" fill="#8b5a33" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>` +
        `<path d="M${f(hx - 0.6)},${f(hy - 1.1)} q0.2,0.35 0,0.6 M${f(hx + 0.3)},${f(hy - 1.2)} q0.2,0.35 0,0.6" stroke="#4e3420" stroke-width="0.06" fill="none"/>`
      );
    case "frost": {
      const cap =
        `M${f(hx - 0.85)},${f(hy - 0.95)} C${f(hx - 1.0)},${f(hy - 1.5)} ${f(hx - 0.2)},${f(hy - 1.78)} ${f(hx + 0.4)},${f(hy - 1.66)} C${f(hx + 0.95)},${f(hy - 1.58)} ${f(hx + 1.05)},${f(hy - 1.15)} ${f(hx + 0.85)},${f(hy - 0.92)} ` +
        `q-0.1,0.18 -0.24,0.03 q-0.1,0.2 -0.26,-0.0 q-0.12,0.2 -0.28,-0.02 q-0.12,0.18 -0.28,0.0 q-0.1,0.18 -0.24,0.0 q-0.1,0.12 -0.19,0.0 Z`;
      const ice = (
        [
          [-0.62, 0.04, 0.34],
          [-0.1, 0.1, 0.26],
          [0.5, 0.06, 0.38],
        ] as const
      )
        .map(
          ([dx, dy, len]) =>
            `<path d="M${f(hx + dx)},${f(hy - 0.88 + dy)} l0.08,0.0 l-0.04,${fmt(len, 2)} Z" fill="#cfeaff" stroke="${ink}" stroke-width="0.035" stroke-linejoin="round"/>`,
        )
        .join("");
      return (
        `<path d="${cap}" fill="#ffffff" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>` +
        ice +
        `<path d="M${f(hx - 0.55)},${f(hy - 1.42)} q0.3,-0.2 0.6,-0.2" stroke="#cfe3f3" stroke-width="0.09" fill="none" stroke-linecap="round"/>`
      );
    }
    case "wizard":
      return (
        `<path d="M${f(hx - 1.1)},${f(hy - 0.6)} L${f(hx + 0.2)},${f(hy - 3.0)} L${f(hx + 1.15)},${f(hy - 0.6)} Z" fill="#3e4f8f" stroke="${ink}" stroke-width="${fmt(ow)}"/>` +
        `<ellipse cx="${f(hx)}" cy="${f(hy - 0.62)}" rx="1.45" ry="0.22" fill="#3e4f8f" stroke="${ink}" stroke-width="${fmt(ow)}"/>`
      );
    default: {
      const exhaustive: never = hat;
      throw new Error(`renderer: unknown hat "${String(exhaustive)}"`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Face — ported from ink.py face_svg().                                */
/* mouth 0..1 opens the mouth (the lip-sync hook).                      */
/* ------------------------------------------------------------------ */

export interface FaceOpts {
  face: FaceName;
  look: LookName;
  blink: boolean;
  mouth: number;
  lashes: boolean;
  stubble: boolean;
  blush: boolean;
  cold: boolean;
  eyeSize: number;
  eyeSpacing: number;
}

export function faceSvg(hx: number, hy: number, opts: FaceOpts, ink: string): string {
  const { face, look, blink, mouth, lashes, stubble, blush, cold, eyeSize, eyeSpacing } = opts;
  const lookOffset: Record<LookName, Pt> = {
    forward: [0.0, 0],
    up: [0.05, -0.15],
    down: [0.02, 0.15],
    back: [-0.42, 0],
    viewer: [-0.18, 0],
  };
  const [lx, ly] = lookOffset[look] ?? [0, 0];
  const ex = hx + 0.26 + lx;
  // Eyes per the measured style guide (R3, 2026-11-05): centres
  // ±0.30 from the face centre (spacing 0.60), eye line +0.08 below
  // the head centre (~55% down the head). The old placement (above
  // centre, 0.46 spacing) is what made the default read "worried".
  const off = 0.3 * eyeSpacing;
  const e1 = ex - off;
  const e2 = ex + off;
  const ey = hy + 0.08 + ly;
  const s: string[] = [];
  const sw = `stroke="${ink}" stroke-width="0.07" fill="none" stroke-linecap="round"`;
  const big = face === "surprised" || face === "scared" || face === "shocked";
  const f2 = (n: number): string => fmt(n, 2);
  if (stubble) {
    s.push(
      `<path d="M${f2(hx - 0.62)},${f2(hy + 0.42)} Q${f2(hx - 0.4)},${f2(hy + 0.98)} ${f2(hx + 0.25)},${f2(hy + 0.98)} Q${f2(hx + 0.8)},${f2(hy + 0.8)} ${f2(hx + 0.95)},${f2(hy + 0.3)} Q${f2(hx + 0.5)},${f2(hy + 0.62)} ${f2(hx + 0.2)},${f2(hy + 0.62)} Q${f2(hx - 0.25)},${f2(hy + 0.64)} ${f2(hx - 0.62)},${f2(hy + 0.42)} Z" fill="#8a8580" opacity="0.28"/>`,
    );
  }
  if (blink || face === "sleepy") {
    for (const e of [e1, e2]) {
      s.push(`<path d="M${f2(e - 0.11)},${f2(ey)} Q${f2(e)},${f2(ey + 0.09)} ${f2(e + 0.11)},${f2(ey)}" ${sw}/>`);
    }
  } else if (face === "content") {
    for (const e of [e1, e2]) {
      s.push(`<path d="M${f2(e - 0.11)},${f2(ey + 0.03)} Q${f2(e)},${f2(ey - 0.1)} ${f2(e + 0.11)},${f2(ey + 0.03)}" ${sw}/>`);
    }
  } else {
    // Normal eyes are small dots (R3: dot diameter ~0.10 head radii);
    // surprised/scared/shocked get the bigger ellipses. Lashes get a
    // slightly larger dot so the lash lines still read.
    const erx = big ? 0.13 : lashes ? 0.075 : 0.06;
    const ery = big ? 0.18 : lashes ? 0.075 : 0.06;
    const px = look === "back" ? -0.03 : look === "forward" ? 0.025 : 0.015;
    for (const e of [e1, e2]) {
      s.push(`<ellipse cx="${fmt(e)}" cy="${fmt(ey)}" rx="${fmt(erx * eyeSize)}" ry="${fmt(ery * eyeSize)}" fill="${ink}"/>`);
      s.push(`<circle cx="${fmt(e + px + 0.03)}" cy="${fmt(ey - ery * eyeSize * 0.42)}" r="${fmt(erx * eyeSize * 0.36)}" fill="#ffffff"/>`);
    }
  }
  if (lashes && !blink && face !== "content" && face !== "sleepy") {
    const lr = face === "surprised" || face === "scared" || face === "shocked" ? 0.13 : 0.1;
    void lr;
    for (const e of [e1, e2]) {
      const lashPts: Array<[number, number]> = [[0.06, -0.17], [0.11, -0.13], [0.14, -0.07]];
      lashPts.forEach(([dx, dy], k) => {
        s.push(
          `<path d="M${fmt(e + dx * 0.6)},${fmt(ey + dy * 0.9)} l${fmt(0.05 + 0.01 * k)},${fmt(-0.05 + 0.02 * k)}" stroke="${ink}" stroke-width="0.04" stroke-linecap="round"/>`,
        );
      });
    }
  }
  // soft default brows (expressive faces draw their own)
  if (
    (face === "neutral" || face === "happy" || face === "content" || face === "big_smile" || face === "smirk" || face === "sleepy") &&
    !blink
  ) {
    const lift = face === "happy" || face === "big_smile" ? 0.04 : 0.0;
    if (lashes) {
      s.push(
        `<path d="M${f2(e1 - 0.12)},${f2(ey - 0.27 - lift)} Q${f2(e1)},${f2(ey - 0.33 - lift)} ${f2(e1 + 0.11)},${f2(ey - 0.28 - lift)} ` +
          `M${f2(e2 - 0.1)},${f2(ey - 0.28 - lift)} Q${f2(e2)},${f2(ey - 0.34 - lift)} ${f2(e2 + 0.12)},${f2(ey - 0.27 - lift)}" stroke="${ink}" stroke-width="0.05" fill="none" stroke-linecap="round" opacity="0.85"/>`,
      );
    } else {
      s.push(
        `<path d="M${f2(e1 - 0.14)},${f2(ey - 0.28 - lift)} L${f2(e1 + 0.12)},${f2(ey - 0.31 - lift)} ` +
          `M${f2(e2 - 0.12)},${f2(ey - 0.31 - lift)} L${f2(e2 + 0.14)},${f2(ey - 0.28 - lift)}" stroke="${ink}" stroke-width="0.085" fill="none" stroke-linecap="round"/>`,
      );
    }
  }
  if ((lashes && (face === "happy" || face === "content" || face === "big_smile" || face === "smirk")) || blush) {
    for (const cxo of [e1 - 0.12, e2 + 0.14]) {
      s.push(`<ellipse cx="${f2(cxo)}" cy="${f2(ey + 0.27)}" rx="0.13" ry="0.07" fill="#f2a0a0" opacity="0.45"/>`);
    }
  }
  const mx = hx + 0.24 + lx * 0.55;
  const my = hy + 0.43 + ly * 0.4;
  if (mouth > 0.12) {
    const h = 0.05 + 0.13 * Math.min(1.0, mouth);
    s.push(
      `<path d="M${f2(mx - 0.16)},${f2(my - 0.02)} Q${f2(mx)},${f2(my - 0.05)} ${f2(mx + 0.16)},${f2(my - 0.02)} Q${f2(mx + 0.14)},${f2(my + h * 1.6)} ${f2(mx)},${f2(my + h * 1.7)} Q${f2(mx - 0.14)},${f2(my + h * 1.6)} ${f2(mx - 0.16)},${f2(my - 0.02)} Z" fill="#4a1f1a" stroke="${ink}" stroke-width="0.05"/>`,
    );
    if (mouth > 0.5) {
      s.push(`<ellipse cx="${f2(mx)}" cy="${f2(my + h * 1.2)}" rx="0.07" ry="${f2(h * 0.4)}" fill="#d86a6a"/>`);
    }
  } else if (face === "happy") {
    // Wide open smile (0.48 wide, deep arc) — clearly bigger than
    // content's small smile (M3): the two used to share one shape.
    s.push(
      `<path d="M${f2(mx - 0.24)},${f2(my - 0.06)} Q${f2(mx - 0.21)},${f2(my - 0.01)} ${f2(mx - 0.17)},${f2(my)} Q${f2(mx)},${f2(my + 0.16)} ${f2(mx + 0.17)},${f2(my)} Q${f2(mx + 0.21)},${f2(my - 0.01)} ${f2(mx + 0.24)},${f2(my - 0.06)}" ${sw}/>`,
    );
  } else if (face === "content") {
    // Small gentle smile (0.36 wide, shallow) — calm, not grinning.
    s.push(
      `<path d="M${f2(mx - 0.18)},${f2(my - 0.02)} Q${f2(mx)},${f2(my + 0.08)} ${f2(mx + 0.18)},${f2(my - 0.02)}" ${sw}/>`,
    );
  } else if (face === "smirk") {
    s.push(`<path d="M${f2(mx - 0.16)},${f2(my + 0.04)} Q${f2(mx + 0.05)},${f2(my + 0.08)} ${f2(mx + 0.2)},${f2(my - 0.06)}" ${sw}/>`);
  } else if (face === "big_smile") {
    s.push(
      `<path d="M${f2(mx - 0.28)},${f2(my - 0.08)} Q${f2(mx)},${f2(my + 0.4)} ${f2(mx + 0.28)},${f2(my - 0.08)} Z" fill="#4a1f1a" stroke="${ink}" stroke-width="0.05"/>` +
        `<path d="M${f2(mx - 0.22)},${f2(my - 0.06)} Q${f2(mx)},${f2(my + 0.02)} ${f2(mx + 0.22)},${f2(my - 0.06)} L${f2(mx + 0.2)},${f2(my - 0.04)} Q${f2(mx)},${f2(my + 0.06)} ${f2(mx - 0.2)},${f2(my - 0.04)} Z" fill="#ffffff"/>` +
        `<ellipse cx="${f2(mx)}" cy="${f2(my + 0.17)}" rx="0.1" ry="0.055" fill="#d86a6a"/>`,
    );
  } else if (face === "sad" || face === "worried") {
    s.push(`<path d="M${f2(mx - 0.18)},${f2(my + 0.07)} Q${f2(mx)},${f2(my - 0.1)} ${f2(mx + 0.18)},${f2(my + 0.07)}" ${sw}/>`);
    // Inner-raised brows: worried raises them steeper than sad, so
    // the two read differently at a glance (M3).
    const innerLift = face === "worried" ? 0.36 : 0.31;
    s.push(
      `<path d="M${f2(e1 - 0.13)},${f2(ey - 0.21)} L${f2(e1 + 0.1)},${f2(ey - innerLift)} M${f2(e2 - 0.1)},${f2(ey - innerLift)} L${f2(e2 + 0.13)},${f2(ey - 0.21)}" ${sw}/>`,
    );
  } else if (face === "angry") {
    s.push(`<path d="M${f2(mx - 0.16)},${f2(my + 0.05)} Q${f2(mx)},${f2(my - 0.03)} ${f2(mx + 0.16)},${f2(my + 0.05)}" ${sw}/>`);
    // Angry brows: thicker (0.09) and a hard V — inner ends driven
    // down, so the glare reads at a glance (M3).
    s.push(
      `<path d="M${f2(e1 - 0.14)},${f2(ey - 0.35)} L${f2(e1 + 0.11)},${f2(ey - 0.19)} M${f2(e2 - 0.11)},${f2(ey - 0.19)} L${f2(e2 + 0.14)},${f2(ey - 0.35)}" stroke="${ink}" stroke-width="0.09" fill="none" stroke-linecap="round"/>`,
    );
  } else if (face === "surprised" || face === "scared" || face === "shocked") {
    s.push(`<ellipse cx="${f2(mx)}" cy="${f2(my + 0.03)}" rx="0.1" ry="0.14" fill="${ink}"/>`);
    if (face === "surprised") {
      // High even arches — the old code drew NO brows for surprised,
      // so it read as blank shock; arches + wide eyes read surprised.
      s.push(
        `<path d="M${f2(e1 - 0.13)},${f2(ey - 0.34)} Q${f2(e1)},${f2(ey - 0.46)} ${f2(e1 + 0.12)},${f2(ey - 0.35)} M${f2(e2 - 0.12)},${f2(ey - 0.35)} Q${f2(e2)},${f2(ey - 0.46)} ${f2(e2 + 0.13)},${f2(ey - 0.34)}" stroke="${ink}" stroke-width="0.06" fill="none" stroke-linecap="round"/>`,
      );
    } else {
      s.push(
        `<path d="M${f2(e1 - 0.13)},${f2(ey - 0.3)} L${f2(e1 + 0.1)},${f2(ey - 0.4)} M${f2(e2 - 0.1)},${f2(ey - 0.4)} L${f2(e2 + 0.13)},${f2(ey - 0.3)}" ${sw}/>`,
      );
    }
  } else if (face === "thinking") {
    s.push(`<path d="M${f2(mx - 0.12)},${f2(my + 0.02)} L${f2(mx + 0.16)},${f2(my - 0.04)}" ${sw}/>`);
    s.push(`<path d="M${f2(e2 - 0.12)},${f2(ey - 0.3)} Q${f2(e2)},${f2(ey - 0.42)} ${f2(e2 + 0.14)},${f2(ey - 0.32)}" ${sw}/>`);
    s.push(`<path d="M${f2(e1 - 0.12)},${f2(ey - 0.24)} L${f2(e1 + 0.1)},${f2(ey - 0.24)}" ${sw}/>`);
  } else if (face === "sleepy") {
    s.push(`<ellipse cx="${f2(mx)}" cy="${f2(my + 0.02)}" rx="0.07" ry="0.06" fill="${ink}"/>`);
  } else {
    // Neutral mouth: dash 0.32 wide at +0.43 below head centre (R5).
    s.push(`<path d="M${f2(mx - 0.16)},${f2(my)} L${f2(mx + 0.16)},${f2(my)}" ${sw}/>`);
  }
  if (face === "scared" || face === "worried" || face === "shocked") {
    s.push(
      `<path d="M${f2(hx - 0.55)},${f2(hy - 0.5)} q-0.08,0.15 0,0.25 q0.08,-0.1 0,-0.25 Z" fill="#7fc4e8" stroke="${ink}" stroke-width="0.04"/>`,
    );
  }
  if (cold) {
    for (const cxo of [e1 - 0.16, e2 + 0.2]) {
      s.push(`<ellipse cx="${f2(cxo)}" cy="${f2(ey + 0.3)}" rx="0.2" ry="0.12" fill="#6fb6ea" opacity="0.7"/>`);
    }
    s.push(
      `<path d="M${f2(mx - 0.24)},${f2(my - 0.07)} h0.5 v0.24 h-0.5 Z" fill="#ffffff" stroke="${ink}" stroke-width="0.06" stroke-linejoin="round"/>` +
        `<path d="M${f2(mx - 0.08)},${f2(my - 0.07)} v0.24 M${f2(mx + 0.09)},${f2(my - 0.07)} v0.24" stroke="${ink}" stroke-width="0.04"/>`,
    );
  }
  return s.join("");
}

/* ------------------------------------------------------------------ */
/* Outfits — ported from ink.py fur_svg / cavedress_svg / top_svg /    */
/* hips_svg. Garments are drawn in upright torso space (hip = (0,0),   */
/* neck = (0,-TORSO)) and rotated by the pose lean by the caller.      */
/* ------------------------------------------------------------------ */

function furSvg(rng: Rng, sit: boolean, color: string, ink: string, ow: number, torso: number): string {
  const dark = shade(color, 0.68);
  const light = shade(color, 1.28);
  const hem = sit ? 0.48 : 0.62;
  const chest = `<path d="M-0.05,${fmt(-torso + 0.05, 2)} L0.42,${fmt(-torso + 0.12, 2)} L0.5,${fmt(-torso + 1.0, 2)} Z" fill="#ffffff" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`;
  const top: Pt[] = [
    [-0.52, -torso + 0.14],
    [-0.2, -torso + 0.2],
    [0.12, -torso + 0.42],
    [0.36, -torso + 0.68],
    [0.55, -torso + 0.98],
  ];
  const hemPts: Pt[] = [];
  for (let i = 0; i < 8; i++) hemPts.push([0.82 - (1.64 * i) / 7, hem + (i % 2 ? 0.04 : 0)]);
  let d = `M${fmt(top[0][0])},${fmt(top[0][1], 2)} ` + scallopPath(top, 0.07, rng);
  d += `Q0.62,-0.6 0.7,-0.05 Q0.78,${fmt(hem * 0.5, 2)} ${fmt(hemPts[0][0])},${fmt(hemPts[0][1], 2)} `;
  d += scallopPath(hemPts, -0.13, rng);
  d += `Q-0.72,${fmt(hem * 0.4, 2)} -0.66,-0.1 Q-0.62,${fmt(-torso * 0.6, 2)} -0.56,${fmt(-torso + 0.45, 2)} Q-0.62,${fmt(-torso + 0.25, 2)} ${fmt(top[0][0])},${fmt(top[0][1], 2)} Z`;
  const body = `<path d="${d}" fill="${color}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`;
  let spots = "";
  for (let i = 0; i < 5; i++) {
    const x = rng.uniform(-0.45, 0.5);
    const y = rng.uniform(-torso + 1.0, hem - 0.25);
    spots += `<ellipse cx="${fmt(x, 2)}" cy="${fmt(y, 2)}" rx="${fmt(rng.uniform(0.1, 0.17), 2)}" ry="${fmt(rng.uniform(0.07, 0.11), 2)}" fill="${dark}" opacity="0.55" transform="rotate(${fmt(rng.uniform(-30, 30), 0)} ${fmt(x, 2)} ${fmt(y, 2)})"/>`;
  }
  let tufts = "";
  for (let i = 0; i < 14; i++) {
    const x = rng.uniform(-0.48, 0.55);
    const y = rng.uniform(-torso + 0.75, hem - 0.12);
    tufts += `M${fmt(x - 0.06, 2)},${fmt(y - 0.08, 2)} Q${fmt(x - 0.02, 2)},${fmt(y, 2)} ${fmt(x, 2)},${fmt(y + 0.06, 2)} Q${fmt(x + 0.02, 2)},${fmt(y, 2)} ${fmt(x + 0.06, 2)},${fmt(y - 0.08, 2)} `;
  }
  let lights = "";
  for (let i = 0; i < 7; i++) {
    const x = rng.uniform(-0.4, 0.45);
    const y = rng.uniform(-torso + 0.7, hem - 0.2);
    lights += `M${fmt(x, 2)},${fmt(y, 2)} q0.04,0.08 0.02,0.16 `;
  }
  const belt =
    `<path d="M-0.68,-0.12 Q0,0.0 0.72,-0.16" stroke="${ink}" stroke-width="0.15" fill="none" stroke-linecap="round"/>` +
    `<path d="M-0.68,-0.12 Q0,0.0 0.72,-0.16" stroke="#c9a46a" stroke-width="0.09" fill="none" stroke-linecap="round"/>` +
    Array.from({ length: 10 }, (_, i) => `<path d="M${fmt(-0.55 + 0.12 * i, 2)},${fmt(-0.11 + 0.008 * i)} l0.05,0.06" stroke="#8a6a3a" stroke-width="0.025"/>`).join("") +
    `<circle cx="0.32" cy="-0.1" r="0.08" fill="#c9a46a" stroke="${ink}" stroke-width="0.05"/>` +
    `<path d="M0.3,-0.04 q-0.02,0.2 0.04,0.32 M0.37,-0.04 q0.06,0.18 0.12,0.28" stroke="${ink}" stroke-width="0.11" fill="none" stroke-linecap="round"/>` +
    `<path d="M0.3,-0.04 q-0.02,0.2 0.04,0.32 M0.37,-0.04 q0.06,0.18 0.12,0.28" stroke="#c9a46a" stroke-width="0.06" fill="none" stroke-linecap="round"/>`;
  return (
    chest +
    body +
    spots +
    `<path d="${tufts}" stroke="${dark}" stroke-width="0.04" fill="none" stroke-linecap="round"/>` +
    `<path d="${lights}" stroke="${light}" stroke-width="0.04" fill="none" stroke-linecap="round"/>` +
    belt
  );
}

function cavedressSvg(rng: Rng, sit: boolean, color: string, ink: string, ow: number, torso: number): string {
  const dark = shade(color, 0.72);
  const hem = sit ? 0.5 : 0.95;
  const hemPts: Pt[] = [];
  for (let i = 0; i < 10; i++) hemPts.push([0.9 - (1.8 * i) / 9, hem + (i % 2 ? 0.03 : 0)]);
  let d =
    `M-0.42,${fmt(-torso + 0.32, 2)} Q0,${fmt(-torso + 0.48, 2)} 0.42,${fmt(-torso + 0.32, 2)} Q0.55,${fmt(-torso + 0.9, 2)} 0.52,-0.45 ` +
    `Q0.7,${fmt(hem * 0.4, 2)} ${fmt(hemPts[0][0])},${fmt(hemPts[0][1], 2)} `;
  d += scallopPath(hemPts, -0.13, rng);
  d += `Q-0.7,${fmt(hem * 0.4, 2)} -0.52,-0.45 Q-0.55,${fmt(-torso + 0.9, 2)} -0.42,${fmt(-torso + 0.32, 2)} Z`;
  const straps =
    `<path d="M-0.36,${fmt(-torso + 0.34, 2)} L-0.3,${fmt(-torso + 0.04, 2)} M0.36,${fmt(-torso + 0.34, 2)} L0.3,${fmt(-torso + 0.04, 2)}" stroke="${ink}" stroke-width="0.15" stroke-linecap="round"/>` +
    `<path d="M-0.36,${fmt(-torso + 0.34, 2)} L-0.3,${fmt(-torso + 0.04, 2)} M0.36,${fmt(-torso + 0.34, 2)} L0.3,${fmt(-torso + 0.04, 2)}" stroke="${color}" stroke-width="0.08" stroke-linecap="round"/>`;
  const chest = `<path d="M-0.42,${fmt(-torso + 0.05, 2)} Q0,${fmt(-torso - 0.02, 2)} 0.42,${fmt(-torso + 0.05, 2)} L0.42,${fmt(-torso + 0.36, 2)} Q0,${fmt(-torso + 0.5, 2)} -0.42,${fmt(-torso + 0.36, 2)} Z" fill="#ffffff" stroke="${ink}" stroke-width="${fmt(ow)}"/>`;
  let tufts = "";
  for (let i = 0; i < 12; i++) {
    const x = rng.uniform(-0.45, 0.5);
    const y = rng.uniform(-torso + 0.7, hem - 0.15);
    tufts += `M${fmt(x - 0.05, 2)},${fmt(y - 0.07, 2)} Q${fmt(x - 0.02, 2)},${fmt(y, 2)} ${fmt(x, 2)},${fmt(y + 0.05, 2)} Q${fmt(x + 0.02, 2)},${fmt(y, 2)} ${fmt(x + 0.05, 2)},${fmt(y - 0.07, 2)} `;
  }
  let shells = "";
  for (let k = 0; k < 5; k++) {
    const x = -0.24 + 0.12 * k;
    const y = -torso + 0.2 + 0.06 * (1 - Math.abs(k - 2) / 2);
    shells += `<path d="M${fmt(x - 0.05, 2)},${fmt(y, 2)} Q${fmt(x, 2)},${fmt(y - 0.09, 2)} ${fmt(x + 0.05, 2)},${fmt(y, 2)} Q${fmt(x, 2)},${fmt(y + 0.08, 2)} ${fmt(x - 0.05, 2)},${fmt(y, 2)} Z" fill="#fbf4e4" stroke="${ink}" stroke-width="0.03"/>`;
  }
  const belt =
    `<path d="M-0.56,-0.3 Q0,-0.2 0.56,-0.32" stroke="${ink}" stroke-width="0.12" fill="none" stroke-linecap="round"/>` +
    `<path d="M-0.56,-0.3 Q0,-0.2 0.56,-0.32" stroke="#d8b77a" stroke-width="0.07" fill="none" stroke-linecap="round"/>` +
    `<path d="M0.38,-0.28 q-0.16,-0.12 -0.18,0.02 q0.02,0.12 0.18,-0.02 q0.16,-0.12 0.18,0.02 q-0.02,0.12 -0.18,-0.02 M0.36,-0.26 l-0.05,0.22 M0.4,-0.26 l0.07,0.2" stroke="${ink}" stroke-width="0.04" fill="#d8b77a"/>`;
  return (
    chest +
    straps +
    `<path d="${d}" fill="${color}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>` +
    `<path d="${tufts}" stroke="${dark}" stroke-width="0.035" fill="none" stroke-linecap="round"/>` +
    `<path d="M0.3,${fmt(-torso + 0.6, 2)} Q0.42,-0.6 0.4,-0.38" stroke="${dark}" stroke-width="0.06" fill="none" opacity="0.6"/>` +
    belt +
    shells
  );
}

function topSvg(o: OutfitDef, sit: boolean, ink: string, ow: number, torso: number): string {
  const T = torso;
  const c = o.top;
  const dk = shade(c, 0.8);
  const col = o.collar;
  const f2 = (n: number): string => fmt(n, 2);
  if (col === "robe" || col === "toga") {
    const L = o.legs === "robe" && !sit ? 1.6 : o.legs === "robe_short" && !sit ? 0.75 : 0.45;
    let body =
      `<path d="M-0.5,${f2(-T + 0.12)} Q0,${f2(-T - 0.02)} 0.5,${f2(-T + 0.12)} L0.62,-0.2 Q0.75,${f2(L * 0.5)} 1.0,${f2(L)} ` +
      `Q0,${f2(L + 0.16)} -1.0,${f2(L)} Q-0.75,${f2(L * 0.5)} -0.62,-0.2 Z" fill="${c}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>` +
      `<path d="M0.25,${f2(-T + 0.4)} Q0.45,-0.4 0.55,${f2(L - 0.1)} M-0.2,0.2 Q-0.35,${f2(L * 0.6)} -0.5,${f2(L - 0.05)}" stroke="${dk}" stroke-width="0.05" fill="none"/>` +
      `<path d="M-0.64,-0.25 Q0,-0.1 0.66,-0.25" stroke="#7a5a2a" stroke-width="0.11" fill="none"/>`;
    if (col === "toga") {
      body += `<path d="M-0.45,${f2(-T + 0.15)} Q0.2,${f2(-T + 0.9)} 0.7,-0.2" stroke="#a8322b" stroke-width="0.2" fill="none" stroke-linecap="round"/>`;
    }
    return body + torsoShade(c, T, L, 1.0);
  }
  const hem = col !== "coat" && col !== "tunic" ? 0.18 : !sit ? 0.75 : 0.35;
  const flare = col !== "coat" && col !== "tunic" ? 0.58 : 0.72;
  let body =
    `<path d="M-0.5,${f2(-T + 0.1)} Q0,${f2(-T - 0.04)} 0.5,${f2(-T + 0.1)} Q0.6,${f2(-T + 0.3)} 0.56,-0.6 L${f2(flare)},${f2(hem)} ` +
    `Q0,${f2(hem + 0.08)} -${f2(flare)},${f2(hem)} L-0.56,-0.6 Q-0.6,${f2(-T + 0.3)} -0.5,${f2(-T + 0.1)} Z" fill="${c}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>` +
    `<path d="M0.3,${f2(-T + 0.5)} Q0.4,-0.6 0.42,${f2(hem - 0.08)}" stroke="${dk}" stroke-width="0.07" fill="none" opacity="0.7"/>` +
    `<path d="M-0.2,-0.35 q0.1,0.1 0.25,0.05 M0.05,-0.55 q0.12,0.08 0.25,0" stroke="${dk}" stroke-width="0.04" fill="none"/>`;
  if (col === "crew") {
    body += `<path d="M-0.22,${f2(-T + 0.06)} Q0,${f2(-T + 0.24)} 0.22,${f2(-T + 0.06)}" stroke="${ink}" stroke-width="0.05" fill="#ffffff"/>`;
  } else if (col === "vneck") {
    body += `<path d="M-0.2,${f2(-T + 0.06)} L0,${f2(-T + 0.42)} L0.2,${f2(-T + 0.06)}" stroke="${ink}" stroke-width="0.05" fill="#ffffff"/>`;
  } else if (col === "suit") {
    body +=
      `<path d="M-0.2,${f2(-T + 0.06)} L0,${f2(-T + 0.75)} L0.2,${f2(-T + 0.06)} Z" fill="#ffffff" stroke="${ink}" stroke-width="0.04"/>` +
      `<path d="M0,${f2(-T + 0.12)} L-0.08,${f2(-T + 0.3)} L0,${f2(-T + 0.85)} L0.08,${f2(-T + 0.3)} Z" fill="#b5332b" stroke="${ink}" stroke-width="0.03"/>` +
      `<path d="M-0.2,${f2(-T + 0.06)} L-0.05,${f2(-T + 0.85)} M0.2,${f2(-T + 0.06)} L0.05,${f2(-T + 0.85)}" stroke="${ink}" stroke-width="0.05"/>` +
      `<circle cx="0.06" cy="-0.5" r="0.04" fill="${ink}"/><circle cx="0.06" cy="-0.2" r="0.04" fill="${ink}"/>`;
  } else if (col === "hood") {
    body +=
      `<path d="M-0.55,${f2(-T + 0.15)} Q-0.8,${f2(-T - 0.25)} -0.3,${f2(-T - 0.15)} Q0,${f2(-T + 0.15)} 0.25,${f2(-T + 0.0)}" stroke="${ink}" stroke-width="0.05" fill="${dk}"/>` +
      `<path d="M-0.05,${f2(-T + 0.2)} l-0.03,0.45 M0.1,${f2(-T + 0.2)} l0.02,0.45" stroke="#e8e8e8" stroke-width="0.04"/>` +
      `<path d="M-0.3,-0.55 h0.6 v0.35 h-0.6 Z" fill="none" stroke="${dk}" stroke-width="0.05"/>`;
  } else if (col === "safari") {
    body +=
      `<path d="M-0.25,${f2(-T + 0.05)} L-0.05,${f2(-T + 0.35)} L0,${f2(-T + 0.08)} L0.05,${f2(-T + 0.35)} L0.25,${f2(-T + 0.05)}" stroke="${ink}" stroke-width="0.05" fill="${dk}"/>` +
      `<rect x="0.12" y="${f2(-T + 0.55)}" width="0.28" height="0.26" fill="none" stroke="${dk}" stroke-width="0.05"/>` +
      `<path d="M0,${f2(-T + 0.35)} V0.1" stroke="${dk}" stroke-width="0.04"/><path d="M-0.56,-0.05 Q0,0.05 0.56,-0.05" stroke="#6a4a2a" stroke-width="0.1" fill="none"/>`;
  } else if (col === "coat") {
    body +=
      `<path d="M-0.18,${f2(-T + 0.06)} L0,${f2(-T + 0.5)} L0.18,${f2(-T + 0.06)}" stroke="${ink}" stroke-width="0.05" fill="#8fb8e0"/>` +
      `<path d="M0,${f2(-T + 0.5)} V${f2(hem)}" stroke="${ink}" stroke-width="0.04"/><rect x="0.2" y="${f2(-T + 0.7)}" width="0.25" height="0.22" fill="none" stroke="${dk}" stroke-width="0.04"/>`;
  } else if (col === "tunic") {
    body += `<path d="M-0.62,-0.1 Q0,0.02 0.62,-0.1" stroke="#c9a640" stroke-width="0.11" fill="none"/><path d="M-0.18,${f2(-T + 0.06)} Q0,${f2(-T + 0.3)} 0.18,${f2(-T + 0.06)}" stroke="${ink}" stroke-width="0.05" fill="#e9d9b0"/>`;
  } else if (col === "armor") {
    body += Array.from({ length: 5 }, (_, i) => `<path d="M-0.55,${f2(-T + 0.4 + 0.28 * i)} Q0,${f2(-T + 0.5 + 0.28 * i)} 0.55,${f2(-T + 0.4 + 0.28 * i)}" stroke="${ink}" stroke-width="0.05" fill="none"/>`).join("");
  }
  return body + torsoShade(c, T, hem);
}

function hipsSvg(o: OutfitDef, ink: string, ow: number): string {
  if (!o.pants || (o.legs !== "long" && o.legs !== "shorts" && o.legs !== "tunic")) return "";
  const c = o.pants;
  if (o.legs === "tunic") {
    return `<path d="M-0.6,-0.25 L0.62,-0.25 L0.8,0.7 Q0,0.82 -0.8,0.7 Z" fill="${c}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`;
  }
  return `<path d="M-0.55,-0.3 L0.56,-0.3 L0.48,0.25 Q0,0.4 -0.48,0.25 Z" fill="${c}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>`;
}

/* ------------------------------------------------------------------ */
/* Held props — ported from ink.py prop_svg().                          */
/* ------------------------------------------------------------------ */

export function propSvg(name: PropName, angle: number, ink: string, ow: number): string {
  const f2 = (n: number): string => fmt(n, 2);
  let g = `<g transform="rotate(${fmt(angle, 1)})">`;
  switch (name) {
    case "none":
      return "";
    case "spear":
      g +=
        `<path d="M0,1.8 L0,-4.4" stroke="${ink}" stroke-width="0.26" stroke-linecap="round"/>` +
        `<path d="M0,1.8 L0,-4.4" stroke="#8a5d34" stroke-width="0.15" stroke-linecap="round"/>` +
        `<path d="M-0.36,-4.35 L0,-5.75 L0.36,-4.35 Q0,-4.1 -0.36,-4.35 Z" fill="#9b9890" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>` +
        `<path d="M0,-5.5 L0,-4.4 M-0.18,-5.0 L0,-4.8 M0.18,-5.0 L0,-4.8" stroke="#6f6c66" stroke-width="0.04"/>` +
        `<path d="M-0.2,-4.3 L0.2,-4.1 M-0.2,-4.1 L0.2,-3.9 M-0.2,-3.9 L0.2,-3.7" stroke="#4a2d18" stroke-width="0.07"/>`;
      break;
    case "stick":
    case "staff":
      g +=
        `<path d="M0,2.5 Q0.08,0 0.02,-2.4" stroke="${ink}" stroke-width="0.25" fill="none" stroke-linecap="round"/>` +
        `<path d="M0,2.5 Q0.08,0 0.02,-2.4" stroke="#8a5d34" stroke-width="0.14" fill="none" stroke-linecap="round"/>`;
      break;
    case "torch":
      g +=
        `<path d="M0,1.2 L0,-1.3" stroke="${ink}" stroke-width="0.3" stroke-linecap="round"/><path d="M0,1.2 L0,-1.3" stroke="#8a5d34" stroke-width="0.18"/>` +
        `<path d="M0,-1.2 C-0.7,-1.7 -0.35,-2.5 -0.1,-3.1 C0,-2.6 0.25,-2.7 0.3,-3.0 C0.7,-2.3 0.6,-1.6 0,-1.2 Z" fill="#f07b1e" stroke="#a8401a" stroke-width="0.05"/>` +
        `<path d="M0,-1.4 C-0.3,-1.7 -0.15,-2.1 0,-2.35 C0.15,-2.1 0.3,-1.7 0,-1.4 Z" fill="#f9c440"/>`;
      break;
    case "notebook":
      g +=
        `<rect x="-0.45" y="-0.95" width="0.9" height="1.2" rx="0.08" fill="#9b6b43" stroke="${ink}" stroke-width="${fmt(ow)}"/>` +
        `<rect x="-0.33" y="-0.8" width="0.66" height="0.9" fill="#f6efdc"/>` +
        `<path d="M-0.25,-0.6 h0.5 M-0.25,-0.4 h0.4 M-0.25,-0.2 h0.5" stroke="#8a7a5a" stroke-width="0.04"/>`;
      break;
    case "phone":
      g +=
        `<rect x="-0.33" y="-1.05" width="0.66" height="1.18" rx="0.11" fill="#2d2d33" stroke="${ink}" stroke-width="${fmt(ow)}"/>` +
        `<rect x="-0.25" y="-0.95" width="0.5" height="0.95" rx="0.05" fill="#8fd0f0"/>` +
        `<path d="M-0.18,-0.8 h0.3 M-0.18,-0.6 h0.36 M-0.18,-0.4 h0.22" stroke="#ffffff" stroke-width="0.05"/>`;
      break;
    case "shovel":
      g +=
        `<path d="M0,-2.4 L0,1.9" stroke="${ink}" stroke-width="0.24" stroke-linecap="round"/><path d="M0,-2.4 L0,1.9" stroke="#8a5d34" stroke-width="0.13"/>` +
        `<path d="M-0.35,-2.4 h0.7" stroke="${ink}" stroke-width="0.15" stroke-linecap="round"/>` +
        `<path d="M-0.42,1.8 L0.42,1.8 L0.32,2.65 Q0,3.0 -0.32,2.65 Z" fill="#a3a39e" stroke="${ink}" stroke-width="${fmt(ow)}"/>`;
      break;
    case "scroll":
      g +=
        `<rect x="-0.75" y="-1.35" width="1.5" height="2.0" fill="#f3e6c4" stroke="${ink}" stroke-width="${fmt(ow)}"/>` +
        `<rect x="-0.85" y="-1.45" width="1.7" height="0.2" rx="0.1" fill="#d8c290" stroke="${ink}" stroke-width="0.05"/>` +
        `<path d="M-0.55,-0.95 h1.05 M-0.55,-0.65 h0.85 M-0.55,-0.35 h1.05 M-0.55,-0.05 h0.75 M-0.55,0.25 h0.95" stroke="#8a7a5a" stroke-width="0.06"/>`;
      break;
    case "fish":
      g +=
        `<path d="M-0.95,0.2 Q-0.2,-0.5 0.6,0.2 Q-0.2,0.9 -0.95,0.2 Z M0.6,0.2 L1.05,-0.2 L1.05,0.6 Z" fill="#8fa9b8" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>` +
        `<circle cx="-0.6" cy="0.1" r="0.07" fill="${ink}"/>`;
      break;
    case "meat":
      g +=
        `<path d="M-0.2,-0.2 C-0.9,-0.6 -1.1,0.5 -0.4,0.6 C0,0.7 0.3,0.3 0.2,0.0 Z" fill="#9b4a35" stroke="${ink}" stroke-width="${fmt(ow)}"/>` +
        `<path d="M0.15,0 L0.75,-0.55" stroke="#f3ead8" stroke-width="0.18" stroke-linecap="round"/>` +
        `<circle cx="0.8" cy="-0.6" r="0.13" fill="#f3ead8" stroke="${ink}" stroke-width="0.05"/>`;
      break;
    case "book":
      g +=
        `<path d="M0,-0.7 L-0.9,-0.9 L-0.9,0.4 L0,0.6 L0.9,0.4 L0.9,-0.9 Z" fill="#f6efdc" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/>` +
        `<path d="M0,-0.7 L0,0.6" stroke="${ink}" stroke-width="0.05"/>`;
      break;
    case "coin":
      g += `<circle r="0.35" fill="#f2c230" stroke="${ink}" stroke-width="${fmt(ow)}"/><path d="M0,-0.18 v0.36" stroke="#b08a1a" stroke-width="0.06"/>`;
      break;
    case "sword":
      g +=
        `<path d="M0,-0.3 L0,-3.6" stroke="#c9ccd1" stroke-width="0.22" stroke-linecap="round"/><path d="M0,-0.3 L0,-3.6" stroke="${ink}" stroke-width="0.04"/>` +
        `<path d="M-0.45,-0.3 h0.9" stroke="#8a6a2a" stroke-width="0.16" stroke-linecap="round"/><path d="M0,-0.25 L0,0.5" stroke="#5a3a20" stroke-width="0.16"/>`;
      break;
    default: {
      const exhaustive: never = name;
      throw new Error(`renderer: unknown prop "${String(exhaustive)}"`);
    }
  }
  void f2;
  return g + "</g>";
}

/* ------------------------------------------------------------------ */
/* Skeleton — the forward-kinematics result shared by the renderer,    */
/* the pose-matrix test and the visual pose editor. One source of      */
/* truth: if the renderer and the editor disagreed about where a hand  */
/* is, drag targets would land in the wrong place.                     */
/* ------------------------------------------------------------------ */

export interface Skeleton {
  /** Total torso lean in degrees (pose lean + character lean). */
  lean: number;
  kind: PoseKind;
  /** True when the pose draws both arms behind the head. */
  behind: boolean;
  hip: Pt;
  neck: Pt;
  head: Pt;
  shoulder: Pt;
  backArm: { knee: Pt; end: Pt };
  frontArm: { knee: Pt; end: Pt };
  backLeg: { knee: Pt; end: Pt };
  frontLeg: { knee: Pt; end: Pt };
  /** Ground y in character units (max of the anchor keys). */
  ground: number;
  /** Anchor keys after the lie rotation — used for the ground shadow. */
  anchorKeys: Pt[];
}

export function computeSkeleton(c: Character): Skeleton {
  const pose = POSES[c.pose];
  if (!pose) throw new Error(`renderer: unknown pose "${c.pose}"`);
  const torso = c.proportions.torso;
  const lean = pose.lean + c.lean;
  const backArm: LimbAngles = c.backArm ?? pose.backArm;
  const frontArm: LimbAngles = c.frontArm ?? pose.frontArm;
  const backLeg: LimbAngles = c.backLeg ?? pose.backLeg;
  const frontLeg: LimbAngles = c.frontLeg ?? pose.frontLeg;
  const lr = (lean * Math.PI) / 180;
  const hip: Pt = [0, 0];
  const neck: Pt = [torso * Math.sin(lr), -torso * Math.cos(lr)];
  const head: Pt = [neck[0] + 0.98 * Math.sin(lr), neck[1] - 0.98 * Math.cos(lr)];
  const shoulder: Pt = [neck[0] - 0.3 * Math.sin(lr), neck[1] + 0.3 * Math.cos(lr)];
  const backArmL = limb(shoulder[0], shoulder[1], c.proportions.upperArm, c.proportions.lowerArm, backArm[0], backArm[1]);
  const frontArmL = limb(shoulder[0], shoulder[1], c.proportions.upperArm, c.proportions.lowerArm, frontArm[0], frontArm[1]);
  const backLegL = limb(hip[0], hip[1], c.proportions.upperLeg, c.proportions.lowerLeg, backLeg[0], backLeg[1]);
  const frontLegL = limb(hip[0], hip[1], c.proportions.upperLeg, c.proportions.lowerLeg, frontLeg[0], frontLeg[1]);
  const [hx, hy] = head;
  // ---- anchoring to the ground (same keys as the renderer)
  const rot = pose.kind === "lie" ? -90 : 0;
  const rp = (p: Pt): Pt => {
    if (!rot) return p;
    const a = (rot * Math.PI) / 180;
    return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
  };
  let keys: Pt[] = [
    [backLegL.end[0] + 0.17, backLegL.end[1] + 0.14],
    [frontLegL.end[0] + 0.17, frontLegL.end[1] + 0.14],
  ];
  if (pose.kind === "sit") keys.push([0.0, 0.32]);
  if (pose.kind === "lie") {
    keys = keys.concat([
      [hx - 1.0, hy],
      [hx, hy - 1.0],
      [hx, hy + 1.0],
      [hx + 1.0, hy],
      [0, -0.4],
      [0, 0.4],
    ]);
    keys = keys.map(rp);
  }
  const ground = Math.max(...keys.map((k) => k[1]));
  return {
    lean,
    kind: pose.kind,
    behind: pose.armsBehindHead,
    hip,
    neck,
    head,
    shoulder,
    backArm: backArmL,
    frontArm: frontArmL,
    backLeg: backLegL,
    frontLeg: frontLegL,
    ground,
    anchorKeys: keys,
  };
}

export interface CharacterJoints {
  head: Pt;
  neck: Pt;
  hip: Pt;
  shoulder: Pt;
  backElbow: Pt;
  backHand: Pt;
  frontElbow: Pt;
  frontHand: Pt;
  backKnee: Pt;
  backFoot: Pt;
  frontKnee: Pt;
  frontFoot: Pt;
  ground: number;
}

/**
 * Joint positions in SVG user space — the coordinate space inside the
 * <svg> element produced by renderCharacterSvg (after the outer <g>
 * transform, before viewBox scaling). The pose editor overlays its
 * drag handles at these points; a pointer in SVG user space maps back
 * with jointsToCharacterSpace().
 */
export function characterJoints(c: Character): CharacterJoints {
  const sk = computeSkeleton(c);
  const rot = sk.kind === "lie" ? -90 : 0;
  const d = c.facing === "left" ? -1 : 1;
  const s = c.scale;
  const map = (p: Pt): Pt => {
    let q = p;
    if (rot) {
      const a = (rot * Math.PI) / 180;
      q = [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];
    }
    return [s * d * q[0], s * (q[1] - sk.ground)];
  };
  return {
    head: map(sk.head),
    neck: map(sk.neck),
    hip: map(sk.hip),
    shoulder: map(sk.shoulder),
    backElbow: map(sk.backArm.knee),
    backHand: map(sk.backArm.end),
    frontElbow: map(sk.frontArm.knee),
    frontHand: map(sk.frontArm.end),
    backKnee: map(sk.backLeg.knee),
    backFoot: map(sk.backLeg.end),
    frontKnee: map(sk.frontLeg.knee),
    frontFoot: map(sk.frontLeg.end),
    ground: 0,
  };
}

/**
 * Inverse of the characterJoints map: an SVG-user-space point back to
 * character space (the space limb() works in, hip at the origin).
 * Used by the pose editor to turn a dragged handle position into new
 * limb angles via limbAnglesForPoint().
 */
export function jointsToCharacterSpace(c: Character, p: Pt): Pt {
  const sk = computeSkeleton(c);
  const rot = sk.kind === "lie" ? -90 : 0;
  const d = c.facing === "left" ? -1 : 1;
  const s = c.scale;
  let q: Pt = [p[0] / (s * d), p[1] / s + sk.ground];
  if (rot) {
    const a = (-rot * Math.PI) / 180;
    q = [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];
  }
  return q;
}

/**
 * Two-bone limb angles that put a limb's end at `target`.
 * Proper two-bone IK: the upper limb leaves the joint at
 * (target direction ± alpha), where alpha comes from the law of
 * cosines, and the lower limb bends from the elbow toward the target.
 * `bend` picks the elbow side: -1 for arms (elbows bend back toward
 * the body, as in every pose in the table), +1 for legs (knees bend
 * forward). Always returns valid angles; beyond reach the limb points
 * straight at the target at full extension. Angles are degrees from
 * straight down (+y), matching limb().
 */
export function limbAnglesForPoint(
  start: Pt,
  upper: number,
  lower: number,
  target: Pt,
  bend: 1 | -1 = -1,
): [number, number] {
  const dx = target[0] - start[0];
  const dy = target[1] - start[1];
  const phi = (Math.atan2(dx, dy) * 180) / Math.PI;
  const d = Math.hypot(dx, dy);
  // Beyond reach: point straight at the target at full extension.
  if (d >= upper + lower) return [phi, 0];
  const clamped = Math.max(Math.abs(upper - lower) + 0.001, Math.min(upper + lower - 0.001, d));
  const cosA = (upper * upper + clamped * clamped - lower * lower) / (2 * upper * clamped);
  const alpha = (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180) / Math.PI;
  const a1 = phi + bend * alpha;
  const elbow = limb(start[0], start[1], upper, lower, a1, 0).knee;
  const total = (Math.atan2(target[0] - elbow[0], target[1] - elbow[1]) * 180) / Math.PI;
  let a2 = total - a1;
  a2 = ((a2 + 540) % 360) - 180;
  return [a1, a2];
}

/* ------------------------------------------------------------------ */
/* character() — ported from ink.py. Assembles the parts in z-order.   */
/* Returns the inner <g> content (no <svg> wrapper, no defs).          */
/* Coordinates are in character units (head radius = 1); the caller     */
/* wraps this in an <svg> with the hand filter applied.                */
/* ------------------------------------------------------------------ */

export interface CharacterRenderOpts {
  /** Anchor point in the outer SVG's user units. */
  x?: number;
  y?: number;
}

/** Hand shapes (M3 drawing). */
export type HandKind = "open" | "fist" | "grip";

/**
 * Poses whose (empty) hand reads as an open palm: pointing, waving,
 * cheering, holding something up, shrugging, aiming. Every other pose
 * gets a simple fist; a hand gripping a held prop gets the grip shape.
 */
const OPEN_HAND_POSES: ReadonlySet<PoseName> = new Set([
  "point",
  "wave",
  "cheer",
  "hold",
  "hold_up",
  "shrug",
  "aim",
]);

export function characterSvg(c: Character, rng: Rng, opts: CharacterRenderOpts = {}): string {
  const sk = computeSkeleton(c);
  const ink = c.style.ink;
  const ow = c.style.outlineWidth;
  const lw = c.style.limbWidth;
  const torso = c.proportions.torso;
  const headR = c.proportions.headRadius;

  const lean = sk.lean;
  const kind = sk.kind;
  const behind = sk.behind;
  const hip = sk.hip;
  const head = sk.head;
  const sh = sk.shoulder;
  const backArmL = sk.backArm;
  const frontArmL = sk.frontArm;
  const backLegL = sk.backLeg;
  const frontLegL = sk.frontLeg;
  const [hx, hy] = head;

  // Skin setting (R8, style guide): white for night scenes, tan for
  // day scenes, silhouette for distant/scale shots. A silhouette
  // draws the face in white ink on a dark head, with black hair.
  const skin = c.style.skin;
  const skinFill = skin === "tan" ? "#f2e3c8" : skin === "silhouette" ? "#211c19" : "#ffffff";
  const skinShade = skin === "tan" ? "#e0cda6" : skin === "silhouette" ? "#211c19" : "#e9e4dc";
  const faceInk = skin === "silhouette" ? "#ffffff" : ink;
  const hairColor = skin === "silhouette" ? "black" : c.hair.color;

  const outfitName: OutfitName = c.outfit.outfit;
  const o: OutfitDef | null =
    outfitName === "none" || outfitName === "caveman" || outfitName === "cavedress"
      ? null
      : (OUTFITS as Record<string, OutfitDef>)[outfitName] ?? null;
  if (outfitName !== "none" && outfitName !== "caveman" && outfitName !== "cavedress" && !o) {
    throw new Error(`renderer: unknown outfit "${outfitName}"`);
  }
  const hold = c.outfit.hold;
  const handSide = c.outfit.holdHand;
  const sit = kind === "sit";
  const line = `stroke="${ink}" stroke-width="${fmt(lw)}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  let shoe = o ? o.shoes : "#ffffff";
  if (!c.outfit.shoes) shoe = "#ffffff";
  if (outfitName === "caveman") shoe = c.outfit.furBoots ? "#8a6a44" : "#ffffff";
  if (c.outfit.shoeColor) shoe = c.outfit.shoeColor;

  const limbPath = (a: Pt, k: Pt, b: Pt, w = 1.0): string => {
    // Rounded at the joint (M3): the two segments meet through a
    // small quadratic so elbows/knees bend smoothly instead of
    // kinking. Endpoints and the joint position are unchanged, and
    // the old upper/lower taper is kept.
    const { p1, p2 } = cornerPoints(a, k, b);
    return (
      `<path d="M${fmt(a[0])},${fmt(a[1])} L${fmt(p1[0])},${fmt(p1[1])}" stroke="${ink}" stroke-width="${fmt(lw * 1.12 * w)}" fill="none" stroke-linecap="round"/>` +
      `<path d="M${fmt(p1[0])},${fmt(p1[1])} Q${fmt(k[0])},${fmt(k[1])} ${fmt(p2[0])},${fmt(p2[1])} L${fmt(b[0])},${fmt(b[1])}" stroke="${ink}" stroke-width="${fmt(lw * 0.92 * w)}" fill="none" stroke-linecap="round" data-limb="true"/>` +
      `<circle cx="${fmt(k[0])}" cy="${fmt(k[1])}" r="${fmt(lw * 0.52 * w)}" fill="${ink}"/>`
    );
  };

  const foot = (knee: Pt, ank: Pt): string => {
    let ang = (Math.atan2(ank[1] - knee[1], ank[0] - knee[0]) * 180) / Math.PI - 90;
    ang = kind === "feet" ? Math.max(-35, Math.min(35, ang)) : ang * 0.6;
    return (
      `<g transform="translate(${fmt(ank[0])},${fmt(ank[1])}) rotate(${fmt(ang, 1)})">` +
      `<path d="M-0.12,0.13 Q-0.14,-0.14 0.12,-0.12 Q0.42,-0.08 0.45,0.08 Q0.44,0.16 0.3,0.17 L-0.08,0.17 Q-0.12,0.16 -0.12,0.13 Z" ` +
      `fill="${shoe}" stroke="${ink}" stroke-width="${fmt(ow)}" stroke-linejoin="round"/></g>`
    );
  };

  const hand = (pt: Pt, kind: HandKind, elbow: Pt | null): string => {
    if (elbow === null) {
      return `<circle cx="${fmt(pt[0])}" cy="${fmt(pt[1])}" r="0.13" fill="#ffffff" stroke="${ink}" stroke-width="0.06" data-hand="dot"/>`;
    }
    // Local +y points along the limb past the wrist; the group
    // rotates with the limb angle, so the hand always attaches to
    // the limb endpoint pointing the right way.
    const ang = (Math.atan2(pt[1] - elbow[1], pt[0] - elbow[0]) * 180) / Math.PI - 90;
    const open = `<g transform="translate(${fmt(pt[0])},${fmt(pt[1])}) rotate(${fmt(ang, 1)})" data-hand="open">`;
    if (kind === "open") {
      // Open palm: a rounded palm with three finger bumps on the far
      // edge and a thumb hint — reads as a hand, not a tube end.
      return (
        open +
        `<path d="M-0.14,-0.05 Q-0.18,0.12 -0.14,0.2 Q-0.1,0.3 -0.05,0.23 Q0,0.31 0.05,0.23 Q0.1,0.3 0.14,0.2 Q0.18,0.12 0.14,-0.05 Q0,-0.11 -0.14,-0.05 Z" fill="#ffffff" stroke="${ink}" stroke-width="0.055" stroke-linejoin="round"/>` +
        `<path d="M0.15,0.04 Q0.25,0.07 0.21,0.17" fill="none" stroke="${ink}" stroke-width="0.045" stroke-linecap="round"/></g>`
      );
    }
    if (kind === "grip") {
      // Fist curled around a held prop.
      return (
        `<g transform="translate(${fmt(pt[0])},${fmt(pt[1])}) rotate(${fmt(ang, 1)})" data-hand="grip">` +
        `<ellipse cx="0" cy="0.02" rx="0.15" ry="0.16" fill="#ffffff" stroke="${ink}" stroke-width="0.06"/>` +
        `<path d="M0.12,-0.04 q0.1,0.02 0.07,0.12" stroke="${ink}" stroke-width="0.045" fill="none" stroke-linecap="round"/></g>`
      );
    }
    // Simple fist: a rounded blob with a knuckle curl line.
    return (
      `<g transform="translate(${fmt(pt[0])},${fmt(pt[1])}) rotate(${fmt(ang, 1)})" data-hand="fist">` +
      `<path d="M-0.12,-0.04 Q-0.16,0.14 -0.08,0.2 Q0,0.25 0.08,0.2 Q0.16,0.14 0.12,-0.04 Q0,-0.1 -0.12,-0.04 Z" fill="#ffffff" stroke="${ink}" stroke-width="0.055" stroke-linejoin="round"/>` +
      `<path d="M-0.05,0.08 Q0.02,0.12 0.08,0.06" fill="none" stroke="${ink}" stroke-width="0.04" stroke-linecap="round"/></g>`
    );
  };

  const sleeve = (s_: Pt, k: Pt, h: Pt): string => {
    if (!o || o.sleeve === "none") return "";
    if (o.sleeve === "short") return tube([s_, partWay(s_, k, 0.75)], 0.34, o.top, ink, ow);
    return tube([s_, k, partWay(k, h, 0.85)], 0.3, o.top, ink, ow);
  };

  const trouser = (k: Pt, f: Pt): string => {
    if (!o || !o.pants) return "";
    // Wardrobe legs override (null = the outfit's own legs).
    const legsKind = c.outfit.legsOverride ?? o.legs;
    if (legsKind === "long") return tube([hip, k, partWay(k, f, 0.93)], 0.36, o.pants, ink, ow);
    if (legsKind === "shorts") return tube([hip, partWay(hip, k, 0.8)], 0.42, o.pants, ink, ow);
    return "";
  };

  const arm = (s_: Pt, k: Pt, h: Pt, handKind: HandKind): string =>
    limbPath(s_, k, h) + sleeve(s_, k, h) + hand(h, handKind, k);

  const leg = (k: Pt, f: Pt): string => limbPath(hip, k, f, 1.08) + trouser(k, f) + foot(k, f);

  const propAt = (pt: Pt): string =>
    `<g transform="translate(${fmt(pt[0])},${fmt(pt[1])})">${propSvg(hold, c.outfit.holdAngle, ink, ow)}</g>`;

  const frontArmHolding = hold !== "none" && handSide === "front";
  const frontHandKind: HandKind = frontArmHolding
    ? "grip"
    : OPEN_HAND_POSES.has(c.pose)
      ? "open"
      : "fist";
  const backHandKind: HandKind =
    hold !== "none" && handSide === "back" ? "grip" : c.pose === "cheer" ? "open" : "fist";
  const frontArmEl = arm(sh, frontArmL.knee, frontArmL.end, frontHandKind);
  // Hanging-arm rule (M1, 2026-11-05): with a sleeveless garment
  // (caveman fur, cavedress, toga) a front arm hanging straight down
  // draws as a thin diagonal line across the whole garment — it reads
  // as a scratch, not a limb (QA 2026-11-05). Sleeved outfits keep
  // the arm in front: the sleeve tube already reads as an arm. So a
  // hanging, empty, sleeveless front arm goes behind the garment with
  // the back arm; raised / pointing / holding arms stay in front.
  const frontArmBehind =
    !behind &&
    (!o || o.sleeve === "none") &&
    outfitName !== "none" &&
    !frontArmHolding &&
    frontArmL.end[1] > 0;

  const parts: string[] = [hairBackSvg(hx, hy, c.hair.style, hairColor, ink, ow)];
  if (!behind) parts.push(arm(sh, backArmL.knee, backArmL.end, backHandKind));
  if (frontArmBehind) parts.push(frontArmEl);
  if (hold !== "none" && handSide === "back") parts.push(propAt(backArmL.end));
  parts.push(leg(backLegL.knee, backLegL.end));
  parts.push(leg(frontLegL.knee, frontLegL.end));
  // torso garment, upright space rotated by lean
  let tor = `<path d="M0,0 L0,${fmt(-torso)}" ${line}/>`;
  if (outfitName === "caveman") {
    tor = furSvg(rng, sit, c.outfit.furColor, ink, ow, torso);
  } else if (outfitName === "cavedress") {
    tor = cavedressSvg(rng, sit, c.outfit.furColor, ink, ow, torso);
  } else if (o) {
    tor = hipsSvg(o, ink, ow) + topSvg(o, sit, ink, ow, torso);
  }
  if (c.outfit.accessory === "scarf") {
    // Scarf in torso space: a band across the neck + a tail down the
    // chest. Drawn inside the torso group so it leans with the body;
    // the head circle (drawn later) covers its top edge, so it peeks
    // out from under the chin like a real scarf.
    const sc = c.outfit.accessoryColor;
    tor +=
      `<path d="M-0.48,${fmt(-torso + 0.05)} Q0,${fmt(-torso - 0.12)} 0.48,${fmt(-torso + 0.05)} L0.48,${fmt(-torso + 0.22)} Q0,${fmt(-torso + 0.05)} -0.48,${fmt(-torso + 0.22)} Z" fill="${sc}" stroke="${ink}" stroke-width="${fmt(ow)}"/>` +
      `<path d="M0.18,${fmt(-torso + 0.15)} Q0.32,${fmt(-torso + 0.55)} 0.24,${fmt(-torso + 0.95)} Q0.14,${fmt(-torso + 0.6)} 0.05,${fmt(-torso + 0.18)} Z" fill="${sc}" stroke="${ink}" stroke-width="${fmt(ow)}"/>`;
  }
  parts.push(`<g transform="rotate(${fmt(lean, 1)})">${tor}</g>`);
  if (behind) {
    parts.push(`<path d="${roundedPolyline([sh, backArmL.knee, backArmL.end])}" ${line}/>` + sleeve(sh, backArmL.knee, backArmL.end));
    parts.push(`<path d="${roundedPolyline([sh, frontArmL.knee, frontArmL.end])}" ${line}/>` + sleeve(sh, frontArmL.knee, frontArmL.end));
  }
  // head
  const hair = c.hair.style;
  const hcol = hairColor;
  // Head (R2): slightly wider than tall, 1.11 : 1 — an ellipse, not
  // a circle. rx = headR * 1.055, ry = headR * 0.95. The shade
  // crescent scales with it. Hair/hats anchor on (hx, hy) and overlap
  // the crown, so the 0.05 vertical change does not float them.
  const headRx = headR * 1.055;
  const headRy = headR * 0.95;
  parts.push(`<ellipse cx="${fmt(hx)}" cy="${fmt(hy)}" rx="${fmt(headRx)}" ry="${fmt(headRy)}" fill="${skinFill}"/>`);
  parts.push(
    `<path d="M${fmt(hx - headRx * 0.97)},${fmt(hy + headRy * 0.1)} A${fmt(headRx)},${fmt(headRy)} 0 0,0 ${fmt(hx + headRx * 0.35)},${fmt(hy + headRy * 0.94)} A${fmt(headRx * 1.05)},${fmt(headRy * 1.05)} 0 0,1 ${fmt(hx - headRx * 0.97)},${fmt(hy + headRy * 0.1)} Z" fill="${skinShade}"/>`,
  );
  parts.push(`<ellipse cx="${fmt(hx)}" cy="${fmt(hy)}" rx="${fmt(headRx)}" ry="${fmt(headRy)}" fill="none" stroke="${ink}" stroke-width="${fmt(ow * 1.15)}"/>`);
  if (c.hair.beard !== "none") {
    parts.push(beardSvg(hx, hy, hcol, rng, c.hair.beard, ink, ow));
  }
  if (hair !== "none") {
    parts.push(hairSvg(hx, hy, hair, hcol, rng, ink, ow));
  }
  parts.push(
    faceSvg(hx, hy, {
      face: c.face.expression,
      look: c.face.look,
      blink: c.face.blink,
      mouth: c.face.mouth,
      lashes: c.face.lashes,
      stubble: c.face.stubble,
      blush: c.face.blush,
      cold: c.face.cold,
      eyeSize: c.face.eyeSize,
      eyeSpacing: c.face.eyeSpacing,
    }, faceInk),
  );
  parts.push(hatSvg(hx, hy, c.outfit.hat, ink, ow));
  if (hold !== "none" && handSide === "front") parts.push(propAt(frontArmL.end));
  if (!behind && !frontArmBehind) parts.push(frontArmEl);

  // ---- anchoring to the ground (keys live in the skeleton)
  const rot = kind === "lie" ? -90 : 0;
  const ground = sk.ground;
  const low = sk.anchorKeys.filter((k) => k[1] > ground - 0.6).map((k) => k[0]);
  const lowVals = low.length > 0 ? low : [0];
  const sx0 = Math.min(...lowVals) - 0.5;
  const sx1 = Math.max(...lowVals) + 0.5;
  const shadow = c.shadow
    ? `<ellipse cx="${fmt((sx0 + sx1) / 2, 2)}" cy="${fmt(ground - 0.02, 2)}" rx="${fmt((sx1 - sx0) / 2, 2)}" ry="0.16" fill="#000000" opacity="0.13"/>`
    : "";
  const d = c.facing === "left" ? -1 : 1;
  const x = opts.x ?? 0;
  const y = opts.y ?? 0;
  const s = c.scale;
  let inner = parts.join("");
  if (rot) inner = `<g transform="rotate(${rot})">${inner}</g>`;
  return (
    `<g transform="translate(${fmt(x, 1)},${fmt(y, 1)}) scale(${fmt(s * d)},${fmt(s)}) translate(0,${fmt(-ground)})">` +
    `${shadow}${inner}</g>`
  );
}

/* ------------------------------------------------------------------ */
/* Standalone SVG — the `hand` filter + grain overlay (ink.py           */
/* render_scene). This is the entire hand-drawn look: feTurbulence     */
/* baseFrequency 0.025/px + feDisplacementMap scale = wobble px.       */
/*                                                                      */
/* UNIT CONVERSION (critical — getting this wrong warps the drawing):   */
/* ink.py renders scenes in PIXEL space (viewBox "0 0 1920 1080",       */
/* 1 character unit = U = 98 px, wobble = 1.8 px at 1080p). This       */
/* standalone SVG renders in CHARACTER-UNIT space (viewBox 9 units     */
/* wide at 720 px => 80 px per unit). Filter frequencies and the        */
/* displacement scale are in user-space units, so both must be         */
/* converted by pxPerUnit:                                              */
/*   hand baseFrequency = 0.018 cycles/px  * pxPerUnit  = 1.44 /unit   */
/*   displacement scale = 4.0 px * wobble / pxPerUnit   = 0.05*wobble  */
/*   grain baseFrequency  = 0.9 cycles/px  * pxPerUnit  = 72 /unit     */
/* The first version of this port used scale = wobble (6.0) directly   */
/* in unit space — ~265x too strong — which shifted the whole figure   */
/* and clipped the hair at the filter region. Verified visually         */
/* 2026-11-05 after the fix.                                            */
/* ------------------------------------------------------------------ */

/** Pixels per character unit for the default standalone framing. */
export const PX_PER_UNIT = 80; // 720 px / 9 viewBox units

/** Python engine wobble at 1080p, in pixels (ink.py render_scene).
 * Raised 2026-11-05 (M1) from 1.8: at 1.8 the displacement was so
 * subtle that wobble 0 vs 3 looked ~95% identical in QA. Tuned to
 * 4.0 per the measured style guide (R10): at the default framing
 * (720 px / 9 units = 80 px per unit) wobble 1 displaces outlines by
 * up to 0.05 units ≈ 4 px — the guide's 2–4 px peak-deviation target
 * at 640 px render width — and wobble 3 is three times that, so 0 vs
 * 3 is obvious. */
export const WOBBLE_PX = 4.0;

export interface RenderSvgOpts {
  width?: number;
  height?: number;
  /** viewBox in character units; default frames a full character. */
  viewBox?: string;
  /** Background: "transparent" (default), or any CSS colour. */
  background?: string;
}

/**
 * Render a character to a complete standalone SVG string.
 * Deterministic: same character (incl. style.seed) => identical string.
 * Throws a descriptive Error on invalid input — never fails silently.
 */
export function renderCharacterSvg(c: Character, opts: RenderSvgOpts = {}): string {
  const seed = c.style.seed;
  const wobble = c.style.wobble;
  const rng = mulberry32(seed);
  const inner = characterSvg(c, rng);
  const width = opts.width ?? 720;
  const height = opts.height ?? 840;
  // Default frame: extra headroom at the top so long held props
  // (spear tip reaches ~-8.6 in character units) and tall hats fit
  // without clipping. Verified by pixel-bound checks over all poses.
  const viewBox = opts.viewBox ?? "-4.5 -9.5 9 10.5";
  const bg = opts.background ?? "transparent";
  // px per character unit, from the actual viewBox (not assumed).
  const vb = viewBox.trim().split(/\s+/).map(Number);
  const vbW = vb.length === 4 && Number.isFinite(vb[2]) && vb[2] > 0 ? vb[2] : 9;
  const vbX = vb.length === 4 && Number.isFinite(vb[0]) ? vb[0] : -4.5;
  const vbY = vb.length === 4 && Number.isFinite(vb[1]) ? vb[1] : -7.5;
  const vbH = vb.length === 4 && Number.isFinite(vb[3]) && vb[3] > 0 ? vb[3] : 8.5;
  const pxPerUnit = width / vbW;
  // Convert Python pixel-space filter values to character-unit space.
  // handFreq lowered 2026-11-05 (M1) from 0.025 to 0.018 cycles/px:
  // coarser turbulence reads as hand-drawn wobble instead of fine noise.
  const handFreq = 0.018 * pxPerUnit;
  const dispScale = (WOBBLE_PX * wobble) / pxPerUnit;
  const grainFreq = 0.9 * pxPerUnit;
  const defs =
    `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="${fmt(grainFreq, 1)}" numOctaves="2" seed="3"/>` +
    `<feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0"/></filter>` +
    `<filter id="hand" x="-2%" y="-2%" width="104%" height="104%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${fmt(handFreq, 3)}" numOctaves="2" seed="${seed}" result="t"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="t" scale="${fmt(dispScale, 4)}"/></filter>`;
  const bgRect = bg === "transparent" ? "" : `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${bg}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="Character preview">` +
    `<defs>${defs}</defs>` +
    `<g filter="url(#hand)">${bgRect}${inner}</g>` +
    `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" filter="url(#grain)"/></svg>`
  );
}

/**
 * Render + measure. Returns the SVG and the synchronous render time in
 * milliseconds (performance.now). The creator page displays this number;
 * budget is < 16ms for a preview re-render.
 */
export function renderCharacterTimed(c: Character, opts: RenderSvgOpts = {}): { svg: string; ms: number } {
  const t0 = performance.now();
  const svg = renderCharacterSvg(c, opts);
  const ms = performance.now() - t0;
  return { svg, ms };
}
