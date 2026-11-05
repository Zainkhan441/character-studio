/**
 * Style-rule tests (M1, 2026-11-05) — measured rules from
 * research/youtube-style-guide-2026-11-05.md (R1–R10).
 *
 * These measure the RENDERED SVG (not schema constants): head
 * fraction, head ellipse ratio, eye position/spacing/size, brow
 * geometry, mouth width/position, line weights, hair-over-face, skin
 * settings, wobble scale. If a rule regresses, this file fails first.
 *
 * Base unit: head radius = 1.
 */
import { describe, expect, it } from "vitest";
import {
  HAIR_COLORS,
  defaultCharacter,
  validateCharacter,
  type Character,
  type HairStyle,
} from "./character";
import { WOBBLE_PX, computeSkeleton, renderCharacterSvg } from "./renderer";

/** Parse <ellipse .../> elements into attribute maps. */
function ellipses(svg: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const m of Array.from(svg.matchAll(/<ellipse([^>]*)\/>/g))) {
    const attrs: Record<string, string> = {};
    for (const a of Array.from(m[1].matchAll(/([\w-]+)="([^"]*)"/g))) attrs[a[1]] = a[2];
    out.push(attrs);
  }
  return out;
}

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

/**
 * Sample the actual curve points of a path d string: endpoints of
 * lines, sampled points of Q/C curves (control points are NOT on the
 * curve — counting them as vertices was a false positive). Handles
 * absolute + relative commands and implicit repeats. Arcs are not
 * used by any hair builder; they are skipped.
 */
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
      cmd = rel ? "l" : "L"; // implicit repeats are lines
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
      for (const t of [0.25, 0.5, 0.75, 1]) {
        const mt = 1 - t;
        push(mt * mt * cx + 2 * mt * t * c1x + t * t * ex, mt * mt * cy + 2 * mt * t * c1y + t * t * ey);
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
      for (const t of [0.33, 0.66, 1]) {
        const mt = 1 - t;
        push(
          mt * mt * mt * cx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * ex,
          mt * mt * mt * cy + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * ey,
        );
      }
    } else if (c === "A") {
      // Arc: rx ry rot large-arc sweep x y — skip (not used by hair).
      i += 7;
    } else {
      // Unknown token: consume one number pair as a point to stay aligned.
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

describe("R1 — head is 39% of total standing height (±0.02)", () => {
  it("default character, stand pose", () => {
    const c = defaultCharacter();
    const sk = computeSkeleton(c);
    const headHeight = 2 * c.proportions.headRadius;
    const headTop = sk.head[1] - c.proportions.headRadius * 0.95; // ellipse ry
    const total = sk.ground - headTop;
    const ratio = headHeight / total;
    expect(ratio).toBeGreaterThanOrEqual(0.37);
    expect(ratio).toBeLessThanOrEqual(0.41);
  });
});

describe("R2 — head 1.11 : 1 wider than tall (±0.05)", () => {
  it("head fill ellipse has rx/ry ≈ 1.11", () => {
    const svg = renderCharacterSvg(defaultCharacter());
    const head = ellipses(svg).find((e) => e.fill === "#ffffff" && e.rx && e.ry);
    expect(head).toBeDefined();
    const ratio = Number(head!.rx) / Number(head!.ry);
    expect(ratio).toBeGreaterThanOrEqual(1.06);
    expect(ratio).toBeLessThanOrEqual(1.16);
  });
});

describe("R3 — eyes: ±0.30 spacing, +0.08 below centre, dot Ø 0.10", () => {
  it("neutral eye dots in the rendered SVG", () => {
    const svg = renderCharacterSvg(defaultCharacter());
    const { hx, hy } = headCenter();
    // Eye dots are the ink-filled ellipses (shadow is #000000).
    const eyes = ellipses(svg).filter((e) => e.fill === "#211c19" && e.rx === e.ry);
    expect(eyes).toHaveLength(2);
    const xs = eyes.map((e) => Number(e.cx)).sort((a, b) => a - b);
    const ys = eyes.map((e) => Number(e.cy));
    // Centres ±0.30 from the face centre (face centre x = hx + 0.26).
    const faceCx = hx + 0.26;
    expect((xs[1] - xs[0]) / 2).toBeCloseTo(0.3, 1);
    expect((xs[0] + xs[1]) / 2).toBeCloseTo(faceCx, 1);
    // Eye line +0.05…+0.10 below the head centre.
    for (const y of ys) {
      expect(y - hy).toBeGreaterThanOrEqual(0.05);
      expect(y - hy).toBeLessThanOrEqual(0.1);
    }
    // Dot diameter 0.08–0.16 (target 0.10, measurement tolerance).
    for (const e of eyes) {
      expect(Number(e.rx) * 2).toBeGreaterThanOrEqual(0.08);
      expect(Number(e.rx) * 2).toBeLessThanOrEqual(0.16);
    }
  });
});

describe("R4 — brows: ~0.26 wide, ~0.28 above the eye line, flat", () => {
  it("neutral brow segments in the rendered SVG", () => {
    const svg = renderCharacterSvg(defaultCharacter());
    const { hy } = headCenter();
    const eyeLine = hy + 0.08;
    // Brow paths are single-stroke (sw) paths with two M..L segments.
    const brow = pathEls(svg).find(
      (p) => p["stroke-width"] === "0.085" && (p.d?.split("M").length ?? 0) === 3,
    );
    expect(brow).toBeDefined();
    const pts = samplePath(brow!.d ?? "");
    expect(pts.length).toBe(4);
    // First segment width ≈ 0.26.
    const w = Math.abs(pts[1][0] - pts[0][0]);
    expect(w).toBeGreaterThanOrEqual(0.22);
    expect(w).toBeLessThanOrEqual(0.3);
    // Brow height ≈ 0.28–0.31 above the eye line (y is down-positive).
    for (const [, y] of pts) {
      expect(eyeLine - y).toBeGreaterThanOrEqual(0.25);
      expect(eyeLine - y).toBeLessThanOrEqual(0.34);
    }
  });
});

describe("R5 — neutral mouth: dash 0.32 wide at +0.43 below centre", () => {
  it("neutral mouth dash in the rendered SVG", () => {
    const svg = renderCharacterSvg(defaultCharacter());
    const { hy } = headCenter();
    // The mouth is the single-segment sw path (brows have 2 segments).
    const mouth = pathEls(svg).find(
      (p) => p["stroke-width"] === "0.07" && (p.d?.split("M").length ?? 0) === 2 && p.d?.includes("L"),
    );
    expect(mouth).toBeDefined();
    const pts = samplePath(mouth!.d ?? "");
    expect(pts.length).toBe(2);
    const w = Math.abs(pts[1][0] - pts[0][0]);
    expect(w).toBeCloseTo(0.32, 1);
    // Mouth y ≈ +0.43 below the head centre.
    expect(pts[0][1] - hy).toBeCloseTo(0.43, 1);
  });
});

describe("R6 — line weights and ink", () => {
  it("defaults match the measured values", () => {
    const s = defaultCharacter().style;
    expect(s.limbWidth).toBeGreaterThanOrEqual(0.095);
    expect(s.limbWidth).toBeLessThanOrEqual(0.1);
    expect(s.outlineWidth).toBeGreaterThanOrEqual(0.07);
    expect(s.outlineWidth).toBeLessThanOrEqual(0.08);
    expect(s.ink).toBe("#211c19");
  });
});

describe("R7 — hair never covers the eyes or the brow line", () => {
  // Eye zone: x from just left of the left eye to just right of the
  // right eye. The violation band is the brow/eye band only
  // (brow line to just below the eyes): hair there would cover the
  // brows or eyes. Hair lower down (cheeks, chin, neck locks) is not
  // an R7 violation — e.g. spiky has a small neck lock at the chin.
  // Tested on the rendered SVG, not on constants.
  // Only FRONT hair counts: paths after the head fill ellipse in
  // document order (back hair is drawn before the head and is mostly
  // occluded by it — counting it was a false positive).
  // All 12 drawable styles (M3 audit, 2026-11-05): "none" draws
  // nothing, every other style must keep the eye zone open.
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
  it.each(styles)("hair style %s keeps the eye zone open", (style) => {
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
          // Inside the brow/eye band = covering brows or eyes.
          expect(y < browLine - 0.02 || y > eyeLine + 0.12).toBe(true);
        }
      }
    }
  });
});

