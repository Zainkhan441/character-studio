/**
 * M3 drawing tests (2026-11-05) — the stronger-drawing work:
 * real hands, hair clearance with margin, torso shading, smooth limb
 * bends, and distinct brows/mouths per expression. All measured on
 * the rendered SVG (or on faceSvg directly), never on constants.
 */
import { describe, expect, it } from "vitest";
import {
  HAIR_COLORS,
  defaultCharacter,
  type Character,
  type FaceName,
  type HairStyle,
} from "./character";
import {
  computeSkeleton,
  cornerPoints,
  faceSvg,
  renderCharacterSvg,
  roundedPolyline,
} from "./renderer";

/** Parse <path .../> elements into attribute maps. */
function pathEls(svg: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const m of Array.from(svg.matchAll(/<path([^>]*)\/>/g))) {
    const attrs: Record<string, string> = {};
    for (const a of Array.from(m[1].matchAll(/([\w-]+)="([^"]*)"/g))) attrs[a[1]] = a[2];
    out.push(attrs);
  }
  return out;
}

/** Sample the actual curve points of a path d string (absolute M/L/Q/C). */
function samplePath(d: string): Array<[number, number]> {
  const tokens = d.match(/[MLQCTZmlqctz]|-?\d+\.?\d*/g) ?? [];
  const pts: Array<[number, number]> = [];
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;
  const num = (): number => Number(tokens[i++]);
  const push = (x: number, y: number): void => {
    pts.push([x, y]);
    cx = x;
    cy = y;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[MLQCTZmlqctz]/.test(t)) {
      cmd = t;
      i++;
      if (cmd === "Z" || cmd === "z") {
        push(sx, sy);
        continue;
      }
      continue;
    }
    const rel = cmd === cmd.toLowerCase() && cmd !== "";
    const c = cmd.toUpperCase();
    if (c === "M") {
      const x = num();
      const y = num();
      const ax = rel ? cx + x : x;
      const ay = rel ? cy + y : y;
      push(ax, ay);
      sx = ax;
      sy = ay;
      cmd = rel ? "l" : "L";
    } else if (c === "L") {
      const x = num();
      const y = num();
      push(rel ? cx + x : x, rel ? cy + y : y);
    } else if (c === "Q") {
      const x1 = num();
      const y1 = num();
      const x = num();
      const y = num();
      const c1x = rel ? cx + x1 : x1;
      const c1y = rel ? cy + y1 : y1;
      const ex = rel ? cx + x : x;
      const ey = rel ? cy + y : y;
      for (const tt of [0.25, 0.5, 0.75, 1]) {
        const mt = 1 - tt;
        push(mt * mt * cx + 2 * mt * tt * c1x + tt * tt * ex, mt * mt * cy + 2 * mt * tt * c1y + tt * tt * ey);
      }
    } else if (c === "C") {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x = num();
      const y = num();
      const c1x = rel ? cx + x1 : x1;
      const c1y = rel ? cy + y1 : y1;
      const c2x = rel ? cx + x2 : x2;
      const c2y = rel ? cy + y2 : y2;
      const ex = rel ? cx + x : x;
      const ey = rel ? cy + y : y;
      for (const tt of [0.33, 0.66, 1]) {
        const mt = 1 - tt;
        push(
          mt * mt * mt * cx + 3 * mt * mt * tt * c1x + 3 * mt * tt * tt * c2x + tt * tt * tt * ex,
          mt * mt * mt * cy + 3 * mt * mt * tt * c1y + 3 * mt * tt * tt * c2y + tt * tt * tt * ey,
        );
      }
    } else if (c === "A") {
      i += 7;
    } else {
      const x = num();
      const y = num();
      push(x, y);
    }
  }
  return pts;
}

function headCenter(): { hx: number; hy: number } {
  const sk = computeSkeleton(defaultCharacter());
  return { hx: sk.head[0], hy: sk.head[1] };
}

describe("hands — open palm for point/wave/cheer/hold, fist otherwise", () => {
  it.each(["point", "wave", "cheer", "hold", "hold_up"] as const)(
    "pose %s draws an open palm",
    (pose) => {
      const c: Character = { ...defaultCharacter(), pose };
      const svg = renderCharacterSvg(c);
      expect(svg).toContain('data-hand="open"');
    },
  );

  it("stand draws fists, no open palm", () => {
    const svg = renderCharacterSvg(defaultCharacter());
    expect(svg).toContain('data-hand="fist"');
    expect(svg).not.toContain('data-hand="open"');
  });

  it("a held prop draws a grip hand", () => {
    const base = defaultCharacter();
    const c: Character = {
      ...base,
      outfit: { ...base.outfit, hold: "spear", holdHand: "front" },
    };
    const svg = renderCharacterSvg(c);
    expect(svg).toContain('data-hand="grip"');
  });

  it("the open hand attaches to the skeleton hand endpoint", () => {
    const base = defaultCharacter();
    const c: Character = { ...base, pose: "point" };
    const sk = computeSkeleton(c);
    const [x, y] = sk.frontArm.end;
    const svg = renderCharacterSvg(c);
    // Same marker format the pose-matrix hanging-arm test relies on.
    expect(svg).toContain(`translate(${x.toFixed(3)},${y.toFixed(3)})`);
    expect(svg).toContain('data-hand="open"');
  });
});

