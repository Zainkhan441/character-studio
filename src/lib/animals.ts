/**
 * Parametric quadruped rig (M2, 2026-11-05).
 *
 * Animals are built the way the reference engine does it (ink.py
 * `_legs` / `_neck` / `_eye` / `_blob`): one body ellipse + neck +
 * head + 4 thin legs + tail, flat fills, black outline, no shading
 * gradients. Species differ only in proportions, colours and
 * markings — never hand-draw each animal.
 *
 * Coordinate space: feet at y = 0, animal faces right (+x). All
 * lengths are in character units (head radius = 1), so animals sit
 * naturally next to characters in a scene.
 *
 * Pure and deterministic: no randomness, no Date, no Math.random.
 */

export const ANIMAL_SPECIES = ["cow", "horse", "goat", "dog"] as const;
export type AnimalSpecies = (typeof ANIMAL_SPECIES)[number];

export const ANIMAL_NAMES: Record<AnimalSpecies, string> = {
  cow: "Cow",
  horse: "Horse",
  goat: "Goat",
  dog: "Dog",
};

export interface AnimalDef {
  /** Body fill colour. */
  body: string;
  /** Darker colour for markings / mane / horns. */
  dark: string;
  /** Leg colour (often the body colour, darker for dog). */
  legs: string;
  /** Hoof colour. */
  hoof: string;
  /** Body ellipse radii (rx, ry). */
  bodyRx: number;
  bodyRy: number;
  /** Body centre height above the ground (positive = up). */
  bodyY: number;
  /** Leg length (ground to body bottom). */
  legLen: number;
  /** Leg stroke width. */
  legW: number;
  /** Neck: [baseX, baseY, headX, headY, width] in local space. */
  neck: readonly [number, number, number, number, number];
  /** Head ellipse radii. */
  headRx: number;
  headRy: number;
  /** Muzzle colour (null = same as body). */
  muzzle: string | null;
  /** Ear style. */
  ears: "point" | "floppy" | "horns";
  /** Tail: [baseX, baseY, length, tuft colour]. */
  tail: readonly [number, number, number, string];
  /** Cow-style body spots (fixed positions — deterministic). */
  spots: ReadonlyArray<readonly [number, number, number, number, number]>;
  /** Mane along the neck (horse). */
  mane: boolean;
  /** Beard under the chin (goat). */
  beard: boolean;
}

export const ANIMAL_DEFS: Record<AnimalSpecies, AnimalDef> = {
  cow: {
    body: "#f7f5f0",
    dark: "#3c352f",
    legs: "#f7f5f0",
    hoof: "#6b573f",
    bodyRx: 1.75,
    bodyRy: 1.0,
    bodyY: 2.2,
    legLen: 1.45,
    legW: 0.2,
    neck: [1.1, 2.6, 2.1, 3.35, 0.62],
    headRx: 0.78,
    headRy: 0.68,
    muzzle: "#f0c3c0",
    ears: "point",
    tail: [-1.7, 2.6, 1.6, "#3c352f"],
    spots: [
      [-1.0, 2.45, 0.44, 0.34, -15],
      [0.2, 2.7, 0.5, 0.34, 10],
      [1.05, 2.0, 0.32, 0.26, -8],
      [-0.3, 1.65, 0.34, 0.2, 5],
    ],
    mane: false,
    beard: false,
  },
  horse: {
    body: "#8a5a33",
    dark: "#3b2416",
    legs: "#8a5a33",
    hoof: "#2a1a10",
    bodyRx: 1.9,
    bodyRy: 0.95,
    bodyY: 2.6,
    legLen: 1.9,
    legW: 0.18,
    neck: [1.2, 3.0, 2.0, 4.1, 0.55],
    headRx: 0.62,
    headRy: 0.5,
    muzzle: "#6a4226",
    ears: "point",
    tail: [-1.85, 3.0, 2.0, "#3b2416"],
    spots: [],
    mane: true,
    beard: false,
  },
  goat: {
    body: "#e8e0d0",
    dark: "#5a4a3a",
    legs: "#e8e0d0",
    hoof: "#4a3a2a",
    bodyRx: 1.2,
    bodyRy: 0.8,
    bodyY: 1.9,
    legLen: 1.3,
    legW: 0.16,
    neck: [0.75, 2.2, 1.35, 2.95, 0.45],
    headRx: 0.55,
    headRy: 0.42,
    muzzle: "#c9b8a0",
    ears: "horns",
    tail: [-1.15, 2.2, 0.6, "#e8e0d0"],
    spots: [],
    mane: false,
    beard: true,
  },
  dog: {
    body: "#c98a4a",
    dark: "#6a4226",
    legs: "#c98a4a",
    hoof: "#3a2a1a",
    bodyRx: 1.1,
    bodyRy: 0.7,
    bodyY: 1.55,
    legLen: 1.0,
    legW: 0.16,
    neck: [0.7, 1.85, 1.25, 2.45, 0.42],
    headRx: 0.5,
    headRy: 0.4,
    muzzle: "#8a5a33",
    ears: "floppy",
    tail: [-1.05, 1.9, 0.9, "#c98a4a"],
    spots: [[-0.3, 1.75, 0.35, 0.25, 0]],
    mane: false,
    beard: false,
  },
};

