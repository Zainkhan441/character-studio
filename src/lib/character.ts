/**
 * Character schema for Character Studio.
 *
 * Ported from the reference engine `engine/ink.py` (POSES, HAIR_COLORS,
 * OUTFITS). A character is DATA, not a picture — the renderer in
 * ./renderer.ts draws any character in any pose from this data alone.
 *
 * Versions (verified 2026-11-05, research-first):
 * - zod 4.6.7 (npm, latest stable, Oct 12 2026)
 * - vitest 5.0.5 (tests), vite 6.4.0 (vitest peer)
 * - next 14.2.35, typescript 5.x (strict), react 18
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Poses — ported verbatim from ink.py POSES.                          */
/* Tuple: (lean, backArm, frontArm, backLeg, frontLeg, kind, behind)  */
/* Limb = (upper angle, bend) in degrees; 0 = straight down,          */
/* + = forward.                                                        */
/* ------------------------------------------------------------------ */

export const POSE_NAMES = [
  "stand",
  "walk",
  "run",
  "think",
  "point",
  "wave",
  "cheer",
  "shrug",
  "hold",
  "hold_up",
  "aim",
  "throw",
  "dig",
  "kneel",
  "sit",
  "sit_knees",
  "recline",
  "lie",
  "sad",
  "hug",
  "facepalm",
] as const;
export type PoseName = (typeof POSE_NAMES)[number];

export type PoseKind = "feet" | "sit" | "lie";

/** [upperAngleDeg, bendDeg] for one two-segment limb. */
export type LimbAngles = readonly [number, number];

export interface PoseDef {
  lean: number;
  backArm: LimbAngles;
  frontArm: LimbAngles;
  backLeg: LimbAngles;
  frontLeg: LimbAngles;
  kind: PoseKind;
  armsBehindHead: boolean;
}

const pose = (
  lean: number,
  backArm: LimbAngles,
  frontArm: LimbAngles,
  backLeg: LimbAngles,
  frontLeg: LimbAngles,
  kind: PoseKind,
  armsBehindHead: boolean,
): PoseDef => ({ lean, backArm, frontArm, backLeg, frontLeg, kind, armsBehindHead });

export const POSES: Record<PoseName, PoseDef> = {
  stand: pose(0, [-10, 8], [10, -8], [-8, 2], [8, -2], "feet", false),
  walk: pose(4, [-28, -8], [28, 25], [-22, -18], [22, -4], "feet", false),
  run: pose(16, [-55, 80], [60, 75], [-45, -55], [50, -70], "feet", false),
  think: pose(0, [8, 100], [40, 155], [-5, 0], [5, 0], "feet", false),
  point: pose(0, [-8, 6], [92, 0], [-5, 0], [6, 0], "feet", false),
  wave: pose(0, [-8, 6], [115, 45], [-5, 0], [5, 0], "feet", false),
  // Cheer (fixed 2026-11-05, M1): the original angles [155,15]/[-155,-15]
  // drove both elbows THROUGH the head circle (elbow ~0.54 from head
  // centre, head radius 1) — the front arm speared across the face.
  // [115,30]/[-115,-30] puts both elbows ~1.16 from the head centre
  // with hands high at (+/-1.60,-2.88). Verified by the pose-matrix
  // test (no arm segment may pass within 0.5 of the head centre).
  cheer: pose(0, [-115, -30], [115, 30], [-12, 0], [12, 0], "feet", false),
  shrug: pose(0, [-55, 120], [55, -120], [-5, 0], [5, 0], "feet", false),
  hold: pose(0, [-8, 6], [25, 55], [-5, 0], [5, 0], "feet", false),
  hold_up: pose(0, [-8, 6], [40, 95], [-5, 0], [5, 0], "feet", false),
  aim: pose(6, [60, 25], [88, 8], [-22, -6], [22, 0], "feet", false),
  throw: pose(-6, [60, 20], [-120, -40], [-25, -10], [25, 0], "feet", false),
  dig: pose(32, [50, 20], [70, 10], [-15, -60], [70, -95], "feet", false),
  kneel: pose(12, [20, 40], [55, 20], [-80, -100], [60, -60], "feet", false),
  sit: pose(-8, [35, 15], [45, 20], [95, -15], [78, -40], "sit", false),
  sit_knees: pose(-4, [30, 55], [55, 70], [115, -135], [125, -140], "sit", false),
  recline: pose(-55, [150, 140], [140, 150], [90, -8], [70, -55], "sit", true),
  lie: pose(0, [150, 140], [140, 150], [0, 0], [40, -80], "lie", true),
  sad: pose(6, [-3, 4], [3, -4], [-4, 0], [4, 0], "feet", false),
  hug: pose(10, [32, 104], [-32, -104], [-6, 2], [6, -2], "feet", false),
  facepalm: pose(8, [-5, 5], [30, 150], [-5, 0], [5, 0], "feet", false),
};

