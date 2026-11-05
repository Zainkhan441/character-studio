/**
 * Script-to-video (M2, 2026-11-05).
 *
 * The winning format is a slideshow of stills with hard cuts
 * (style guide §5, measured: 300 shots in 882s, median 2.3s, 73%
 * ≤ 3s, frames pixel-identical inside a shot). So the storyboard
 * model is: one script line = one shot; a long line splits into
 * two DIFFERENT shots (never the same frame held longer); every
 * shot is a still scene rendered by renderScene().
 *
 * Pure + deterministic: same script + same cast ids => same shots.
 */
import {
  BACKGROUND_IDS,
  defaultScene,
  type BackgroundId,
  type CameraKind,
  type CutawayId,
  type LightingKind,
  type PropId,
  type Scene,
  type Variant,
} from "./scene";
import { FACE_NAMES, POSE_NAMES, type FaceName, type PoseName } from "./character";
import { ANIMAL_SPECIES, type AnimalSpecies } from "./animals";

/** Narration pace (words per minute) used for shot timing. */
export const WORDS_PER_MINUTE = 150;
/** A shot longer than this splits into two different shots. */
export const MAX_SHOT_SECONDS = 4.5;
/** Clamp for a single shot's hold time. */
export const MIN_SHOT_SECONDS = 1.2;
export const MAX_LINE_SECONDS = 20;

export function wordsIn(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Seconds of narration for a word count, clamped to sane bounds. */
export function secondsForWords(words: number): number {
  const raw = (words / WORDS_PER_MINUTE) * 60;
  return Math.max(MIN_SHOT_SECONDS, Math.min(MAX_LINE_SECONDS, raw));
}

export function secondsForText(text: string): number {
  return secondsForWords(wordsIn(text));
}

/**
 * Split a long line into two halves for two different shots.
 * Prefers a sentence end or comma near the middle; falls back to
 * the word midpoint. Returns null when the line is short enough
 * for one shot.
 */
export function splitLine(text: string): [string, string] | null {
  if (secondsForText(text) <= MAX_SHOT_SECONDS) return null;
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 10) return null;
  const mid = Math.floor(words.length / 2);
  // Prefer a boundary near the middle: a word ending in . ! ? , ; :
  let best = mid;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = Math.max(2, mid - 4); i <= Math.min(words.length - 2, mid + 4); i++) {
    if (/[.!?,:;]$/.test(words[i])) {
      const d = Math.abs(i + 1 - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i + 1;
      }
    }
  }
  const first = words.slice(0, best).join(" ");
  const second = words.slice(best).join(" ");
  if (wordsIn(first) < 3 || wordsIn(second) < 3) return null;
  return [first, second];
}

/**
 * A line is a title-card shot when it is short, all-caps (or ends
 * with a colon) and has no sentence-ending punctuation — e.g.
 * "HOOK", "THE FIRST NIGHT", "Chapter 1: Fire".
 */