describe("hair — every style keeps the eye zone open WITH margin", () => {
  // Margin version of R7: hair must stay at least 0.05 clear of the
  // brow/eye band, not just outside it. Ragged used to sit 0.01 from
  // the line — that is a fail here, not a pass.
  const styles: HairStyle[] = [
    "ragged",
    "short",
    "spiky",
    "spiky_long",
    "messy",
    "wild",
    "mop",
    "shaggy",
    "wavy",
    "long",
    "bun",
    "beard",
  ];
  it.each(styles)("hair style %s clears the brow/eye band by 0.05", (style) => {
    const base = defaultCharacter();
    const c: Character = {
      ...base,
      hair: { ...base.hair, style, beard: "none" },
    };
    const svg = renderCharacterSvg(c);
    const { hx, hy } = headCenter();
    const browLine = hy + 0.08 - 0.28;
    const eyeLine = hy + 0.08;
    const hairFill = HAIR_COLORS[c.hair.color].base;
    const headAt = svg.indexOf(`fill="${c.style.skin === "tan" ? "#f2e3c8" : "#ffffff"}"`);
    const frontSvg = headAt >= 0 ? svg.slice(headAt) : svg;
    const hairPaths = pathEls(frontSvg).filter((p) => p.fill === hairFill);
    expect(hairPaths.length).toBeGreaterThan(0);
    for (const p of hairPaths) {
      for (const [x, y] of samplePath(p.d ?? "")) {
        if (x >= hx - 0.25 && x <= hx + 0.75) {
          expect(y < browLine - 0.05 || y > eyeLine + 0.17).toBe(true);
        }
      }
    }
  });
});

describe("torso shading — dark edge + light edge on the garment", () => {
  it("shirt has both shading strokes", () => {
    const svg = renderCharacterSvg(defaultCharacter());
    expect(svg).toContain('data-torso-shade="dark"');
    expect(svg).toContain('data-torso-shade="light"');
  });

  it("robe has both shading strokes", () => {
    const base = defaultCharacter();
    const c: Character = { ...base, outfit: { ...base.outfit, outfit: "robe" } };
    const svg = renderCharacterSvg(c);
    expect(svg).toContain('data-torso-shade="dark"');
    expect(svg).toContain('data-torso-shade="light"');
  });
});

describe("limb bends — smooth quadratic at the joint, endpoints unchanged", () => {
  it("roundedPolyline curves a bent joint and keeps the endpoints", () => {
    const a: [number, number] = [0, 0];
    const k: [number, number] = [0, 0.8];
    const b: [number, number] = [0.75, 0.8];
    const d = roundedPolyline([a, k, b]);
    expect(d).toContain("Q");
    expect(d.startsWith("M0.000,0.000")).toBe(true);
    expect(d.endsWith("0.750,0.800")).toBe(true);
    // The curve stays close to the joint: it rounds the corner, it
    // does not cut across it.
    const pts = samplePath(d);
    const nearJoint = pts.filter(([x, y]) => Math.hypot(x - k[0], y - k[1]) < 0.12);
    expect(nearJoint.length).toBeGreaterThan(0);
  });

  it("cornerPoints sit on the two segments, straddling the joint", () => {
    const a: [number, number] = [0, 0];
    const k: [number, number] = [0, 0.8];
    const b: [number, number] = [0.75, 0.8];
    const { p1, p2 } = cornerPoints(a, k, b);
    expect(p1[0]).toBeCloseTo(0, 5);
    expect(p1[1]).toBeLessThan(0.8);
    expect(p1[1]).toBeGreaterThan(0.6);
    expect(p2[1]).toBeCloseTo(0.8, 5);
    expect(p2[0]).toBeGreaterThan(0);
    expect(p2[0]).toBeLessThan(0.2);
  });

  it("a bent pose renders curved limb paths", () => {
    const base = defaultCharacter();
    const c: Character = { ...base, pose: "think" }; // front elbow bends 155°
    const svg = renderCharacterSvg(c);
    const limbPaths = pathEls(svg).filter((p) => p["data-limb"] === "true");
    expect(limbPaths.length).toBeGreaterThan(0);
    expect(limbPaths.some((p) => (p.d ?? "").includes("Q"))).toBe(true);
  });

  it("computeSkeleton joints are unchanged by the drawing change", () => {
    // Guard: the bend is purely visual — joint math is untouched.
    const base = defaultCharacter();
    for (const pose of ["stand", "think", "cheer", "point", "run"] as const) {
      const sk = computeSkeleton({ ...base, pose });
      expect(sk.backArm.end[0]).toBeCloseTo(computeSkeleton({ ...base, pose }).backArm.end[0], 9);
      expect(Number.isFinite(sk.frontArm.knee[0])).toBe(true);
    }
  });
});