/** Poses shown in the creator UI (the 6 most useful first). */
export const CREATOR_POSES: readonly PoseName[] = [
  "stand",
  "walk",
  "think",
  "point",
  "cheer",
  "sit",
];

/* ------------------------------------------------------------------ */
/* Faces / expressions — the `face` names face_svg() understands.       */
/* ------------------------------------------------------------------ */

export const FACE_NAMES = [
  "neutral",
  "happy",
  "content",
  "big_smile",
  "smirk",
  "sad",
  "worried",
  "angry",
  "surprised",
  "scared",
  "shocked",
  "thinking",
  "sleepy",
] as const;
export type FaceName = (typeof FACE_NAMES)[number];

/** Expressions shown in the creator UI. */
export const CREATOR_EXPRESSIONS: readonly FaceName[] = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "worried",
];

export const LOOK_NAMES = ["forward", "up", "down", "back", "viewer"] as const;
export type LookName = (typeof LOOK_NAMES)[number];

/* ------------------------------------------------------------------ */
/* Hair — ported from ink.py hair_svg() + HAIR_COLORS.                  */
/* ------------------------------------------------------------------ */

export const HAIR_STYLES = [
  "none",
  "ragged",
  "shaggy",
  "spiky",
  "spiky_long",
  "messy",
  "wild",
  "mop",
  "wavy",
  "short",
  "long",
  "bun",
  "beard",
] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const HAIR_COLORS = {
  brown: { base: "#5b3a24", dark: "#3b2416", light: "#7a5236" },
  black: { base: "#2a2420", dark: "#141110", light: "#4a403a" },
  blond: { base: "#c99a4a", dark: "#8f6a2c", light: "#e2bd72" },
  grey: { base: "#a8a29a", dark: "#6f6a64", light: "#cfcac2" },
  red: { base: "#9c4a26", dark: "#6a2f16", light: "#c46a3a" },
} as const;
export type HairColorName = keyof typeof HAIR_COLORS;

/* ------------------------------------------------------------------ */
/* Hats — ported from ink.py hat_svg().                                */
/* ------------------------------------------------------------------ */

export const HAT_NAMES = [
  "none",
  "explorer",
  "crown",
  "helmet",
  "headband",
  "fur",
  "frost",
  "wizard",
] as const;
export type HatName = (typeof HAT_NAMES)[number];

/* ------------------------------------------------------------------ */
/* Outfits — ported verbatim from ink.py OUTFITS.                      */
/* torso shape + colour; sleeve none/short/long; pants; shoes colour.  */
/* ------------------------------------------------------------------ */

export type SleeveKind = "none" | "short" | "long";
export type LegsKind = "long" | "shorts" | "robe" | "robe_short" | "tunic";
export type CollarKind =
  | "crew"
  | "vneck"
  | "hood"
  | "suit"
  | "safari"
  | "coat"
  | "tunic"
  | "armor"
  | "robe"
  | "toga";

export interface OutfitDef {
  top: string;
  sleeve: SleeveKind;
  pants: string | null;
  legs: LegsKind;
  shoes: string;
  collar: CollarKind;
}

export const OUTFIT_NAMES = [
  "none",
  "caveman",
  "cavedress",
  "shirt",
  "shirt_red",
  "shirt_green",
  "hoodie",
  "suit",
  "explorer",
  "farmer",
  "doctor",
  "medieval",
  "soldier",
  "robe",
  "robe_red",
  "robe_blue",
  "robe_purple",
  "toga",
] as const;
export type OutfitName = (typeof OUTFIT_NAMES)[number];

