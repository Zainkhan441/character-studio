/**
 * Scene library (M2, 2026-11-05).
 *
 * A scene is DATA: background + variant + camera + lighting + placed
 * characters / animals / props + optional text card. renderScene()
 * turns it into one deterministic standalone SVG in the same
 * hand-drawn style as the characters (same `hand` filter, same ink,
 * same flat palettes from the measured YouTube style guide, R11–R14).
 *
 * Coordinate space: x in [-8, 8], y in [-7, 2], ground line y = 0,
 * sky above (negative y). A standing character is ~5.2 units tall,
 * feet at y = 0 — the same units as the character renderer, so
 * characters drop straight into a scene with characterSvg().
 *
 * Pure + deterministic: the only randomness is a seeded RNG
 * (scene.seed). Same scene + same cast => byte-identical SVG.
 */
import { z } from "zod";
import {
  FACE_NAMES,
  POSE_NAMES,
  validateCharacter,
  type Character,
  type FaceName,
  type PoseName,
} from "./character";
import { characterSvg } from "./renderer";
import { mulberry32, type Rng } from "./rng";
import { ANIMAL_SPECIES, animalSvg, type AnimalSpecies } from "./animals";

/* ------------------------------------------------------------------ */
/* Vocab                                                               */
/* ------------------------------------------------------------------ */

export const BACKGROUND_IDS = [
  "cave",
  "hut",
  "house",
  "modern",
  "savanna",
  "forest",
  "snow",
  "desert",
  "village",
  "city",
  "space",
] as const;
export type BackgroundId = (typeof BACKGROUND_IDS)[number];

export const BACKGROUND_NAMES: Record<BackgroundId, string> = {
  cave: "Cave",
  hut: "Hut camp",
  house: "House interior",
  modern: "Modern room",
  savanna: "Savanna",
  forest: "Forest",
  snow: "Snow",
  desert: "Desert",
  village: "Village",
  city: "City",
  space: "Space",
};

export const VARIANTS = ["day", "dusk", "night"] as const;
export type Variant = (typeof VARIANTS)[number];

export const CAMERAS = ["wide", "medium", "closeup"] as const;
export type CameraKind = (typeof CAMERAS)[number];

export const CAMERA_NAMES: Record<CameraKind, string> = {
  wide: "Wide",
  medium: "Medium",
  closeup: "Close-up",
};

export const LIGHTINGS = ["none", "fire", "night", "lamp"] as const;
export type LightingKind = (typeof LIGHTINGS)[number];

export const LIGHTING_NAMES: Record<LightingKind, string> = {
  none: "No extra light",
  fire: "Fire glow",
  night: "Night tint",
  lamp: "Lamp cone",
};

export const PROP_IDS = [
  "fire",
  "torch",
  "rock",
  "tree",
  "pine",
  "hut",
  "table",
  "chair",
  "arrow",
  "label",
  "basket",
  "bush",
  "lamp",
  "clock",
  "mapPin",
] as const;
export type PropId = (typeof PROP_IDS)[number];

export const PROP_NAMES: Record<PropId, string> = {
  fire: "Campfire",
  torch: "Torch",
  rock: "Rock",
  tree: "Acacia tree",
  pine: "Pine tree",
  hut: "Hut",
  table: "Table",
  chair: "Chair",
  arrow: "Big arrow",
  label: "Label",
  basket: "Basket",
  bush: "Bush",
  lamp: "Floor lamp",
  clock: "Clock in the sky",
  mapPin: "Map pin",
};

export const CUTAWAYS = ["house", "igloo", "soil"] as const;
export type CutawayId = (typeof CUTAWAYS)[number];

export const CUTAWAY_NAMES: Record<CutawayId, string> = {
  house: "House cut-away",
  igloo: "Igloo cut-away",
  soil: "Soil strata",
};

/** Hand-drawn font stack for text cards / labels / watermark. */
export const HAND_FONT = "'Patrick Hand', 'Kalam', 'Comic Sans MS', cursive";

export const INK = "#211c19";
export const SCENE_W = 16;
export const SCENE_H = 9;

function fmt(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) throw new Error(`scene: non-finite coordinate ${n}`);
  const v = Object.is(n, -0) ? 0 : n;
  return v.toFixed(decimals);
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

export const PlacementSchema = z.object({
  id: z.string().min(1),
  characterId: z.string().min(1),
  x: z.number().min(-8).max(8).default(0),
  scale: z.number().min(0.3).max(2).default(1),
  flip: z.boolean().default(false),
  pose: z.enum(POSE_NAMES).nullable().default(null),
  expression: z.enum(FACE_NAMES).nullable().default(null),
});
export type Placement = z.output<typeof PlacementSchema>;

export const ScenePropSchema = z.object({
  id: z.string().min(1),
  prop: z.enum(PROP_IDS),
  x: z.number().min(-8).max(8).default(0),
  /** Feet y (0 = ground). Negative = floating (clock, map pin). */
  y: z.number().min(-7).max(2).default(0),
  scale: z.number().min(0.3).max(3).default(1),
  /** Text for the label prop. */
  text: z.string().max(40).default(""),
});
export type SceneProp = z.output<typeof ScenePropSchema>;

export const AnimalPlacementSchema = z.object({
  id: z.string().min(1),
  species: z.enum(ANIMAL_SPECIES),
  x: z.number().min(-8).max(8).default(0),
  scale: z.number().min(0.3).max(2).default(1),
  flip: z.boolean().default(false),
});
export type AnimalPlacement = z.output<typeof AnimalPlacementSchema>;

export const TextCardSchema = z.object({
  title: z.string().min(1).max(60),
  sub: z.string().max(80).default(""),
});

export const SceneSchema = z.object({
  id: z.string().min(1).default("scene-1"),
  name: z.string().min(1).max(60).default("Untitled scene"),
  background: z.enum(BACKGROUND_IDS).default("savanna"),
  variant: z.enum(VARIANTS).default("day"),
  camera: z.enum(CAMERAS).default("wide"),
  lighting: z.enum(LIGHTINGS).default("none"),
  cutaway: z.enum(CUTAWAYS).nullable().default(null),
  placements: z.array(PlacementSchema).max(6).default([]),
  props: z.array(ScenePropSchema).max(12).default([]),
  animals: z.array(AnimalPlacementSchema).max(6).default([]),
  textCard: TextCardSchema.nullable().default(null),
  watermark: z.boolean().default(true),
  nameLabels: z.boolean().default(false),
  seed: z.number().int().min(0).max(100000).default(7),
});
export type Scene = z.output<typeof SceneSchema>;

export function defaultScene(): Scene {
  const parsed = SceneSchema.safeParse({});
  if (!parsed.success) throw new Error(`defaultScene failed: ${parsed.error.message}`);
  return parsed.data;
}

export type SceneValidation = { ok: true; scene: Scene } | { ok: false; error: string };