export function isTitleCard(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (t.endsWith(":")) return true;
  const words = t.split(/\s+/);
  if (words.length > 6) return false;
  if (/[.!?]$/.test(t)) return false;
  // Chapter headers: "Chapter 1: Fire" — a colon early in a short line.
  const colonAt = t.indexOf(":");
  if (colonAt > 0 && colonAt <= 20) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  return letters === letters.toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Shot scenes                                                         */
/* ------------------------------------------------------------------ */

export interface ShotProp {
  prop: PropId;
  x: number;
  scale: number;
  text?: string;
}

export interface ShotScene {
  background: BackgroundId;
  variant: Variant;
  camera: CameraKind;
  lighting: LightingKind;
  cutaway: CutawayId | null;
  pose: PoseName;
  expression: FaceName;
  characterId: string | null;
  props: ShotProp[];
  animal: { species: AnimalSpecies; x: number; scale: number } | null;
  textCard: { title: string; sub: string } | null;
}

export interface Shot {
  id: string;
  /** The narration text for this shot. */
  text: string;
  /** 1 of 1, or 1/2 of a split line. */
  part: 1 | 2;
  ofParts: 1 | 2;
  durationSec: number;
  scene: ShotScene;
}

const ROTATION_BACKGROUNDS: BackgroundId[] = [
  "savanna",
  "hut",
  "cave",
  "forest",
  "village",
  "snow",
  "desert",
  "house",
  "modern",
  "city",
];

interface KeywordRule {
  re: RegExp;
  apply: (s: ShotScene) => void;
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    re: /\b(night|dark|stars|moon|midnight|evening)\b/i,
    apply: (s) => {
      s.variant = "night";
    },
  },
  {
    re: /\b(snow|winter|cold|ice|frozen|blizzard)\b/i,
    apply: (s) => {
      s.background = "snow";
    },
  },
  {
    re: /\bcave\b/i,
    apply: (s) => {
      s.background = "cave";
    },
  },
  {
    re: /\b(igloo)\b/i,
    apply: (s) => {
      s.cutaway = "igloo";
    },
  },
  {
    re: /\b(underground|below the|layers of|soil|buried|digging|dig\b)/i,
    apply: (s) => {
      s.cutaway = "soil";
    },
  },
  {
    re: /\b(inside the house|cut-away|cutaway)\b/i,
    apply: (s) => {
      s.cutaway = "house";
    },
  },
  {
    re: /\b(fire|flame|burn|hearth|bonfire|campfire)\b/i,
    apply: (s) => {
      s.lighting = "fire";
      if (!s.props.some((p) => p.prop === "fire")) s.props.push({ prop: "fire", x: 3.2, scale: 1 });
      if (s.background === "savanna") s.background = "hut";
    },
  },
  {
    // NOTE: "inside" is deliberately NOT in this list — "inside the
    // cave" must stay a cave, not become a house (rule-order bug
    // caught by tests 2026-11-05).
    re: /\b(house|home|room|kitchen|bedroom)\b/i,
    apply: (s) => {
      s.background = "house";
    },
  },
  {
    re: /\b(king|queen|crown|castle|throne|palace|city)\b/i,
    apply: (s) => {
      s.background = "city";
      s.pose = "stand";
    },
  },
  {
    re: /\b(war|battle|fight|soldier|army|attack)\b/i,
    apply: (s) => {
      s.background = "forest";
      s.pose = "aim";
      s.expression = "angry";
    },
  },
  {
    re: /\b(travel|walk|journey|migration|road|wander)\b/i,
    apply: (s) => {
      s.pose = "walk";
      s.background = "savanna";
    },
  },
  {
    re: /\b(sleep|dream|bed|tired|rest)\b/i,
    apply: (s) => {
      s.pose = "lie";
      s.variant = "night";
    },
  },
  {
    re: /\b(think|wonder|question|why|idea|realise|realize)\b/i,
    apply: (s) => {
      s.pose = "think";
      s.expression = "thinking";
    },
  },
  {
    re: /\b(point|look|see|show|watch|notice)\b/i,
    apply: (s) => {
      s.pose = "point";
      if (!s.props.some((p) => p.prop === "arrow")) s.props.push({ prop: "arrow", x: 3.5, scale: 1 });
    },
  },
  {
    re: /\b(hunt|spear|mammoth|animal|deer|prey)\b/i,
    apply: (s) => {
      s.pose = "aim";
      s.background = "savanna";
    },
  },
  {
    re: /\b(food|eat|meat|cook|meal|hungry)\b/i,
    apply: (s) => {
      s.pose = "hold";
      if (!s.props.some((p) => p.prop === "basket")) s.props.push({ prop: "basket", x: 3.0, scale: 1 });
    },
  },
  {
    re: /\b(happy|laugh|celebrat|cheer|win)\b/i,
    apply: (s) => {
      s.pose = "cheer";
      s.expression = "happy";
    },
  },
  {
    re: /\b(sad|died|death|lost|grief|alone)\b/i,
    apply: (s) => {
      s.pose = "sad";
      s.expression = "sad";
    },
  },
  {
    re: /\b(horse)\b/i,
    apply: (s) => {
      s.animal = { species: "horse", x: 3.4, scale: 0.8 };
    },
  },
  {
    re: /\b(cow|cattle)\b/i,
    apply: (s) => {
      s.animal = { species: "cow", x: 3.4, scale: 0.8 };
    },
  },
  {
    re: /\b(goat)\b/i,
    apply: (s) => {
      s.animal = { species: "goat", x: 3.4, scale: 0.8 };
    },
  },
  {
    re: /\b(dog|wolf)\b/i,
    apply: (s) => {
      s.animal = { species: "dog", x: 3.4, scale: 0.8 };
    },
  },
];

/**
 * Suggest a scene for one narration line. Deterministic: the same
 * line + index + cast always suggests the same scene. Keyword rules
 * win; otherwise the background rotates so consecutive shots never
 * look identical.
 */