export const OUTFITS: Record<Exclude<OutfitName, "none" | "caveman" | "cavedress">, OutfitDef> = {
  shirt: { top: "#5b8dc9", sleeve: "short", pants: "#3d4a63", legs: "long", shoes: "#3a2a20", collar: "crew" },
  shirt_red: { top: "#c9574b", sleeve: "short", pants: "#3d4a63", legs: "long", shoes: "#3a2a20", collar: "crew" },
  shirt_green: { top: "#5e9a5a", sleeve: "short", pants: "#5a4a3a", legs: "long", shoes: "#3a2a20", collar: "crew" },
  hoodie: { top: "#7a7f8a", sleeve: "long", pants: "#2f3542", legs: "long", shoes: "#f2f2f2", collar: "hood" },
  suit: { top: "#2f3440", sleeve: "long", pants: "#2f3440", legs: "long", shoes: "#1e1a17", collar: "suit" },
  explorer: { top: "#c9b07a", sleeve: "short", pants: "#b39a68", legs: "shorts", shoes: "#5a3d24", collar: "safari" },
  farmer: { top: "#d8c9a3", sleeve: "short", pants: "#7a5a3a", legs: "long", shoes: "#5a3d24", collar: "vneck" },
  doctor: { top: "#f4f4f2", sleeve: "long", pants: "#4a6fa5", legs: "long", shoes: "#2a2a2a", collar: "coat" },
  medieval: { top: "#7b4b8f", sleeve: "long", pants: "#4a3a2a", legs: "long", shoes: "#3a2a20", collar: "tunic" },
  soldier: { top: "#b9b2a6", sleeve: "short", pants: "#8a2f28", legs: "tunic", shoes: "#5a3d24", collar: "armor" },
  robe: { top: "#e9e3d4", sleeve: "long", pants: null, legs: "robe", shoes: "#8a6a44", collar: "robe" },
  robe_red: { top: "#b5453a", sleeve: "long", pants: null, legs: "robe", shoes: "#8a6a44", collar: "robe" },
  robe_blue: { top: "#4f6f9e", sleeve: "long", pants: null, legs: "robe", shoes: "#8a6a44", collar: "robe" },
  robe_purple: { top: "#6b4a8a", sleeve: "long", pants: null, legs: "robe", shoes: "#8a6a44", collar: "robe" },
  toga: { top: "#f1ece0", sleeve: "none", pants: null, legs: "robe_short", shoes: "#8a6a44", collar: "toga" },
};

/* ------------------------------------------------------------------ */
/* Held props — ported from ink.py prop_svg().                          */
/* ------------------------------------------------------------------ */

export const PROP_NAMES = [
  "none",
  "spear",
  "stick",
  "staff",
  "torch",
  "notebook",
  "phone",
  "shovel",
  "scroll",
  "fish",
  "meat",
  "book",
  "coin",
  "sword",
] as const;
export type PropName = (typeof PROP_NAMES)[number];

/* ------------------------------------------------------------------ */
/* Zod schemas — validation for anything untrusted (localStorage,      */
/* future API/DB rows). Never trust raw JSON: parse it or reject it.    */
/* ------------------------------------------------------------------ */

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb colour");

const limbAnglesSchema = z.tuple([z.number(), z.number()]);

export const ProportionsSchema = z.object({
  /** Head radius in character units (ink.py: 1). */
  headRadius: z.number().min(0.5).max(2).default(1),
  /**
   * Hip-to-neck length. Rescaled 2026-11-05 (M1) from the engine's
   * 1.85 to 1.3 per the measured YouTube style guide: the reference
   * head is 39% of total standing height (head diameter 2.0 / total
   * ~5.2), torso ≈ 1.1–1.3 head radii, legs ≈ 1.9 radii. The whole
   * body (arms + legs) is scaled with it so limbs still hang to
   * mid-thigh. R1 in the style guide.
   */
  torso: z.number().min(0.8).max(3).default(1.3),
  upperArm: z.number().min(0.5).max(2).default(0.8),
  lowerArm: z.number().min(0.5).max(2).default(0.75),
  upperLeg: z.number().min(0.5).max(2).default(0.95),
  lowerLeg: z.number().min(0.5).max(2).default(0.9),
});

export const FaceSchema = z.object({
  expression: z.enum(FACE_NAMES).default("neutral"),
  look: z.enum(LOOK_NAMES).default("forward"),
  /** Eye size multiplier (1 = engine default). */
  eyeSize: z.number().min(0.5).max(2).default(1),
  /** Eye spacing multiplier (1 = engine default). */
  eyeSpacing: z.number().min(0.5).max(2).default(1),
  blush: z.boolean().default(false),
  /** Long lashes (female characters in the reference engine). */
  lashes: z.boolean().default(false),
  stubble: z.boolean().default(false),
  /** 0 = closed mouth, 1 = fully open (lip-sync hook). */
  mouth: z.number().min(0).max(1).default(0),
  blink: z.boolean().default(false),
  cold: z.boolean().default(false),
});

export const HairSchema = z.object({
  style: z.enum(HAIR_STYLES).default("short"),
  color: z.enum(["brown", "black", "blond", "grey", "red"] as const).default("brown"),
  /** Beard on/off + style (ink.py beard_svg). */
  beard: z.enum(["none", "full", "long"] as const).default("none"),
});

