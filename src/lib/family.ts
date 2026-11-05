/**
 * Family generator (M1, 2026-11-05).
 *
 * One character -> whole family: female / child / elder variants that
 * keep the SAME style (same ink, line weight, wobble, skin, seed — the
 * style lock) and the same outfit family, with only proportions, face
 * and hair adjusted. Deterministic: same base + same kind => same
 * variant (except the generated id).
 *
 * The transforms are deliberately conservative: a family member must
 * still read as the same character in the same video, just a different
 * age / gender. Nothing here invents new art — it reuses the existing
 * parametric fields.
 */
import {
  defaultCharacter,
  type Character,
  type HairStyle,
} from "./character";

export type FamilyKind = "female" | "child" | "elder";

const KIND_LABEL: Record<FamilyKind, string> = {
  female: "Female",
  child: "Child",
  elder: "Elder",
};

function newId(): string {
  // crypto.randomUUID exists in browsers and in Node 19+.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `char-${crypto.randomUUID()}`;
  }
  return `char-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/**
 * Female variant: slimmer proportions, larger eyes, lashes, long hair,
 * no beard/stubble. A caveman becomes a cavedress (same fur style).
 */
export function makeFemale(base: Character): Character {
  const hairStyle: HairStyle =
    base.hair.style === "long" || base.hair.style === "bun" || base.hair.style === "wavy"
      ? base.hair.style
      : "long";
  return {
    ...base,
    id: newId(),
    name: `${base.name} (${KIND_LABEL.female})`,
    scale: 0.97,
    proportions: {
      ...base.proportions,
      headRadius: 0.95,
      torso: 1.23,
      upperArm: 0.75,
      lowerArm: 0.7,
      upperLeg: 0.9,
      lowerLeg: 0.85,
    },
    face: {
      ...base.face,
      lashes: true,
      blush: true,
      stubble: false,
      eyeSize: Math.min(2, base.face.eyeSize * 1.15),
      eyeSpacing: Math.min(2, base.face.eyeSpacing * 1.05),
    },
    hair: { ...base.hair, style: hairStyle, beard: "none" },
    outfit: {
      ...base.outfit,
      outfit: base.outfit.outfit === "caveman" ? "cavedress" : base.outfit.outfit,
    },
  };
}

/**
 * Child variant: big head, short limbs, big eyes, smaller overall.
 * Same outfit and hair colour — a child in the family look.
 */
export function makeChild(base: Character): Character {
  const hairStyle: HairStyle = base.hair.style === "beard" ? "short" : base.hair.style;
  return {
    ...base,
    id: newId(),
    name: `${base.name} (${KIND_LABEL.child})`,
    scale: 0.75,
    proportions: {
      ...base.proportions,
      headRadius: 1.25,
      torso: 0.95,
      upperArm: 0.6,
      lowerArm: 0.55,
      upperLeg: 0.65,
      lowerLeg: 0.6,
    },
    face: {
      ...base.face,
      eyeSize: Math.min(2, base.face.eyeSize * 1.3),
      eyeSpacing: Math.min(2, base.face.eyeSpacing * 1.1),
      lashes: false,
      stubble: false,
      blush: false,
      mouth: 0,
    },
    hair: { ...base.hair, style: hairStyle, beard: "none" },
  };
}

/**
 * Elder variant: grey hair, slightly shorter torso, a gentle stoop
 * (lean +8), smaller eyes. Same outfit — the same character, older.
 */
export function makeElder(base: Character): Character {
  return {
    ...base,
    id: newId(),
    name: `${base.name} (${KIND_LABEL.elder})`,
    scale: 0.97,
    lean: Math.max(-30, Math.min(30, base.lean + 8)),
    proportions: {
      ...base.proportions,
      headRadius: 1.0,
      torso: 1.25,
      upperArm: 0.78,
      lowerArm: 0.72,
      upperLeg: 0.9,
      lowerLeg: 0.85,
    },
    face: {
      ...base.face,
      eyeSize: Math.max(0.5, base.face.eyeSize * 0.9),
      stubble: false,
      mouth: 0,
    },
    hair: { ...base.hair, color: "grey" },
  };
}

export function makeFamilyVariant(base: Character, kind: FamilyKind): Character {
  switch (kind) {
    case "female":
      return makeFemale(base);
    case "child":
      return makeChild(base);
    case "elder":
      return makeElder(base);
  }
}

/**
 * The default character's family — used by the cast library so the
 * starter cast is built from the same transforms users get.
 */
export function defaultFamily(): Record<FamilyKind, Character> {
  const base = defaultCharacter();
  return {
    female: makeFemale(base),
    child: makeChild(base),
    elder: makeElder(base),
  };
}