const INK = "#211c19";

function fmt(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) throw new Error(`animals: non-finite coordinate ${n}`);
  const v = Object.is(n, -0) ? 0 : n;
  return v.toFixed(decimals);
}

function leg(x: number, top: number, bot: number, w: number, col: string, hoof: string, bend: number): string {
  // Heights are measured UP from the ground, like the rest of this
  // file (neck() negates too) — the SVG y must be the NEGATIVE of
  // the height. The first version forgot the minus signs, so the
  // legs were drawn at +1.45..0 (below the ground line), hanging
  // detached under the body with the hooves on top (QA 2026-11-05).
  const kx = x + bend;
  const mid = (top + bot) / 2;
  const d = `M${fmt(x)},${fmt(-top)} Q${fmt(kx)},${fmt(-mid)} ${fmt(kx)},${fmt(-bot)}`;
  return (
    `<path d="${d}" stroke="${INK}" stroke-width="${fmt(w + 0.1)}" fill="none" stroke-linecap="round"/>` +
    `<path d="${d}" stroke="${col}" stroke-width="${fmt(w)}" fill="none" stroke-linecap="round"/>` +
    `<path d="M${fmt(kx - w * 0.52)},${fmt(-bot - 0.06)} h${fmt(w * 1.04)} v0.16 q0,0.08 -0.08,0.08 h${fmt(-w * 0.88)} q-0.08,0 -0.08,-0.08 Z" fill="${hoof}" stroke="${INK}" stroke-width="0.07" stroke-linejoin="round"/>`
  );
}

function neck(x1: number, y1: number, x2: number, y2: number, w: number, col: string): string {
  const d = `M${fmt(x1)},${fmt(-y1)} L${fmt(x2)},${fmt(-y2)}`;
  return (
    `<path d="${d}" stroke="${INK}" stroke-width="${fmt(w + 0.11)}" stroke-linecap="round"/>` +
    `<path d="${d}" stroke="${col}" stroke-width="${fmt(w)}" stroke-linecap="round"/>`
  );
}

function eye(x: number, y: number, r = 0.1): string {
  return (
    `<circle cx="${fmt(x)}" cy="${fmt(-y)}" r="${fmt(r)}" fill="${INK}"/>` +
    `<circle cx="${fmt(x + 0.03)}" cy="${fmt(-y - r * 0.4)}" r="${fmt(r * 0.36)}" fill="#ffffff"/>`
  );
}

function blob(cx: number, cy: number, rx: number, ry: number, col: string, rot = 0, sw = 0.11): string {
  const t = `transform="rotate(${rot} ${fmt(cx)} ${fmt(-cy)})"`;
  return (
    `<ellipse cx="${fmt(cx)}" cy="${fmt(-cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}" ${t} fill="${col}"/>` +
    `<ellipse cx="${fmt(cx)}" cy="${fmt(-cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}" ${t} fill="none" stroke="${INK}" stroke-width="${fmt(sw)}"/>`
  );
}

export interface AnimalRenderOpts {
  x?: number;
  /** Feet y (0 = ground line of the scene). */
  y?: number;
  scale?: number;
  facing?: "right" | "left";
}