export const OutfitSchema = z.object({
  outfit: z.enum(OUTFIT_NAMES).default("shirt"),
  /** Fur colour for caveman / cavedress. */
  furColor: hexColor.default("#8b5a33"),
  shoes: z.boolean().default(true),
  furBoots: z.boolean().default(false),
  /** Shoe colour override (null = the outfit's own shoes). */
  shoeColor: hexColor.nullable().default(null),
  /** Legs override for the wardrobe (null = the outfit's own legs). */
  legsOverride: z.enum(["long", "shorts"] as const).nullable().default(null),
  /** Neck accessory (scarf draws over the garment, under the head). */
  accessory: z.enum(["none", "scarf"] as const).default("none"),
  accessoryColor: hexColor.default("#c0392b"),
  hat: z.enum(HAT_NAMES).default("none"),
  hold: z.enum(PROP_NAMES).default("none"),
  holdHand: z.enum(["front", "back"] as const).default("front"),
  holdAngle: z.number().default(0),
});

/* ------------------------------------------------------------------ */
/* Era packs — one-click wardrobe presets for the creator page.        */
/* A pack patches the outfit + hat + hair style, nothing else.         */
/* ------------------------------------------------------------------ */

export interface EraPack {
  id: string;
  name: string;
  description: string;
  outfit: OutfitName;
  hat: HatName;
  hairStyle: HairStyle;
}

export const ERA_PACKS: EraPack[] = [
  {
    id: "modern",
    name: "Modern",
    description: "T-shirt, jeans, short hair — today's creator.",
    outfit: "shirt",
    hat: "none",
    hairStyle: "short",
  },
  {
    id: "medieval",
    name: "Medieval",
    description: "Tunic, long hair — knights, castles, quests.",
    outfit: "medieval",
    hat: "none",
    hairStyle: "long",
  },
  {
    id: "stone-age",
    name: "Stone Age",
    description: "Fur, ragged hair — the original Ink Explainer look.",
    outfit: "caveman",
    hat: "none",
    hairStyle: "ragged",
  },
];

export const StyleSchema = z.object({
  /** Ink colour for outlines. */
  ink: hexColor.default("#211c19"),
  /** Limb line width (ink.py LW = 0.095, head radius = 1). */
  limbWidth: z.number().min(0.03).max(0.2).default(0.095),
  /** Outline width (ink.py OW = 0.075). */
  outlineWidth: z.number().min(0.02).max(0.2).default(0.075),
  /**
   * Hand-drawn wobble multiplier. 0 = perfectly straight lines.
   * The renderer converts this to a feDisplacementMap scale in
   * character units (0.05 * wobble at the default framing).
   */
  wobble: z.number().min(0).max(5).default(1),
  /**
   * Skin fill of the head — a per-character setting, not a global
   * constant (style guide R8, measured): white for night scenes,
   * tan for day scenes, silhouette for distant/scale shots. The
   * renderer maps it to fill + shade + face-ink colours.
   */
  skin: z.enum(["white", "tan", "silhouette"] as const).default("white"),
  /** Seeded RNG seed — same seed + same character = same SVG. */
  seed: z.number().int().min(0).max(100000).default(7),
});

export const CharacterSchema = z.object({
  id: z.string().min(1).default("char-1"),
  name: z.string().min(1).max(60).default("Untitled"),
  pose: z.enum(POSE_NAMES).default("stand"),
  /** Extra torso lean in degrees (added to the pose lean). */
  lean: z.number().min(-30).max(30).default(0),
  /** Per-limb overrides — null means "use the pose table". */
  backArm: limbAnglesSchema.nullable().default(null),
  frontArm: limbAnglesSchema.nullable().default(null),
  backLeg: limbAnglesSchema.nullable().default(null),
  frontLeg: limbAnglesSchema.nullable().default(null),
  facing: z.enum(["right", "left"] as const).default("right"),
  scale: z.number().min(0.2).max(3).default(1),
  shadow: z.boolean().default(true),
  proportions: ProportionsSchema.prefault({}),
  face: FaceSchema.prefault({}),
  hair: HairSchema.prefault({}),
  outfit: OutfitSchema.prefault({}),
  style: StyleSchema.prefault({}),
});

export type Character = z.output<typeof CharacterSchema>;
export type CharacterInput = z.input<typeof CharacterSchema>;

/** A ready-to-render default character (modern-casual: shirt, short hair, stand). */
export function defaultCharacter(): Character {
  const parsed = CharacterSchema.safeParse({});
  if (!parsed.success) {
    // This can never happen: every field has a default. But never fail
    // silently — throw a typed error rather than returning a half object.
    throw new Error(`defaultCharacter failed to validate: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Validate untrusted data (localStorage, JSON import) into a Character.
 * Returns a discriminated result — never throws on bad input.
 */
export type CharacterValidation =
  | { ok: true; character: Character }
  | { ok: false; error: string };

export function validateCharacter(data: unknown): CharacterValidation {
  const parsed = CharacterSchema.safeParse(data);
  if (parsed.success) {
    return { ok: true, character: parsed.data };
  }
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}