export function validateScene(data: unknown): SceneValidation {
  const parsed = SceneSchema.safeParse(data);
  if (parsed.success) return { ok: true, scene: parsed.data };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

/* ------------------------------------------------------------------ */
/* Palettes — measured, style guide R11.                               */
/* ------------------------------------------------------------------ */

interface Palette {
  sky: string;
  ground: string;
  groundLine: string;
  tree: string;
  rock: string;
  stars: boolean;
}

function palette(bg: BackgroundId, variant: Variant): Palette {
  if (bg === "space") {
    return { sky: "#0d0d1f", ground: "#3a3a4a", groundLine: "#2a2a38", tree: "#6a8a48", rock: "#5a5a6a", stars: true };
  }
  if (bg === "snow") {
    return variant === "night"
      ? { sky: "#1a2340", ground: "#dfe8f2", groundLine: "#b9c8da", tree: "#2f4a3a", rock: "#8a94a0", stars: true }
      : { sky: "#dfe8f0", ground: "#eef2f5", groundLine: "#c8d4e0", tree: "#3a5a3a", rock: "#9aa4ae", stars: false };
  }
  if (bg === "modern") {
    return { sky: "#f0f0e0", ground: "#e6e2d2", groundLine: "#c0c0c0", tree: "#6a8a48", rock: "#8a8a8a", stars: false };
  }
  if (bg === "house") {
    return variant === "night"
      ? { sky: "#2a2438", ground: "#6a4a34", groundLine: "#4a3424", tree: "#6a8a48", rock: "#8a8a8a", stars: true }
      : { sky: "#a8d8d8", ground: "#8a6a44", groundLine: "#6a4a2c", tree: "#6a8a48", rock: "#8a8a8a", stars: false };
  }
  if (bg === "cave") {
    return { sky: "#0d0d1f", ground: "#4a3f35", groundLine: "#33291f", tree: "#6a8a48", rock: "#5a5148", stars: true };
  }
  if (bg === "desert") {
    return variant === "night"
      ? { sky: "#141430", ground: "#8a6a4a", groundLine: "#6a4a34", tree: "#4a6a3a", rock: "#6a5a4a", stars: true }
      : variant === "dusk"
        ? { sky: "#e8a06a", ground: "#d9b77a", groundLine: "#b8985a", tree: "#4a6a3a", rock: "#8a7a6a", stars: false }
        : { sky: "#a8d8d8", ground: "#d9b77a", groundLine: "#b8985a", tree: "#4a6a3a", rock: "#8a7a6a", stars: false };
  }
  // Outdoor defaults (savanna / forest / hut / village / city).
  if (variant === "night") {
    return { sky: "#0d0d1f", ground: "#7a6a58", groundLine: "#5a4a3a", tree: "#3a4a2a", rock: "#6a6a6a", stars: true };
  }
  if (variant === "dusk") {
    return { sky: "#e8a06a", ground: "#a8885a", groundLine: "#8a6a44", tree: "#5a6a38", rock: "#7a6a5a", stars: false };
  }
  return { sky: "#a8d8d8", ground: "#b09868", groundLine: "#8a7048", tree: "#6a8a48", rock: "#6a6a6a", stars: false };
}

/* ------------------------------------------------------------------ */
/* Small drawing helpers                                               */
/* ------------------------------------------------------------------ */

function stars(rng: Rng, count: number): string {
  let s = "";
  for (let i = 0; i < count; i++) {
    const x = rng.uniform(-7.8, 7.8);
    const y = rng.uniform(-6.8, -1.2);
    const r = rng.uniform(0.03, 0.08);
    s += `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(r)}" fill="#ffffff" opacity="${fmt(rng.uniform(0.5, 1), 2)}"/>`;
  }
  return s;
}

function moon(x: number, y: number, sky: string): string {
  return (
    `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="0.55" fill="#f5f0dc" stroke="${INK}" stroke-width="0.08"/>` +
    `<circle cx="${fmt(x + 0.22)}" cy="${fmt(y - 0.12)}" r="0.48" fill="${sky}"/>` +
    `<circle cx="${fmt(x - 0.15)}" cy="${fmt(y + 0.15)}" r="0.08" fill="#d8d2ba"/>`
  );
}

function sun(x: number, y: number): string {
  let rays = "";
  for (let a = 0; a < 360; a += 45) {
    const rad = (a * Math.PI) / 180;
    rays += `<path d="M${fmt(x + Math.sin(rad) * 0.75)},${fmt(y - Math.cos(rad) * 0.75)} L${fmt(x + Math.sin(rad) * 1.0)},${fmt(y - Math.cos(rad) * 1.0)}" stroke="#e8a020" stroke-width="0.1" stroke-linecap="round"/>`;
  }
  return `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="0.6" fill="#f2c230" stroke="${INK}" stroke-width="0.08"/>` + rays;
}

function acaciaTree(x: number, y: number, s: number, col: string): string {
  return (
    `<g transform="translate(${fmt(x)},${fmt(y)}) scale(${fmt(s)})">` +
    `<path d="M0,0 C-0.05,-0.8 0.08,-1.6 0,-2.2" stroke="${INK}" stroke-width="0.16" fill="none" stroke-linecap="round"/>` +
    `<ellipse cx="0" cy="-2.45" rx="1.25" ry="0.42" fill="${col}" stroke="${INK}" stroke-width="0.09"/>` +
    `<ellipse cx="-0.7" cy="-2.3" rx="0.7" ry="0.3" fill="${col}" stroke="${INK}" stroke-width="0.08"/>` +
    `<ellipse cx="0.75" cy="-2.3" rx="0.65" ry="0.28" fill="${col}" stroke="${INK}" stroke-width="0.08"/>` +
    `</g>`
  );
}

function pineTree(x: number, y: number, s: number, col: string, snowy: boolean): string {
  const cap = snowy ? `<path d="M-0.55,-1.5 L0,-2.35 L0.55,-1.5 Z" fill="#ffffff" stroke="${INK}" stroke-width="0.06"/>` : "";
  return (
    `<g transform="translate(${fmt(x)},${fmt(y)}) scale(${fmt(s)})">` +
    `<rect x="-0.09" y="-0.7" width="0.18" height="0.7" fill="#5a3d24" stroke="${INK}" stroke-width="0.06"/>` +
    `<path d="M-0.75,-0.7 L0,-2.4 L0.75,-0.7 Z" fill="${col}" stroke="${INK}" stroke-width="0.08" stroke-linejoin="round"/>` +
    `<path d="M-0.6,-1.35 L0,-2.75 L0.6,-1.35 Z" fill="${col}" stroke="${INK}" stroke-width="0.08" stroke-linejoin="round"/>` +
    `<path d="M-0.42,-2.0 L0,-3.3 L0.42,-2.0 Z" fill="${col}" stroke="${INK}" stroke-width="0.08" stroke-linejoin="round"/>` +
    cap +
    `</g>`
  );
}

function rockShape(x: number, y: number, s: number, col: string): string {
  return (
    `<g transform="translate(${fmt(x)},${fmt(y)}) scale(${fmt(s)})">` +
    `<ellipse cx="0" cy="-0.18" rx="0.6" ry="0.36" fill="${col}" stroke="${INK}" stroke-width="0.08"/>` +
    `<path d="M-0.3,-0.2 L-0.1,-0.35 M0.05,-0.15 L0.25,-0.3" stroke="#4a4a4a" stroke-width="0.05" fill="none" stroke-linecap="round"/>` +
    `</g>`
  );
}

function hutShape(x: number, y: number, s: number): string {
  return (
    `<g transform="translate(${fmt(x)},${fmt(y)}) scale(${fmt(s)})">` +
    `<path d="M-1.5,0 H1.5 V-1.05 H-1.5 Z" fill="#cfc7b8" stroke="${INK}" stroke-width="0.1"/>` +
    `<ellipse cx="-0.8" cy="-0.5" rx="0.17" ry="0.1" fill="#b9b2a6" stroke="#8d8578" stroke-width="0.04"/>` +
    `<ellipse cx="0.4" cy="-0.7" rx="0.17" ry="0.1" fill="#b9b2a6" stroke="#8d8578" stroke-width="0.04"/>` +
    `<ellipse cx="0.9" cy="-0.35" rx="0.15" ry="0.09" fill="#b9b2a6" stroke="#8d8578" stroke-width="0.04"/>` +
    `<path d="M-1.7,-1.05 L0,-1.7 L1.7,-1.05 Z" fill="#c9a24e" stroke="${INK}" stroke-width="0.1" stroke-linejoin="round"/>` +
    `<path d="M-1.2,-1.25 L-0.6,-1.45 M-0.2,-1.4 L0.4,-1.55 M0.6,-1.35 L1.2,-1.2" stroke="#a5834e" stroke-width="0.05" fill="none" stroke-linecap="round"/>` +
    `<path d="M-0.28,0 V-0.7 H0.28 V0 Z" fill="#6a4a2c" stroke="${INK}" stroke-width="0.08"/>` +
    `<path d="M-1.05,-0.55 h0.35 v0.32 h-0.35 Z M0.75,-0.55 h0.35 v0.32 h-0.35 Z" fill="#3b4752" stroke="${INK}" stroke-width="0.06"/>` +
    `<path d="M0.45,-1.85 q0.12,-0.25 0,-0.48 q-0.12,-0.22 0,-0.45" stroke="#b9bfc4" stroke-width="0.06" fill="none" stroke-linecap="round" opacity="0.8"/>` +
    `</g>`
  );
}

function flame(x: number, y: number, s: number): string {
  return (
    `<g transform="translate(${fmt(x)},${fmt(y)}) scale(${fmt(s)})">` +
    `<ellipse cx="0" cy="-0.05" rx="0.75" ry="0.16" fill="#b9b2a6" stroke="${INK}" stroke-width="0.08"/>` +
    `<ellipse cx="-0.4" cy="-0.12" rx="0.18" ry="0.11" fill="#8d8578" stroke="${INK}" stroke-width="0.05"/>` +
    `<ellipse cx="0.35" cy="-0.12" rx="0.2" ry="0.12" fill="#8d8578" stroke="${INK}" stroke-width="0.05"/>` +
    `<path d="M-0.35,0 L0.3,-0.25 M0.35,0 L-0.3,-0.25" stroke="#6a4a2c" stroke-width="0.14" stroke-linecap="round"/>` +
    `<path d="M-0.42,-0.15 C-0.55,-0.7 -0.2,-1.0 0,-1.35 C0.15,-1.0 0.5,-0.75 0.42,-0.15 C0.25,0.05 -0.25,0.05 -0.42,-0.15 Z" fill="#c0392b" stroke="${INK}" stroke-width="0.07" stroke-linejoin="round"/>` +
    `<path d="M-0.28,-0.15 C-0.35,-0.55 -0.1,-0.8 0,-1.05 C0.08,-0.8 0.32,-0.55 0.28,-0.15 C0.15,0.0 -0.15,0.0 -0.28,-0.15 Z" fill="#e67e22" stroke="${INK}" stroke-width="0.06" stroke-linejoin="round"/>` +
    `<path d="M-0.13,-0.12 C-0.16,-0.4 -0.04,-0.6 0,-0.75 C0.05,-0.55 0.15,-0.35 0.13,-0.12 C0.05,0.0 -0.08,0.0 -0.13,-0.12 Z" fill="#f2c230" stroke="${INK}" stroke-width="0.05" stroke-linejoin="round"/>` +
    `</g>`
  );
}

function groundLine(rng: Rng, pal: Palette): string {
  // One wobbly horizon line (R13: flat tone + one wobbly line).
  let d = "M-8,0 ";
  for (let x = -7; x <= 8; x += 1) {
    d += `Q${fmt(x - 0.5)},${fmt(rng.uniform(-0.08, 0.08))} ${fmt(x)},${fmt(rng.uniform(-0.05, 0.05))} `;
  }
  return (
    `<rect x="-8" y="0" width="16" height="2" fill="${pal.ground}"/>` +
    `<path d="${d}" stroke="${pal.groundLine}" stroke-width="0.12" fill="none" stroke-linecap="round"/>`
  );
}

/* ------------------------------------------------------------------ */
/* Backgrounds                                                         */
/* ------------------------------------------------------------------ */

function backgroundSvg(bg: BackgroundId, variant: Variant, rng: Rng): string {
  const pal = palette(bg, variant);
  const sky = `<rect x="-8" y="-7" width="16" height="9" fill="${pal.sky}"/>`;
  const starField = pal.stars ? stars(rng, 42) : "";
  const sunOrMoon =
    variant === "night" ? moon(6, -5.4, pal.sky) : variant === "dusk" ? sun(-6, -5.2) : sun(-6, -5.4);
  const ground = groundLine(rng, pal);

  switch (bg) {
    case "cave": {
      // Dark rock walls framing a bright opening (style guide §4.3).
      const openingSky = variant === "night" ? "#0d0d1f" : "#a8d8d8";
      return (
        `<rect x="-8" y="-7" width="16" height="9" fill="#2a2320"/>` +
        `<path d="M-8,-7 L8,-7 L8,2 L-8,2 Z" fill="none"/>` +
        `<path d="M-3.2,2 L-3.2,-3.4 Q0,-5.6 3.2,-3.4 L3.2,2 Z" fill="${openingSky}" stroke="${INK}" stroke-width="0.14" stroke-linejoin="round"/>` +
        (variant === "night" ? stars(rng, 14) : sun(-0.5, -4.2)) +
        `<rect x="-8" y="0" width="16" height="2" fill="#4a3f35"/>` +
        `<path d="M-8,-7 L-4.5,-7 L-4.5,2 L-8,2 Z" fill="#241d19"/>` +
        `<path d="M4.5,-7 L8,-7 L8,2 L4.5,2 Z" fill="#241d19"/>` +
        `<path d="M-6.5,-7 l0.5,0.9 l0.4,-0.9 M-3,-7 l0.4,0.7 l0.4,-0.7 M3.5,-7 l0.5,0.8 l0.4,-0.8" stroke="#1a1512" stroke-width="0.2" fill="none" stroke-linejoin="round"/>` +
        `<path d="M-7,-5.5 q0.4,0.3 0.8,0 M5.5,-4.5 q0.4,0.3 0.8,0" stroke="#3a2f28" stroke-width="0.08" fill="none"/>`
      );
    }
    case "hut": {
      return (
        sky + starField + sunOrMoon +
        ground +
        hutShape(-4.5, 0, 1.6) +
        hutShape(3.8, 0, 1.25) +
        acaciaTree(0.5, 0, 1.1, pal.tree) +
        rockShape(-6.8, 0, 0.9, pal.rock) +
        rockShape(6.6, 0, 0.7, pal.rock)
      );
    }
    case "house": {
      // Interior: wall, floor, window showing the sky, rug, table.
      const wall = variant === "night" ? "#3a3348" : "#e8dcc8";
      return (
        `<rect x="-8" y="-7" width="16" height="9" fill="${wall}"/>` +
        `<rect x="-8" y="0" width="16" height="2" fill="${pal.ground}"/>` +
        `<path d="M-8,0 H8" stroke="${pal.groundLine}" stroke-width="0.12"/>` +
        `<rect x="-6.2" y="-5.6" width="3.4" height="3.2" fill="${pal.sky}" stroke="${INK}" stroke-width="0.12"/>` +
        `<path d="M-4.5,-5.6 V-2.4 M-6.2,-4.0 H-2.8" stroke="${INK}" stroke-width="0.09"/>` +
        // Sun/moon sit INSIDE the window: sun rays reach 1.0 unit,
        // so centre (-4.7,-4.5) keeps them within the frame.
        (variant === "night" ? moon(-5.2, -4.9, pal.sky) : sun(-4.7, -4.5)) +
        `<ellipse cx="0" cy="0.9" rx="3.4" ry="0.5" fill="#b5453a" stroke="${INK}" stroke-width="0.09"/>` +
        `<path d="M-3.4,0.9 q3.4,0.35 6.8,0" stroke="#8a2f28" stroke-width="0.06" fill="none"/>` +
        `<g transform="translate(5.2,0)"><rect x="-1.1" y="-1.5" width="2.2" height="0.18" fill="#7a5a3a" stroke="${INK}" stroke-width="0.08"/><rect x="-0.9" y="-1.32" width="0.14" height="1.32" fill="#5a3d24" stroke="${INK}" stroke-width="0.06"/><rect x="0.76" y="-1.32" width="0.14" height="1.32" fill="#5a3d24" stroke="${INK}" stroke-width="0.06"/><rect x="-0.25" y="-1.85" width="0.5" height="0.35" fill="#c9a24e" stroke="${INK}" stroke-width="0.06"/></g>` +
        `<path d="M-7.6,-6.6 h15.2 M-7.6,1.8 h15.2" stroke="${INK}" stroke-width="0.05" opacity="0.15"/>`
      );
    }
    case "modern": {
      // Zenn cream canvas: warm cream, thin grey line-art props.
      return (
        `<rect x="-8" y="-7" width="16" height="9" fill="#f0f0e0"/>` +
        `<rect x="-8" y="0" width="16" height="2" fill="#e6e2d2"/>` +
        `<path d="M-8,0 H8" stroke="#c0c0c0" stroke-width="0.08"/>` +
        `<rect x="-7" y="-5.8" width="3" height="2.6" fill="none" stroke="#c0c0c0" stroke-width="0.09"/>` +
        `<path d="M-5.5,-5.8 V-3.2 M-7,-4.5 H-4" stroke="#c0c0c0" stroke-width="0.07"/>` +
        `<circle cx="-5.6" cy="-5.1" r="0.35" fill="#f2c230" stroke="#c0c0c0" stroke-width="0.06"/>` +
        `<path d="M2.5,-1.2 L4.5,-3.4 L6.5,-1.2 Z M5.5,-1.2 L7,-3.0 L8,-1.2" fill="none" stroke="#c0c0c0" stroke-width="0.09" stroke-linejoin="round"/>` +
        `<path d="M-1.5,0 q0.1,-1.2 0.5,-1.6 q0.4,0.4 0.5,1.6 Z" fill="#6a8a48" stroke="#c0c0c0" stroke-width="0.07"/>` +
        `<rect x="-1.8" y="-0.1" width="1.1" height="0.5" fill="#f2c9a0" stroke="${INK}" stroke-width="0.07"/>` +
        `<ellipse cx="0" cy="0.35" rx="5.5" ry="0.28" fill="#f2c9a0" opacity="0.45"/>`
      );
    }
    case "savanna": {
      return (
        sky + starField + sunOrMoon +
        ground +
        acaciaTree(-5.8, 0, 1.5, pal.tree) +
        acaciaTree(5.6, 0, 1.2, pal.tree) +
        rockShape(-2.2, 0, 0.8, pal.rock) +
        rockShape(2.4, 0, 0.6, pal.rock) +
        `<path d="M-7.5,0 q0.1,-0.35 0.25,0 M-6.9,0 q0.1,-0.3 0.25,0 M7.0,0 q0.1,-0.3 0.25,0" stroke="${pal.tree}" stroke-width="0.07" fill="none" stroke-linecap="round"/>`
      );
    }
    case "forest": {
      return (
        sky + starField +
        `<rect x="-8" y="-7" width="16" height="2.2" fill="${pal.sky}"/>` +
        pineTree(-6.5, -1.2, 1.6, pal.tree, false) +
        pineTree(-3.5, -1.4, 1.9, pal.tree, false) +
        pineTree(0.5, -1.2, 1.5, pal.tree, false) +
        pineTree(4.2, -1.4, 1.8, pal.tree, false) +
        pineTree(7.0, -1.2, 1.5, pal.tree, false) +
        ground +
        pineTree(-5.2, 0, 1.3, pal.tree, false) +
        pineTree(6.2, 0, 1.2, pal.tree, false) +
        rockShape(-1.5, 0, 0.8, pal.rock)
      );
    }
    case "snow": {
      const flakes = Array.from({ length: 24 }, () => {
        const x = rng.uniform(-7.8, 7.8);
        const y = rng.uniform(-6.8, -0.5);
        return `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(rng.uniform(0.04, 0.09))}" fill="#ffffff" opacity="0.9"/>`;
      }).join("");
      return (
        sky + starField + sunOrMoon +
        `<rect x="-8" y="0" width="16" height="2" fill="${pal.ground}"/>` +
        `<path d="M-8,0 H8" stroke="${pal.groundLine}" stroke-width="0.1"/>` +
        flakes +
        pineTree(-6, 0, 1.6, pal.tree, true) +
        pineTree(-2.5, 0, 1.3, pal.tree, true) +
        pineTree(2.8, 0, 1.5, pal.tree, true) +
        pineTree(6.3, 0, 1.2, pal.tree, true) +
        rockShape(-0.5, 0, 0.7, pal.rock)
      );
    }
    case "desert": {
      return (
        sky + starField + sunOrMoon +
        `<rect x="-8" y="0" width="16" height="2" fill="${pal.ground}"/>` +
        `<path d="M-8,0 Q-4,-0.7 0,0 T8,0" stroke="${pal.groundLine}" stroke-width="0.12" fill="none"/>` +
        `<path d="M-8,0.9 Q-2,0.3 3,0.9 T8,0.9" stroke="${pal.groundLine}" stroke-width="0.09" fill="none" opacity="0.7"/>` +
        `<g transform="translate(5.8,0)"><rect x="-0.14" y="-1.9" width="0.28" height="1.9" rx="0.14" fill="#4a6a3a" stroke="${INK}" stroke-width="0.07"/><path d="M-0.14,-1.2 q-0.55,-0.1 -0.5,-0.7 q0.05,-0.4 0.35,-0.35 q0.25,0.05 0.2,0.4" fill="#4a6a3a" stroke="${INK}" stroke-width="0.06"/><path d="M0.14,-1.5 q0.55,-0.1 0.5,-0.7 q-0.05,-0.4 -0.35,-0.35 q-0.25,0.05 -0.2,0.4" fill="#4a6a3a" stroke="${INK}" stroke-width="0.06"/></g>` +
        rockShape(-5.5, 0, 0.9, pal.rock) +
        rockShape(-3.2, 0, 0.6, pal.rock)
      );
    }
    case "village": {
      return (
        sky + starField + sunOrMoon +
        ground +
        hutShape(-5.5, 0, 1.4) +
        hutShape(-1.2, 0, 1.7) +
        hutShape(3.6, 0, 1.3) +
        acaciaTree(6.8, 0, 1.0, pal.tree) +
        `<g transform="translate(0.8,0)"><ellipse cx="0" cy="-0.18" rx="0.55" ry="0.3" fill="#8d8578" stroke="${INK}" stroke-width="0.08"/><path d="M-0.55,-0.3 L0.55,-0.3" stroke="${INK}" stroke-width="0.07"/></g>` +
        rockShape(-7.2, 0, 0.7, pal.rock)
      );
    }
    case "city": {
      const windows = (bx: number, bw: number, n: number, lit: boolean): string => {
        let s = "";
        for (let i = 0; i < n; i++) {
          const wx = bx + 0.3 + (i % 3) * 0.55;
          const wy = -5.6 + Math.floor(i / 3) * 0.85;
          s += `<rect x="${fmt(wx)}" y="${fmt(wy)}" width="0.32" height="0.42" fill="${lit && variant === "night" ? "#f2c230" : "#3b4752"}" stroke="${INK}" stroke-width="0.04"/>`;
        }
        return s;
      };
      return (
        sky + starField +
        `<rect x="-8" y="-7" width="16" height="9" fill="${pal.sky}"/>` +
        `<rect x="-7.5" y="-4.2" width="2.6" height="4.2" fill="#8a94a8" stroke="${INK}" stroke-width="0.09"/>` +
        windows(-7.5, 2.6, 9, true) +
        `<rect x="-4.2" y="-5.4" width="3" height="5.4" fill="#7a8498" stroke="${INK}" stroke-width="0.09"/>` +
        windows(-4.2, 3, 12, true) +
        `<rect x="-0.4" y="-3.6" width="2.4" height="3.6" fill="#8a94a8" stroke="${INK}" stroke-width="0.09"/>` +
        windows(-0.4, 2.4, 6, false) +
        `<rect x="2.6" y="-5.0" width="2.8" height="5.0" fill="#6a7488" stroke="${INK}" stroke-width="0.09"/>` +
        windows(2.6, 2.8, 12, true) +
        `<rect x="6.0" y="-3.8" width="2.0" height="3.8" fill="#8a94a8" stroke="${INK}" stroke-width="0.09"/>` +
        windows(6.0, 2.0, 6, false) +
        `<rect x="-8" y="0" width="16" height="2" fill="#6a6a6a"/>` +
        `<path d="M-8,0 H8" stroke="#4a4a4a" stroke-width="0.12"/>` +
        `<path d="M-8,1.0 H8" stroke="#f2c230" stroke-width="0.08" stroke-dasharray="0.6 0.5"/>`
      );
    }
    case "space": {
      return (
        sky + stars(rng, 70) +
        `<circle cx="5.5" cy="-5.2" r="1.1" fill="#c9a24e" stroke="${INK}" stroke-width="0.09"/>` +
        `<ellipse cx="5.5" cy="-5.2" rx="1.8" ry="0.32" fill="none" stroke="#e8d28a" stroke-width="0.12" transform="rotate(-18 5.5 -5.2)"/>` +
        moon(-5.5, -5.0, pal.sky) +
        `<rect x="-8" y="0" width="16" height="2" fill="${pal.ground}"/>` +
        `<path d="M-8,0 Q-4,-0.4 0,0 T8,0" stroke="${pal.groundLine}" stroke-width="0.12" fill="none"/>` +
        `<ellipse cx="-3" cy="0.8" rx="0.8" ry="0.22" fill="#2a2a38"/>` +
        `<ellipse cx="2.5" cy="1.2" rx="1.1" ry="0.28" fill="#2a2a38"/>` +
        `<ellipse cx="5.8" cy="0.6" rx="0.5" ry="0.16" fill="#2a2a38"/>`
      );
    }
    default: {
      const exhaustive: never = bg;
      throw new Error(`scene: unknown background "${String(exhaustive)}"`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Cut-aways — style guide R14 (the most valuable shot in the genre).  */
/* ------------------------------------------------------------------ */

function cutawaySvg(cutaway: CutawayId, variant: Variant, rng: Rng): string {
  if (cutaway === "soil") {
    const roots = Array.from({ length: 10 }, (_, i) => {
      const x = -7 + i * 1.5 + rng.uniform(-0.3, 0.3);
      return `<path d="M${fmt(x)},-6.35 q${fmt(rng.uniform(-0.2, 0.2))},0.5 ${fmt(rng.uniform(-0.3, 0.3))},0.9" stroke="#3a2a1a" stroke-width="0.06" fill="none"/>`;
    }).join("");
    return (
      `<rect x="-8" y="-7" width="16" height="9" fill="#e8dcc8"/>` +
      `<rect x="-8" y="-6.4" width="16" height="1.9" fill="#6a4a2c"/>` +
      `<path d="M-8,-6.4 Q-4,-6.55 0,-6.4 T8,-6.4" stroke="#4a3424" stroke-width="0.1" fill="none"/>` +
      `<rect x="-8" y="-4.5" width="16" height="2.4" fill="#8a5a3a"/>` +
      `<path d="M-8,-4.5 Q-2,-4.65 2,-4.5 T8,-4.5" stroke="#6a4226" stroke-width="0.1" fill="none"/>` +
      `<rect x="-8" y="-2.1" width="16" height="1.6" fill="#9a8a7a"/>` +
      `<ellipse cx="-5" cy="-1.4" rx="0.5" ry="0.3" fill="#7a6a5a" stroke="${INK}" stroke-width="0.06"/>` +
      `<ellipse cx="1" cy="-1.2" rx="0.6" ry="0.34" fill="#7a6a5a" stroke="${INK}" stroke-width="0.06"/>` +
      `<ellipse cx="5" cy="-1.5" rx="0.45" ry="0.28" fill="#7a6a5a" stroke="${INK}" stroke-width="0.06"/>` +
      `<rect x="-8" y="-0.5" width="16" height="2.5" fill="#7a7a7a"/>` +
      `<path d="M-8,-0.5 Q0,-0.65 8,-0.5" stroke="#5a5a5a" stroke-width="0.1" fill="none"/>` +
      `<path d="M-8,-6.4 H8" stroke="#4a8a3a" stroke-width="0.14"/>` +
      `<path d="M-7.5,-6.4 q0.1,-0.3 0.25,0 M-6.2,-6.4 q0.1,-0.35 0.25,0 M-2,-6.4 q0.1,-0.3 0.25,0 M1.5,-6.4 q0.1,-0.35 0.25,0 M4,-6.4 q0.1,-0.3 0.25,0 M6.8,-6.4 q0.1,-0.3 0.25,0" stroke="#4a8a3a" stroke-width="0.08" fill="none" stroke-linecap="round"/>` +
      roots +
      // Buried bone + pot.
      `<g transform="translate(-3.2,-3.2) rotate(-20)"><rect x="-0.5" y="-0.09" width="1" height="0.18" rx="0.09" fill="#f5f0e0" stroke="${INK}" stroke-width="0.06"/><circle cx="-0.55" cy="-0.1" r="0.14" fill="#f5f0e0" stroke="${INK}" stroke-width="0.05"/><circle cx="0.55" cy="0.1" r="0.14" fill="#f5f0e0" stroke="${INK}" stroke-width="0.05"/></g>` +
      `<path d="M2.6,-1.6 q0.25,0.35 0.5,0 q0.25,-0.35 0.5,0 q0.25,0.35 0.5,0" stroke="#c9a24e" stroke-width="0.14" fill="none" stroke-linecap="round"/>` +
      `<ellipse cx="4.6" cy="-3.4" rx="0.55" ry="0.7" fill="#b5453a" stroke="${INK}" stroke-width="0.08"/>` +
      `<rect x="4.0" y="-4.2" width="1.2" height="0.25" fill="#b5453a" stroke="${INK}" stroke-width="0.07"/>` +
      `<text x="-7.6" y="-6.65" font-family="${HAND_FONT}" font-size="0.42" fill="${INK}" opacity="0.75">SOIL LAYERS — WHAT LIES BELOW</text>`
    );
  }

  if (cutaway === "igloo") {
    const sky = variant === "night" ? "#0d0d1f" : "#a8d8d8";
    // Snow-block courses: concentric semicircles centred on the dome
    // base (0,0), plus radial joints — the same centre as the dome
    // outline, so no arc ever sticks out above the dome.
    const blocks: string[] = [];
    for (const r of [4.5, 3.6, 2.7, 1.8]) {
      blocks.push(`<path d="M${fmt(-r)},0 A${fmt(r)},${fmt(r)} 0 0,1 ${fmt(r)},0" stroke="#b9c8da" stroke-width="0.09" fill="none"/>`);
    }
    for (let a = -70; a <= 70; a += 18) {
      const rad = (a * Math.PI) / 180;
      blocks.push(
        `<path d="M${fmt(Math.sin(rad) * 1.8)},${fmt(-Math.cos(rad) * 1.8)} L${fmt(Math.sin(rad) * 5.4)},${fmt(-Math.cos(rad) * 5.4)}" stroke="#b9c8da" stroke-width="0.06" fill="none" opacity="0.7"/>`,
      );
    }
    return (
      `<rect x="-8" y="-7" width="16" height="9" fill="${sky}"/>` +
      (variant === "night" ? stars(rng, 30) : "") +
      `<rect x="-8" y="0" width="16" height="2" fill="#eef2f5"/>` +
      // Dome shell (outside) + cut interior.
      `<path d="M-5.4,0 A5.4,5.4 0 0,1 5.4,0 Z" fill="#ffffff" stroke="${INK}" stroke-width="0.14"/>` +
      blocks.join("") +
      `<path d="M-5.4,0 A5.4,5.4 0 0,1 5.4,0 L5.4,0 Z" fill="#f2c9a0" opacity="0.18"/>` +
      // Entrance tunnel (left).
      `<path d="M-5.4,-0.9 L-7.2,-0.9 L-7.2,0 L-5.4,0 Z" fill="#dfe8f2" stroke="${INK}" stroke-width="0.09"/>` +
      // Sleeping mat + fire inside.
      `<ellipse cx="2.8" cy="-0.15" rx="1.5" ry="0.22" fill="#c9a24e" stroke="${INK}" stroke-width="0.08"/>` +
      `<path d="M1.6,-0.3 q1.2,-0.25 2.4,0" stroke="#8a6a3a" stroke-width="0.06" fill="none"/>` +
      flame(-1.2, 0, 0.9) +
      `<text x="-7.6" y="-6.65" font-family="${HAND_FONT}" font-size="0.42" fill="${variant === "night" ? "#ffffff" : INK}" opacity="0.75">INSIDE THE IGLOO</text>`
    );
  }

  // cut-house
  const sky = variant === "night" ? "#1a2340" : "#a8d8d8";
  return (
    `<rect x="-8" y="-7" width="16" height="9" fill="${sky}"/>` +
    (variant === "night"
      ? stars(rng, 24)
      : `<ellipse cx="6.6" cy="-6.1" rx="0.8" ry="0.3" fill="#ffffff" opacity="0.9"/><ellipse cx="7.2" cy="-5.9" rx="0.55" ry="0.25" fill="#ffffff" opacity="0.9"/>`) +
    `<rect x="-8" y="0" width="16" height="2" fill="#b09868"/>` +
    // House shell, sliced open on the left: thick cut wall with hatch.
    `<path d="M-6,-5.2 L0,-6.8 L6,-5.2 L6,0 L-6,0 Z" fill="#e8dcc8" stroke="${INK}" stroke-width="0.14" stroke-linejoin="round"/>` +
    `<path d="M-6,-5.2 L0,-6.8 L6,-5.2" fill="#c9a24e" stroke="${INK}" stroke-width="0.14" stroke-linejoin="round"/>` +
    `<path d="M-6,-5.2 V0" stroke="${INK}" stroke-width="0.34"/>` +
    `<path d="M-6.35,-4.6 l0.7,0.35 M-6.35,-3.8 l0.7,0.35 M-6.35,-3.0 l0.7,0.35 M-6.35,-2.2 l0.7,0.35 M-6.35,-1.4 l0.7,0.35 M-6.35,-0.6 l0.7,0.35" stroke="${INK}" stroke-width="0.07"/>` +
    // Floor divider.
    `<path d="M-6,-2.4 H6" stroke="${INK}" stroke-width="0.12"/>` +
    // Upper floor: bed (left) + window (right).
    `<g transform="translate(-3.4,-2.4)"><rect x="-1.9" y="-0.9" width="3.8" height="0.55" fill="#7a5a3a" stroke="${INK}" stroke-width="0.08"/><rect x="-1.9" y="-1.35" width="0.45" height="0.45" fill="#f5f0e0" stroke="${INK}" stroke-width="0.07"/><rect x="-1.35" y="-1.2" width="2.6" height="0.3" fill="#b5453a" stroke="${INK}" stroke-width="0.07"/><rect x="-1.9" y="-0.35" width="0.14" height="0.35" fill="#5a3d24"/><rect x="1.76" y="-0.35" width="0.14" height="0.35" fill="#5a3d24"/></g>` +
    `<rect x="2.6" y="-4.9" width="2.2" height="1.8" fill="${sky}" stroke="${INK}" stroke-width="0.09"/>` +
    `<path d="M3.7,-4.9 V-3.1 M2.6,-4.0 H4.8" stroke="${INK}" stroke-width="0.07"/>` +
    // Ground floor: hearth with fire + table.
    flame(3.6, 0, 1.0) +
    `<path d="M2.2,-1.6 h2.8 v0.5 h-2.8 Z" fill="#8d8578" stroke="${INK}" stroke-width="0.07"/>` +
    `<g transform="translate(-3.6,0)"><rect x="-1.2" y="-1.4" width="2.4" height="0.16" fill="#7a5a3a" stroke="${INK}" stroke-width="0.07"/><rect x="-1.0" y="-1.24" width="0.14" height="1.24" fill="#5a3d24"/><rect x="0.86" y="-1.24" width="0.14" height="1.24" fill="#5a3d24"/><circle cx="0" cy="-1.62" r="0.16" fill="#c9a24e" stroke="${INK}" stroke-width="0.05"/></g>` +
    // Stairs.
    `<path d="M-0.6,-2.4 L0.6,0" stroke="${INK}" stroke-width="0.1"/>` +
    `<path d="M-0.6,-2.4 l0.35,0.1 M-0.3,-1.9 l0.35,0.1 M0,-1.4 l0.35,0.1 M0.3,-0.9 l0.35,0.1" stroke="${INK}" stroke-width="0.07"/>` +
    `<text x="-7.6" y="-6.65" font-family="${HAND_FONT}" font-size="0.42" fill="${variant === "night" ? "#ffffff" : INK}" opacity="0.75">INSIDE THE HOUSE — CUT-AWAY</text>`
  );
}

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export function scenePropSvg(prop: PropId, text: string, rng: Rng): string {
  void rng;
  switch (prop) {
    case "fire":
      return flame(0, 0, 1);
    case "torch":
      return (
        `<path d="M0,0 L0,-1.6" stroke="#6a4a2c" stroke-width="0.16" stroke-linecap="round"/>` +
        `<path d="M-0.2,-1.5 C-0.28,-1.85 -0.1,-2.05 0,-2.2 C0.08,-2.0 0.25,-1.8 0.2,-1.5 C0.12,-1.38 -0.12,-1.38 -0.2,-1.5 Z" fill="#e67e22" stroke="${INK}" stroke-width="0.06" stroke-linejoin="round"/>` +
        `<path d="M-0.1,-1.5 C-0.12,-1.7 -0.04,-1.85 0,-1.95 C0.05,-1.8 0.1,-1.65 0.1,-1.5 C0.05,-1.42 -0.06,-1.42 -0.1,-1.5 Z" fill="#f2c230" stroke="${INK}" stroke-width="0.05" stroke-linejoin="round"/>`
      );
    case "rock":
      return rockShape(0, 0, 1, "#6a6a6a");
    case "tree":
      return acaciaTree(0, 0, 1, "#6a8a48");
    case "pine":
      return pineTree(0, 0, 1, "#3a5a3a", false);
    case "hut":
      return hutShape(0, 0, 1);
    case "table":
      return (
        `<rect x="-1.1" y="-1.5" width="2.2" height="0.18" fill="#7a5a3a" stroke="${INK}" stroke-width="0.08"/>` +
        `<rect x="-0.9" y="-1.32" width="0.14" height="1.32" fill="#5a3d24" stroke="${INK}" stroke-width="0.06"/>` +
        `<rect x="0.76" y="-1.32" width="0.14" height="1.32" fill="#5a3d24" stroke="${INK}" stroke-width="0.06"/>` +
        `<rect x="-0.25" y="-1.85" width="0.5" height="0.35" fill="#c9a24e" stroke="${INK}" stroke-width="0.06"/>`
      );
    case "chair":
      return (
        `<path d="M-0.45,0 V-1.0 M0.45,0 V-1.0 M-0.45,-1.0 H0.45 M-0.45,-1.0 V-1.9 M0.45,-1.0 V-1.9 M-0.45,-1.9 H0.45" stroke="#7a5a3a" stroke-width="0.14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      );
    case "arrow":
      // Big hand-drawn arrow, pointing right (style guide §3, f-880).
      return (
        `<path d="M-1.4,-0.1 Q0,-0.25 1.0,-0.05" stroke="${INK}" stroke-width="0.16" fill="none" stroke-linecap="round"/>` +
        `<path d="M0.7,-0.55 L1.45,-0.05 L0.7,0.45 Z" fill="${INK}"/>`
      );
    case "label": {
      const label = (text || "LABEL").toUpperCase();
      const w = Math.max(1.6, label.length * 0.34 + 0.6);
      return (
        `<g transform="translate(0,-1.4)">` +
        `<rect x="${fmt(-w / 2)}" y="-0.42" width="${fmt(w)}" height="0.84" fill="#f2c9a0" stroke="${INK}" stroke-width="0.09" rx="0.08"/>` +
        `<text x="0" y="0.16" text-anchor="middle" font-family="${HAND_FONT}" font-size="0.44" font-weight="bold" fill="${INK}">${escapeXml(label)}</text>` +
        `</g>`
      );
    }
    case "basket":
      return (
        `<path d="M-0.55,-0.9 L0.55,-0.9 L0.4,0 L-0.4,0 Z" fill="#c9a24e" stroke="${INK}" stroke-width="0.08" stroke-linejoin="round"/>` +
        `<path d="M-0.52,-0.6 H0.52 M-0.48,-0.3 H0.48" stroke="#8a6a3a" stroke-width="0.05"/>` +
        `<path d="M-0.55,-0.9 Q0,-1.25 0.55,-0.9" stroke="#6a4a2c" stroke-width="0.09" fill="none"/>`
      );
    case "bush":
      return (
        `<path d="M-0.8,0 Q-0.95,-0.55 -0.4,-0.6 Q-0.45,-1.05 0,-0.95 Q0.45,-1.05 0.4,-0.6 Q0.95,-0.55 0.8,0 Z" fill="#5a7a3a" stroke="${INK}" stroke-width="0.08" stroke-linejoin="round"/>`
      );
    case "lamp":
      return (
        `<ellipse cx="0" cy="0" rx="0.5" ry="0.09" fill="#6a4a2c" stroke="${INK}" stroke-width="0.07"/>` +
        `<path d="M0,0 V-2.2" stroke="${INK}" stroke-width="0.1" stroke-linecap="round"/>` +
        `<path d="M-0.5,-2.2 L0.5,-2.2 L0.35,-1.6 L-0.35,-1.6 Z" fill="#f2c230" stroke="${INK}" stroke-width="0.08" stroke-linejoin="round"/>` +
        `<circle cx="0" cy="-1.85" r="0.14" fill="#fff2b0"/>`
      );
    case "clock":
      return (
        `<circle cx="0" cy="0" r="1.1" fill="#ffffff" stroke="${INK}" stroke-width="0.12"/>` +
        `<circle cx="0" cy="0" r="0.08" fill="${INK}"/>` +
        `<path d="M0,0 L0,-0.65 M0,0 L0.45,0.25" stroke="${INK}" stroke-width="0.1" stroke-linecap="round"/>` +
        `<path d="M0,-1.1 v0.16 M0,1.1 v-0.16 M-1.1,0 h0.16 M1.1,0 h-0.16" stroke="${INK}" stroke-width="0.07"/>` +
        `<text x="0" y="-1.45" text-anchor="middle" font-family="${HAND_FONT}" font-size="0.5" font-weight="bold" fill="${INK}">?</text>`
      );
    case "mapPin":
      return (
        `<path d="M0,0.5 C-0.55,-0.1 -0.7,-0.5 -0.7,-0.85 A0.7,0.7 0 1,1 0.7,-0.85 C0.7,-0.5 0.55,-0.1 0,0.5 Z" fill="#c0392b" stroke="${INK}" stroke-width="0.08" stroke-linejoin="round"/>` +
        `<circle cx="0" cy="-0.85" r="0.26" fill="#ffffff" stroke="${INK}" stroke-width="0.06"/>`
      );
    default: {
      const exhaustive: never = prop;
      throw new Error(`scene: unknown prop "${String(exhaustive)}"`);
    }
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

/** ViewBox for the scene's camera (16:9 in every framing). */
export function cameraViewBox(scene: Scene): string {
  if (scene.camera === "wide") return "-8 -7 16 9";
  const xs = scene.placements.map((p) => p.x);
  const cx = xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  if (scene.camera === "medium") {
    return `${fmt(cx - 5)} -5.4 10 5.625`;
  }
  // close-up: frame the first character's head/shoulders. The frame
  // top is -5.6, not -5.1: a head centre sits at about -4.35 with
  // radius 1 and hair above, so -5.1 sliced the hair off (QA 2026-11-05).
  const fx = xs.length > 0 ? xs[0] : 0;
  return `${fmt(fx - 3)} -5.6 6 3.375`;
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

export interface SceneRenderResult {
  svg: string;
  /** Non-fatal problems (e.g. a placement whose cast character is gone). */
  warnings: string[];
  /** Milliseconds the render took (scene thumbnail budget: <100ms). */
  ms: number;
}

/**
 * Render a scene to a complete standalone SVG.
 *
 * @param scene - the scene data (validated upstream).
 * @param characters - cast characters by id; placements whose id is
 *   missing are skipped and reported in `warnings`, never crash.
 * @param opts - output size; the hand-filter frequencies scale with
 *   the real px-per-unit, exactly like renderCharacterSvg.
 */
export function renderScene(
  scene: Scene,
  characters: Map<string, Character>,
  opts: { width?: number; height?: number } = {},
): SceneRenderResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const rng = mulberry32(scene.seed);
  const warnings: string[] = [];
  const viewBox = cameraViewBox(scene);
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const vb = viewBox.split(/\s+/).map(Number);
  const [vbX, vbY, vbW, vbH] = vb;
  const pxPerUnit = width / vbW;
  const handFreq = 0.018 * pxPerUnit;
  const dispScale = (4.0 * 1) / pxPerUnit;
  const grainFreq = 0.9 * pxPerUnit;

  const parts: string[] = [];

  // Background (or cut-away, which draws the whole frame).
  if (scene.cutaway) {
    parts.push(cutawaySvg(scene.cutaway, scene.variant, rng));
  } else {
    parts.push(backgroundSvg(scene.background, scene.variant, rng));
  }

  // Props (behind characters) + animals.
  for (const p of scene.props) {
    parts.push(
      `<g transform="translate(${fmt(p.x)},${fmt(p.y)}) scale(${fmt(p.scale)})">${scenePropSvg(p.prop, p.text, rng)}</g>`,
    );
  }
  for (const a of scene.animals) {
    parts.push(animalSvg(a.species, { x: a.x, y: 0, scale: a.scale, facing: a.flip ? "left" : "right" }));
  }

  // Characters.
  const renderedPlacements: Array<{ x: number; name: string }> = [];
  for (const p of scene.placements) {
    const base = characters.get(p.characterId);
    if (!base) {
      warnings.push(`Placement ${p.id}: character "${p.characterId}" not in cast — skipped.`);
      continue;
    }
    const c: Character = {
      ...base,
      pose: p.pose ?? base.pose,
      face: { ...base.face, expression: p.expression ?? base.face.expression },
      scale: base.scale * p.scale,
      facing: p.flip ? "left" : "right",
    };
    parts.push(characterSvg(c, rng, { x: p.x, y: 0 }));
    renderedPlacements.push({ x: p.x, name: c.name });
  }

  // Lighting overlays (drawn after the characters, inside the filter).
  if (scene.lighting === "fire") {
    const fireProp = scene.props.find((p) => p.prop === "fire");
    const fx = fireProp ? fireProp.x : 0;
    parts.push(
      `<ellipse cx="${fmt(fx)}" cy="-0.4" rx="4.2" ry="2.2" fill="url(#fireGlow)"/>`,
    );
  } else if (scene.lighting === "night") {
    parts.push(`<rect x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(vbH)}" fill="#16204a" opacity="0.3"/>`);
  } else if (scene.lighting === "lamp") {
    const lampProp = scene.props.find((p) => p.prop === "lamp");
    const lx = lampProp ? lampProp.x : 0;
    parts.push(
      `<path d="M${fmt(lx - 0.4)},-2.1 L${fmt(lx + 0.4)},-2.1 L${fmt(lx + 2.2)},0.4 L${fmt(lx - 2.2)},0.4 Z" fill="#ffd76a" opacity="0.22"/>` +
        `<ellipse cx="${fmt(lx)}" cy="0.2" rx="2.2" ry="0.5" fill="#ffd76a" opacity="0.25"/>`,
    );
  }

  // Text card (R19) — centred cream card, all-caps hand font.
  // The title font shrinks for long titles so the text never
  // spills past the card (QA 2026-11-05: "WE NEVER THINK TWICE"
  // at 0.85 overflowed an 8.8-wide card). Title width budget is
  // 7.6 units at ~0.5 em per char.
  if (scene.textCard) {
    const title = scene.textCard.title.toUpperCase();
    const sub = scene.textCard.sub;
    const titleSize = Math.min(0.85, 7.6 / (title.length * 0.5));
    parts.push(
      `<g>` +
        `<rect x="-4.4" y="-5.6" width="8.8" height="2.6" rx="0.15" fill="#f0f0e0" stroke="${INK}" stroke-width="0.12"/>` +
        `<text x="0" y="-4.35" text-anchor="middle" font-family="${HAND_FONT}" font-size="${fmt(titleSize)}" font-weight="bold" fill="${INK}">${escapeXml(title)}</text>` +
        (sub
          ? `<text x="0" y="-3.5" text-anchor="middle" font-family="${HAND_FONT}" font-size="0.48" fill="${INK}">${escapeXml(sub)}</text>`
          : "") +
        `</g>`,
    );
  }

  // Name labels under feet (style guide: SARAH / JOHN).
  if (scene.nameLabels) {
    for (const rp of renderedPlacements) {
      parts.push(
        `<text x="${fmt(rp.x)}" y="0.62" text-anchor="middle" font-family="${HAND_FONT}" font-size="0.42" font-weight="bold" fill="${INK}">${escapeXml(rp.name.toUpperCase())}</text>`,
      );
    }
  }

  // Watermark slot (R20): small box, bottom-right, every frame.
  // Positioned relative to the CURRENT camera viewBox, not in
  // absolute wide-camera coordinates: the old fixed translate
  // (5.15, 1.15) sat outside the frame on medium/close-up cameras
  // (their viewBoxes end at x=5 / y=0.2) and clipped to
  // "HARACTER STUDIO" (QA 2026-11-05). Size scales with the
  // viewBox width so it reads the same in every framing.
  if (scene.watermark) {
    const [vbX, vbY, vbW, vbH] = viewBox.split(/\s+/).map(Number);
    const wScale = vbW / 16;
    const boxW = 2.6 * wScale;
    const boxH = 0.55 * wScale;
    const wx = vbX + vbW - boxW - 0.15 * wScale;
    const wy = vbY + vbH - boxH - 0.15 * wScale;
    parts.push(
      `<g transform="translate(${fmt(wx)},${fmt(wy)})">` +
        `<rect x="0" y="0" width="${fmt(boxW)}" height="${fmt(boxH)}" rx="${fmt(0.08 * wScale)}" fill="#ffffff" opacity="0.88" stroke="${INK}" stroke-width="${fmt(0.07 * wScale)}"/>` +
        `<text x="${fmt(boxW / 2)}" y="${fmt(boxH * 0.67)}" text-anchor="middle" font-family="${HAND_FONT}" font-size="${fmt(0.26 * wScale)}" font-weight="bold" fill="${INK}">CHARACTER STUDIO</text>` +
        `</g>`,
    );
  }

  const defs =
    `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="${fmt(grainFreq, 1)}" numOctaves="2" seed="3"/>` +
    `<feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0"/></filter>` +
    `<filter id="hand" x="-2%" y="-2%" width="104%" height="104%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${fmt(handFreq, 3)}" numOctaves="2" seed="${scene.seed}" result="t"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="t" scale="${fmt(dispScale, 4)}"/></filter>` +
    `<radialGradient id="fireGlow" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="#ff9a2a" stop-opacity="0.55"/>` +
    `<stop offset="60%" stop-color="#ff7a1a" stop-opacity="0.22"/>` +
    `<stop offset="100%" stop-color="#ff7a1a" stop-opacity="0"/></radialGradient>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="Scene: ${escapeXml(scene.name)}">` +
    `<defs>${defs}</defs>` +
    `<g filter="url(#hand)">${parts.join("")}</g>` +
    `<rect x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(vbH)}" filter="url(#grain)"/></svg>`;

  const ms = typeof performance !== "undefined" ? performance.now() - t0 : 0;
  return { svg, warnings, ms };
}

/* ------------------------------------------------------------------ */
/* Storage — mirrors cast.ts: typed JSON, validated on load.           */
/* ------------------------------------------------------------------ */

export const SCENES_STORAGE_KEY = "character-studio:scenes:v1";
export const SCENE_DRAFT_KEY = "character-studio:scenes:draft:v1";

export interface ScenesLoadResult {
  scenes: Scene[];
  dropped: number;
}

function readRaw(key: string): unknown {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return { __corrupt: true };
  }
}

export function loadScenes(): ScenesLoadResult {
  const raw = readRaw(SCENES_STORAGE_KEY);
  if (raw === null || !Array.isArray(raw)) return { scenes: [], dropped: Array.isArray(raw) ? 0 : 0 };
  const scenes: Scene[] = [];
  let dropped = 0;
  for (const entry of raw) {
    const result = validateScene(entry);
    if (result.ok) scenes.push(result.scene);
    else dropped += 1;
  }
  return { scenes, dropped };
}

export function saveScenes(scenes: Scene[]): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    window.localStorage.setItem(SCENES_STORAGE_KEY, JSON.stringify(scenes));
    return true;
  } catch {
    return false;
  }
}

export function upsertScene(scenes: Scene[], s: Scene): Scene[] {
  return [...scenes.filter((x) => x.id !== s.id), s];
}

export function removeScene(scenes: Scene[], id: string): Scene[] {
  return scenes.filter((x) => x.id !== id);
}

export function loadDraft(): { scene: Scene; notice: string | null } {
  const raw = readRaw(SCENE_DRAFT_KEY);
  if (raw === null) return { scene: defaultScene(), notice: null };
  const result = validateScene(raw);
  if (result.ok) return { scene: result.scene, notice: "Saved scene restored." };
  return { scene: defaultScene(), notice: `Saved scene was invalid (${result.error}) — started fresh.` };
}

export function saveDraft(scene: Scene): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    window.localStorage.setItem(SCENE_DRAFT_KEY, JSON.stringify(scene));
    return true;
  } catch {
    return false;
  }
}

/** Validate an imported cast list (used by renderers/tests). */
export function validateCastList(data: unknown): Character[] {
  if (!Array.isArray(data)) return [];
  const out: Character[] = [];
  for (const entry of data) {
    const r = validateCharacter(entry);
    if (r.ok) out.push(r.character);
  }
  return out;
}