describe("R8 — skin is a per-character setting (white / tan / silhouette)", () => {
  it("white (default): white head, ink eyes", () => {
    const svg = renderCharacterSvg(defaultCharacter());
    const head = ellipses(svg).find((e) => e.fill === "#ffffff" && e.rx && e.ry);
    expect(head).toBeDefined();
    const eyes = ellipses(svg).filter((e) => e.fill === "#211c19" && e.rx === e.ry);
    expect(eyes).toHaveLength(2);
  });

  it("tan: tan head, ink eyes", () => {
    const base = defaultCharacter();
    const c: Character = { ...base, style: { ...base.style, skin: "tan" } };
    const svg = renderCharacterSvg(c);
    const head = ellipses(svg).find((e) => e.fill === "#f2e3c8" && e.rx && e.ry);
    expect(head).toBeDefined();
    const eyes = ellipses(svg).filter((e) => e.fill === "#211c19" && e.rx === e.ry);
    expect(eyes).toHaveLength(2);
  });

  it("silhouette: dark head, white eyes", () => {
    const base = defaultCharacter();
    const c: Character = { ...base, style: { ...base.style, skin: "silhouette" } };
    const svg = renderCharacterSvg(c);
    const head = ellipses(svg).find((e) => e.fill === "#211c19" && e.rx && e.ry);
    expect(head).toBeDefined();
    const eyes = ellipses(svg).filter((e) => e.fill === "#ffffff" && e.rx === e.ry);
    expect(eyes).toHaveLength(2);
  });

  it("skin validates: unknown values are rejected", () => {
    const result = validateCharacter({ style: { skin: "green" } });
    expect(result.ok).toBe(false);
  });
});

describe("R10 — wobble: 2–4 px peak deviation at default, 0 vs 3 obvious", () => {
  it("WOBBLE_PX is inside the guide's 2–4 px target", () => {
    // Peak pixel deviation = WOBBLE_PX at any render width (the unit
    // conversion cancels out), so the constant IS the peak in px.
    expect(WOBBLE_PX).toBeGreaterThanOrEqual(2);
    expect(WOBBLE_PX).toBeLessThanOrEqual(4);
  });

  it("wobble 1 scale is 0.05 units at the default framing", () => {
    const svg = renderCharacterSvg(defaultCharacter());
    expect(svg).toContain('scale="0.0500"');
  });
});