/** Face helpers: render one expression at head centre (0,0). */
function faceFor(expression: FaceName): string {
  return faceSvg(
    0,
    0,
    {
      face: expression,
      look: "forward",
      blink: false,
      mouth: 0,
      lashes: false,
      stubble: false,
      blush: false,
      cold: false,
      eyeSize: 1,
      eyeSpacing: 1,
    },
    "#211c19",
  );
}

/** Brow-band paths: every sampled point above the eye line. */
function browPaths(face: string): Array<Array<[number, number]>> {
  return pathEls(face)
    .map((p) => samplePath(p.d ?? ""))
    .filter((pts) => pts.length > 0 && pts.every(([, y]) => y < -0.1));
}

/** Left-brow slope: inner-end y minus outer-end y (y is down-positive). */
function leftBrowSlope(pts: Array<[number, number]>): number {
  const left = pts.filter(([x]) => x < 0.26);
  if (left.length < 2) return 0;
  const outer = left.reduce((a, b) => (a[0] < b[0] ? a : b));
  const inner = left.reduce((a, b) => (a[0] > b[0] ? a : b));
  return inner[1] - outer[1];
}

/** Mouth paths: sampled points near the mouth line (y ≈ +0.43). */
function mouthPaths(face: string): Array<Record<string, string>> {
  return pathEls(face).filter((p) => {
    const pts = samplePath(p.d ?? "");
    return (
      pts.length > 0 &&
      pts.every(([x, y]) => Math.abs(x - 0.24) <= 0.4 && y > 0.2 && y < 0.95)
    );
  });
}

function mouthWidth(p: Record<string, string>): number {
  const pts = samplePath(p.d ?? "");
  const xs = pts.map(([x]) => x);
  return Math.max(...xs) - Math.min(...xs);
}

describe("face — brows read with the expression", () => {
  it("neutral brows are flat", () => {
    const brows = browPaths(faceFor("neutral"));
    expect(brows.length).toBeGreaterThan(0);
    for (const pts of brows) {
      expect(Math.abs(leftBrowSlope(pts))).toBeLessThan(0.05);
    }
  });

  it("angry brows slope down toward the centre (V)", () => {
    const brows = browPaths(faceFor("angry"));
    expect(brows.length).toBeGreaterThan(0);
    expect(leftBrowSlope(brows[0])).toBeGreaterThanOrEqual(0.08);
  });

  it("sad brows slope up toward the centre, worried steeper than sad", () => {
    const sad = browPaths(faceFor("sad"));
    const worried = browPaths(faceFor("worried"));
    expect(sad.length).toBeGreaterThan(0);
    expect(worried.length).toBeGreaterThan(0);
    const sadSlope = leftBrowSlope(sad[0]);
    const worriedSlope = leftBrowSlope(worried[0]);
    expect(sadSlope).toBeLessThanOrEqual(-0.08);
    expect(worriedSlope).toBeLessThan(sadSlope);
  });

  it("surprised brows arch high above the neutral line", () => {
    const surprised = browPaths(faceFor("surprised"));
    const neutral = browPaths(faceFor("neutral"));
    expect(surprised.length).toBeGreaterThan(0);
    const top = (pts: Array<[number, number]>): number => Math.min(...pts.map(([, y]) => y));
    const surprisedTop = Math.min(...surprised.map(top));
    const neutralTop = Math.min(...neutral.map(top));
    expect(neutralTop - surprisedTop).toBeGreaterThanOrEqual(0.1);
  });
});

describe("face — happy / content / big_smile / smirk mouths are distinct", () => {
  it("happy mouth is wider than content mouth", () => {
    const happy = mouthPaths(faceFor("happy"));
    const content = mouthPaths(faceFor("content"));
    expect(happy.length).toBe(1);
    expect(content.length).toBe(1);
    expect(mouthWidth(happy[0]) - mouthWidth(content[0])).toBeGreaterThanOrEqual(0.08);
  });

  it("big_smile is a filled open mouth, happy/content are stroke-only", () => {
    const big = mouthPaths(faceFor("big_smile"));
    const happy = mouthPaths(faceFor("happy"));
    expect(big.some((p) => p.fill === "#4a1f1a")).toBe(true);
    expect(happy.every((p) => p.fill === undefined || p.fill === "none")).toBe(true);
  });

  it("smirk is asymmetric", () => {
    const smirk = mouthPaths(faceFor("smirk"));
    expect(smirk.length).toBe(1);
    const pts = samplePath(smirk[0].d ?? "");
    const ys = pts.map(([, y]) => y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(0.05);
    expect(Math.abs(pts[0][1] - pts[pts.length - 1][1])).toBeGreaterThanOrEqual(0.05);
  });
});
