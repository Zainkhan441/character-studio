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
  /** Plain-English why this scene was chosen (one line). */
  reason: string;
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
  /**
   * Optional note for the reason line when the rule matches but
   * changes nothing — the line names something with no matching
   * background / pose / prop in the vocab, so the reader can see
   * the gap instead of guessing.
   */
  note?: string;
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    re: /\b(night|dark|stars|moon|midnight|evening)\b/i,
    apply: (s) => {
      s.variant = "night";
    },
  },
  {
    re: /\b(dusk|sunset|sunsets|twilight)\b/i,
    apply: (s) => {
      s.variant = "dusk";
    },
  },
  {
    // Morning is the default variant, but an explicit dawn/morning
    // beats an earlier night match ("the night turned to dawn").
    re: /\b(morning|dawn|sunrise|daybreak|noon|midday)\b/i,
    apply: (s) => {
      s.variant = "day";
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
      // A specific cut-away (igloo / house) already named in the
      // line wins — "buried the camp, but inside the igloo" is an
      // igloo shot, not a soil shot (QA 2026-11-05).
      if (!s.cutaway) s.cutaway = "soil";
    },
  },
  {
    re: /\b(inside the house|cut-away|cutaway)\b/i,
    apply: (s) => {
      if (!s.cutaway) s.cutaway = "house";
    },
  },
  {
    re: /\b(fire|flame|flames|burn|hearth|bonfire|campfire)\b/i,
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
    re: /\b(war|battle|battlefield|fight|fought|soldier|soldiers|army|attack|sword|swords|shield)\b/i,
    apply: (s) => {
      s.background = "forest";
      s.pose = "aim";
      s.expression = "angry";
    },
  },
  {
    // Verb forms matter: "walked" does not match /\bwalk\b/ (no word
    // boundary inside "walked"), so list the forms (QA 2026-11-05).
    re: /\b(travel|travelled|travelling|traveling|travels|walk|walked|walking|walks|journey|migration|road|wander|follow|following)\b/i,
    apply: (s) => {
      s.pose = "walk";
      s.background = "savanna";
    },
  },
  {
    re: /\b(plain|plains|field|grassland|meadow|steppe|herd|herds)\b/i,
    apply: (s) => {
      if (!s.cutaway) s.background = "savanna";
    },
  },
  {
    // Named locations run AFTER the travel rule, so "walked through
    // the forest" is a forest, not the travel rule's savanna.
    re: /\b(forest|woods|jungle|trees|tree|pine)\b/i,
    apply: (s) => {
      s.background = "forest";
    },
  },
  {
    re: /\b(desert|sand|dune|dunes|oasis)\b/i,
    apply: (s) => {
      s.background = "desert";
    },
  },
  {
    re: /\b(village|market|town|settlement)\b/i,
    apply: (s) => {
      s.background = "village";
    },
  },
  {
    re: /\b(temple|shrine|altar)\b/i,
    apply: (s) => {
      s.background = "city";
    },
  },
  {
    // No river / mountain / boat in the 11-background vocab, and no
    // climb / swim pose in the 21-pose vocab — say so in the reason
    // instead of silently picking a wrong scene.
    re: /\b(river|stream|lake|sea|ocean|shore|beach)\b/i,
    apply: () => {
      /* no matching background — keep the rotation pick */
    },
    note: "river/sea has no matching background in the 11-background vocab — kept the rotated background",
  },
  {
    re: /\b(mountain|mountains|peak|peaks|cliff|valley)\b/i,
    apply: () => {
      /* no matching background — keep the rotation pick */
    },
    note: "mountain has no matching background in the 11-background vocab — kept the rotated background",
  },
  {
    re: /\b(boat|ship|raft|canoe)\b/i,
    apply: () => {
      /* no boat prop in the vocab */
    },
    note: "boat has no matching prop in the vocab — no prop added",
  },
  {
    re: /\b(climb|climbed|climbing|climbs|swim|swam|swimming|swims)\b/i,
    apply: () => {
      /* no climb / swim pose in the 21-pose vocab */
    },
    note: "climb/swim has no matching pose in the 21-pose vocab — kept the current pose",
  },
  {
    re: /\b(sleep|slept|sleeping|sleeps|dream|dreamed|dreaming|dreams|bed|tired|rest)\b/i,
    apply: (s) => {
      s.pose = "lie";
      s.variant = "night";
    },
  },
  {
    re: /\b(think|thinks|thinking|thought|wonder|wondered|wondering|question|why|idea|realise|realize)\b/i,
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
      // Pose only now: the old savanna pin overrode a named location
      // ("hunted in the forest" became savanna). The plain/forest /
      // desert rules own the background.
      s.pose = "aim";
    },
  },
  {
    re: /\b(food|eat|eats|eating|ate|meat|cook|cooks|cooked|cooking|meal|hungry)\b/i,
    apply: (s) => {
      s.pose = "hold";
      if (!s.props.some((p) => p.prop === "basket")) s.props.push({ prop: "basket", x: 3.0, scale: 1 });
    },
  },
  {
    re: /\b(book|scroll|letter|tablet)\b/i,
    apply: (s) => {
      s.pose = "hold";
    },
  },
  {
    re: /\b(run|ran|running|runs|fled|flee|chase|chased|escape|escaped)\b/i,
    apply: (s) => {
      s.pose = "run";
    },
  },
  {
    re: /\b(sit|sat|sitting|seated)\b/i,
    apply: (s) => {
      s.pose = "sit";
    },
  },
  {
    re: /\b(dig|digging|dug)\b/i,
    apply: (s) => {
      s.pose = "dig";
    },
  },
  {
    re: /\b(throw|threw|throwing|throws|hurled)\b/i,
    apply: (s) => {
      s.pose = "throw";
    },
  },
  {
    re: /\b(kneel|knelt|kneeling)\b/i,
    apply: (s) => {
      s.pose = "kneel";
    },
  },
  {
    re: /\b(wave|waved|waving|greet|greeted)\b/i,
    apply: (s) => {
      s.pose = "wave";
    },
  },
  {
    re: /\b(hug|hugged|embrace|embraced)\b/i,
    apply: (s) => {
      s.pose = "hug";
    },
  },
  {
    re: /\b(shrug|shrugged)\b/i,
    apply: (s) => {
      s.pose = "shrug";
    },
  },
  {
    re: /\b(happy|laugh|celebrat|cheer|win|proud|proudly|triumph|victory)\b/i,
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
    re: /\b(afraid|scared|fear|frightened|terrified)\b/i,
    apply: (s) => {
      s.expression = "scared";
    },
  },
  {
    re: /\b(worried|worry|anxious|nervous|uneasy)\b/i,
    apply: (s) => {
      s.expression = "worried";
    },
  },
  {
    re: /\b(surprised|surprise|amazed|astonished|shocked)\b/i,
    apply: (s) => {
      s.expression = "surprised";
    },
  },
  {
    re: /\b(angry|furious|rage|raged)\b/i,
    apply: (s) => {
      s.expression = "angry";
    },
  },
  {
    re: /\b(sleepy|exhausted)\b/i,
    apply: (s) => {
      s.expression = "sleepy";
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
  {
    re: /\b(torch)\b/i,
    apply: (s) => {
      s.lighting = "fire";
      if (!s.props.some((p) => p.prop === "torch")) s.props.push({ prop: "torch", x: 3.2, scale: 1 });
    },
  },
  {
    re: /\b(lamp)\b/i,
    apply: (s) => {
      s.lighting = "lamp";
      if (!s.props.some((p) => p.prop === "lamp")) s.props.push({ prop: "lamp", x: 3.2, scale: 1 });
    },
  },
  {
    re: /\b(rock|stone|boulder)\b/i,
    apply: (s) => {
      if (!s.props.some((p) => p.prop === "rock")) s.props.push({ prop: "rock", x: 3.4, scale: 1 });
    },
  },
  {
    re: /\b(clock)\b/i,
    apply: (s) => {
      if (!s.props.some((p) => p.prop === "clock")) s.props.push({ prop: "clock", x: 3.4, scale: 1 });
    },
  },
  {
    re: /\b(map)\b/i,
    apply: (s) => {
      if (!s.props.some((p) => p.prop === "mapPin")) s.props.push({ prop: "mapPin", x: 3.4, scale: 1 });
    },
  },
];

export interface DialogueInfo {
  /** Speaker name when the line starts with "Name: ...", else null. */
  speaker: string | null;
}

/**
 * Dialogue lines: `Name: "..."` or a line starting with a quote.
 * A bare "Name:" + spoken sentence (quoted, or ending in sentence
 * punctuation) is dialogue; "Fire: The First Night" is not — no
 * quotes, no sentence end, so it stays a title card.
 */
export function parseDialogue(line: string): DialogueInfo | null {
  const t = line.trim();
  const named = /^([A-Z][A-Za-z]{1,19}):\s+/.exec(t);
  if (named) {
    const rest = t.slice(named[0].length);
    if (/^["“]/.test(rest) || /[.!?]["”]?$/.test(rest)) return { speaker: named[1] };
    return null;
  }
  if (/^["“]/.test(t)) return { speaker: null };
  return null;
}

/** One-line plain-English summary of a scene's choices. */
function describeScene(s: ShotScene): string {
  const parts = [
    `${s.background} background`,
    `${s.variant} variant`,
    `${s.pose} pose`,
    `${s.expression} expression`,
  ];
  if (s.lighting !== "none") parts.push(`${s.lighting} lighting`);
  if (s.cutaway) parts.push(`${s.cutaway} cut-away`);
  for (const p of s.props) parts.push(`${p.prop} prop`);
  if (s.animal) parts.push(`${s.animal.species} animal`);
  if (s.camera === "closeup") parts.push("close-up camera");
  return parts.join(", ");
}

/**
 * Build the reason line: what the line mentioned, what gaps were
 * found (no matching vocab), and what scene that produced — so a
 * wrong match is obvious and fixable in one click.
 */
function buildReason(
  matchedWords: string[],
  notes: string[],
  dialogue: DialogueInfo | null,
  s: ShotScene,
): string {
  const clauses: string[] = [];
  if (dialogue) {
    clauses.push(`dialogue${dialogue.speaker ? ` (${dialogue.speaker} speaking)` : ""} — speaker on camera`);
  }
  if (matchedWords.length > 0) {
    clauses.push(`mentions ${matchedWords.map((w) => `"${w}"`).join(", ")}`);
  } else if (!dialogue) {
    clauses.push("no strong keyword match — rotated for variety");
  }
  for (const n of notes) clauses.push(n);
  return `${clauses.join("; ")} → ${describeScene(s)}`;
}

interface SceneSuggestion {
  scene: ShotScene;
  matchedWords: string[];
  notes: string[];
  dialogue: DialogueInfo | null;
}

/**
 * Suggest a scene for one narration line. Deterministic: the same
 * line + index + cast always suggests the same scene. Semantic
 * rules win (location, action, emotion, time, objects, dialogue);
 * otherwise the background rotates so consecutive shots never
 * look identical.
 */
function suggestSceneParts(line: string, index: number, castIds: string[]): SceneSuggestion {
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
    reason: "",
  };
  const dialogue = parseDialogue(line);
  if (isTitleCard(line) && !dialogue) {
    s.textCard = { title: line.replace(/:$/, ""), sub: "" };
    s.background = "modern";
    s.camera = "wide";
    s.characterId = null;
    s.reason = `Title card "${s.textCard.title}" → text-card shot, no character, modern background`;
    return { scene: s, matchedWords: [], notes: [], dialogue: null };
  }
  const matchedWords: string[] = [];
  const notes: string[] = [];
  for (const rule of KEYWORD_RULES) {
    const m = line.match(rule.re);
    if (m) {
      rule.apply(s);
      const w = m[0].toLowerCase();
      if (!matchedWords.includes(w)) matchedWords.push(w);
      if (rule.note) notes.push(rule.note);
    }
  }
  if (dialogue) {
    // Dialogue is spoken by someone on screen: closer camera, and
    // the point pose (the closest thing to a talking pose in the
    // 21-pose vocab — the style guide's talking shot is a still
    // with motion lines by the head, not a moving mouth).
    s.camera = "closeup";
    s.pose = "point";
  }
  s.reason = buildReason(matchedWords, notes, dialogue, s);
  return { scene: s, matchedWords, notes, dialogue };
}

export function suggestScene(line: string, index: number, castIds: string[]): ShotScene {
  return suggestSceneParts(line, index, castIds).scene;
}

/** Split a line into one or two shots (long lines => two shots). */
export function lineToShots(line: string, index: number, castIds: string[]): Shot[] {
  const parts = suggestSceneParts(line, index, castIds);
  const base = parts.scene;
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
  // The reason describes the actual scene, so recompute it for the
  // part-2 framing (its camera — and sometimes background — differ).
  secondScene.reason = buildReason(parts.matchedWords, parts.notes, parts.dialogue, secondScene);
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