/**
 * Render one animal as an SVG <g>. Feet at (x, y), facing right by
 * default. Deterministic — no randomness anywhere.
 */
export function animalSvg(species: AnimalSpecies, opts: AnimalRenderOpts = {}): string {
  const def = ANIMAL_DEFS[species];
  if (!def) throw new Error(`animals: unknown species "${String(species)}"`);
  const x = opts.x ?? 0;
  const y = opts.y ?? 0;
  const s = opts.scale ?? 1;
  const d = opts.facing === "left" ? -1 : 1;

  const parts: string[] = [];
  const bodyTop = def.bodyY + def.bodyRy;
  const bodyBottom = def.bodyY - def.bodyRy;
  const legTop = bodyBottom + 0.25;

  // Legs (back pair slightly darker, like the engine's _legs).
  // Heights are measured UP from the ground: a leg runs from the
  // body bottom (legTop) down to 0 (the ground) — NOT to legLen.
  const legXs = [-def.bodyRx * 0.55, -def.bodyRx * 0.3, def.bodyRx * 0.45, def.bodyRx * 0.7];
  legXs.forEach((lx, i) => {
    parts.push(leg(lx, legTop, 0, def.legW, i % 2 === 1 ? def.dark : def.legs, def.hoof, i < 2 ? 0.08 : -0.05));
  });

  // Tail: a curved line from the rear, with a tuft blob at the end.
  const [tx, ty, tlen, tcol] = def.tail;
  const tailTipX = tx - 0.35;
  const tailTipY = ty - tlen;
  parts.push(
    `<path d="M${fmt(tx)},${fmt(-ty)} C${fmt(tx - 0.5)},${fmt(-ty + tlen * 0.4)} ${fmt(tailTipX + 0.1)},${fmt(-tailTipY - 0.3)} ${fmt(tailTipX)},${fmt(-tailTipY)}" stroke="${INK}" stroke-width="0.14" fill="none" stroke-linecap="round"/>`,
  );
  parts.push(
    `<ellipse cx="${fmt(tailTipX)}" cy="${fmt(-tailTipY)}" rx="0.16" ry="0.28" fill="${tcol}" stroke="${INK}" stroke-width="0.07"/>`,
  );

  // Neck + mane.
  const [nx1, ny1, nx2, ny2, nw] = def.neck;
  parts.push(neck(nx1, ny1, nx2, ny2, nw, def.body));
  if (def.mane) {
    // Horse mane: a dark scalloped ridge along the top of the neck.
    const mx1 = nx1 - 0.15;
    const my1 = ny1 + 0.15;
    const mx2 = nx2 - 0.1;
    const my2 = ny2 + 0.35;
    parts.push(
      `<path d="M${fmt(mx1)},${fmt(-my1)} Q${fmt((mx1 + mx2) / 2 - 0.3)},${fmt((-my1 - my2) / 2)} ${fmt(mx2)},${fmt(-my2)} ` +
        `Q${fmt(mx2 + 0.15)},${fmt(-my2 + 0.4)} ${fmt(mx2 - 0.15)},${fmt(-my2 + 0.55)} ` +
        `Q${fmt((mx1 + mx2) / 2 - 0.1)},${fmt((-my1 - my2) / 2 + 0.35)} ${fmt(mx1)},${fmt(-my1 + 0.15)} Z" fill="${def.dark}" stroke="${INK}" stroke-width="0.07" stroke-linejoin="round"/>`,
    );
  }

  // Body + spots.
  parts.push(blob(0, def.bodyY, def.bodyRx, def.bodyRy, def.body));
  for (const [sx, sy, rx, ry, rot] of def.spots) {
    parts.push(`<ellipse cx="${fmt(sx)}" cy="${fmt(-sy)}" rx="${fmt(rx)}" ry="${fmt(ry)}" transform="rotate(${rot} ${fmt(sx)} ${fmt(-sy)})" fill="${def.dark}"/>`);
  }
  // Cow udder.
  if (species === "cow") {
    parts.push(
      `<path d="M${fmt(0.3)},${fmt(-(def.bodyY - def.bodyRy) + 0.1)} q0.45,0.12 0.4,0.45 q-0.05,0.3 -0.45,0.24 q-0.36,-0.06 -0.33,-0.36 Z" fill="#f0c3c0" stroke="${INK}" stroke-width="0.07"/>`,
    );
  }

  // Head.
  const [hx, hy] = [nx2, ny2];
  parts.push(blob(hx, hy, def.headRx, def.headRy, def.body, species === "cow" ? 0 : -10));
  // Muzzle.
  if (def.muzzle) {
    const mx = hx + def.headRx * 0.55;
    const my = hy - def.headRy * 0.35;
    parts.push(`<ellipse cx="${fmt(mx)}" cy="${fmt(-my)}" rx="${fmt(def.headRx * 0.55)}" ry="${fmt(def.headRy * 0.6)}" fill="${def.muzzle}" stroke="${INK}" stroke-width="0.08"/>`);
    // Nostrils + mouth.
    parts.push(
      `<circle cx="${fmt(mx + 0.12)}" cy="${fmt(-my - 0.05)}" r="0.05" fill="${INK}"/>` +
        `<circle cx="${fmt(mx + 0.28)}" cy="${fmt(-my - 0.02)}" r="0.05" fill="${INK}"/>` +
        `<path d="M${fmt(mx - 0.1)},${fmt(-my + 0.18)} q0.2,0.1 0.4,0" stroke="${INK}" stroke-width="0.06" fill="none" stroke-linecap="round"/>`,
    );
  }
  // Eye.
  parts.push(eye(hx + def.headRx * 0.15, hy + def.headRy * 0.25, 0.11));
  // Ears / horns.
  if (def.ears === "point") {
    for (const [ex, ey, rot] of [
      [hx - 0.15, hy + def.headRy * 0.85, -15],
      [hx + 0.25, hy + def.headRy * 0.9, 15],
    ] as const) {
      parts.push(
        `<path d="M${fmt(ex - 0.14)},${fmt(-ey)} L${fmt(ex)},${fmt(-ey - 0.35)} L${fmt(ex + 0.14)},${fmt(-ey)} Z" fill="${def.body}" stroke="${INK}" stroke-width="0.07" stroke-linejoin="round" transform="rotate(${rot} ${fmt(ex)} ${fmt(-ey)})"/>`,
      );
    }
  } else if (def.ears === "floppy") {
    for (const ex of [hx - 0.25, hx + 0.2]) {
      parts.push(
        `<ellipse cx="${fmt(ex)}" cy="${fmt(-(hy + def.headRy * 0.55))}" rx="0.14" ry="0.3" fill="${def.dark}" stroke="${INK}" stroke-width="0.07"/>`,
      );
    }
  } else if (def.ears === "horns") {
    // Goat horns: curved back over the head.
    for (const [ex, ey] of [
      [hx - 0.2, hy + def.headRy * 0.8],
      [hx + 0.2, hy + def.headRy * 0.85],
    ] as const) {
      parts.push(
        `<path d="M${fmt(ex)},${fmt(-ey)} Q${fmt(ex - 0.05)},${fmt(-ey - 0.55)} ${fmt(ex + 0.35)},${fmt(-ey - 0.6)} Q${fmt(ex + 0.15)},${fmt(-ey - 0.25)} ${fmt(ex + 0.12)},${fmt(-ey)} Z" fill="${def.dark}" stroke="${INK}" stroke-width="0.06" stroke-linejoin="round"/>`,
      );
    }
  }
  // Goat beard.
  if (def.beard) {
    parts.push(
      `<path d="M${fmt(hx + 0.1)},${fmt(-(hy - def.headRy * 0.7))} q0.1,0.3 0,0.5 q0.12,-0.2 0,-0.5 Z" fill="${def.dark}" stroke="${INK}" stroke-width="0.06"/>`,
    );
  }

  void bodyTop;
  return `<g transform="translate(${fmt(x)},${fmt(y)}) scale(${fmt(s * d)},${fmt(s)})">${parts.join("")}</g>`;
}

/** Standing height of a species at scale 1 (head top above ground). */
export function animalHeight(species: AnimalSpecies): number {
  const def = ANIMAL_DEFS[species];
  return def.neck[3] + def.headRy + 0.35;
}