export function suggestScene(line: string, index: number, castIds: string[]): ShotScene {
  const s: ShotScene = {
    background: ROTATION_BACKGROUNDS[index % ROTATION_BACKGROUNDS.length],
    variant: "day",
    camera: index % 3 === 2 ? "closeup" : index % 3 === 1 ? "medium" : "wide",
    lighting: "none",
    cutaway: null,
    pose: index % 4 === 3 ? "walk" : index % 4 === 1 ? "point" : "stand",
    expression: "neutral",
    characterId: castIds.length > 0 ? castIds[index % castIds.length] : null,
    props: [],
    animal: null,
    textCard: null,
  };
  if (isTitleCard(line)) {
    s.textCard = { title: line.replace(/:$/, ""), sub: "" };
    s.background = "modern";
    s.camera = "wide";
    s.characterId = null;
    return s;
  }
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(line)) rule.apply(s);
  }
  return s;
}

/** Split a line into one or two shots (long lines => two shots). */
export function lineToShots(line: string, index: number, castIds: string[]): Shot[] {
  const base = suggestScene(line, index, castIds);
  const split = splitLine(line);
  if (!split) {
    return [
      {
        id: `shot-${index}-1`,
        text: line,
        part: 1,
        ofParts: 1,
        durationSec: secondsForText(line),
        scene: base,
      },
    ];
  }
  const [first, second] = split;
  // Part 2 must look DIFFERENT: different camera framing, and a
  // different background when the first was a rotation pick.
  const secondScene: ShotScene = {
    ...base,
    background:
      base.background === "savanna"
        ? "hut"
        : base.cutaway
          ? base.background
          : ROTATION_BACKGROUNDS[(index + 1) % ROTATION_BACKGROUNDS.length],
    camera: base.camera === "closeup" ? "medium" : "closeup",
    pose: base.pose === "point" ? "stand" : "point",
    props: base.props.map((p) => ({ ...p })),
    textCard: base.textCard ? { ...base.textCard } : null,
  };
  return [
    { id: `shot-${index}-1`, text: first, part: 1, ofParts: 2, durationSec: secondsForText(first), scene: base },
    { id: `shot-${index}-2`, text: second, part: 2, ofParts: 2, durationSec: secondsForText(second), scene: secondScene },
  ];
}

/** Split raw script text into clean, non-empty lines. */
export function parseScript(script: string): string[] {
  return script
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^\s*(?:\d+[.)]\s+|[-•*]\s+)/, ""))
    .filter((l) => l.length > 0);
}

export interface Storyboard {
  shots: Shot[];
  totalSec: number;
  lineCount: number;
  /** Shots per minute — the reference format runs ~25–30. */
  shotsPerMinute: number;
}

export function buildStoryboard(script: string, castIds: string[]): Storyboard {
  const lines = parseScript(script);
  const shots: Shot[] = [];
  lines.forEach((line, i) => {
    shots.push(...lineToShots(line, i, castIds));
  });
  const totalSec = shots.reduce((sum, s) => sum + s.durationSec, 0);
  return {
    shots,
    totalSec,
    lineCount: lines.length,
    shotsPerMinute: totalSec > 0 ? (shots.length / totalSec) * 60 : 0,
  };
}

/** "m:ss" for a total runtime. */
export function formatDuration(totalSec: number): string {
  const total = Math.round(totalSec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Convert a shot into a full Scene for renderScene(). The shot's
 * character (if any) stands at x = -2.5, props/animals keep their
 * suggested positions, and the text card (if any) becomes the
 * scene's text card.
 */
export function shotToScene(shot: Shot, seed: number): Scene {
  const base = defaultScene();
  const sc = shot.scene;
  return {
    ...base,
    id: shot.id,
    name: `Shot: ${shot.text.slice(0, 40)}`,
    background: sc.background,
    variant: sc.variant,
    camera: sc.camera,
    lighting: sc.lighting,
    cutaway: sc.cutaway,
    placements: sc.characterId
      ? [
          {
            id: `${shot.id}-char`,
            characterId: sc.characterId,
            x: -2.5,
            scale: 1,
            flip: false,
            pose: sc.pose,
            expression: sc.expression,
          },
        ]
      : [],
    props: sc.props.map((p, i) => ({
      id: `${shot.id}-prop-${i}`,
      prop: p.prop,
      x: p.x,
      y: 0,
      scale: p.scale,
      text: p.text ?? "",
    })),
    animals: sc.animal
      ? [{ id: `${shot.id}-animal`, species: sc.animal.species, x: sc.animal.x, scale: sc.animal.scale, flip: false }]
      : [],
    textCard: sc.textCard,
    watermark: true,
    nameLabels: false,
    seed,
  };
}

/** Guard: the vocab this module depends on is fully wired. */
export function vocabCheck(): { backgrounds: number; poses: number; faces: number; animals: number } {
  return {
    backgrounds: BACKGROUND_IDS.length,
    poses: POSE_NAMES.length,
    faces: FACE_NAMES.length,
    animals: ANIMAL_SPECIES.length,
  };
}
