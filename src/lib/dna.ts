/**
 * Character DNA fingerprint — audit item 5 (Character DNA proof).
 *
 * The product's core promise is that one character stays the SAME
 * character in every pose and every expression. The renderer is
 * already deterministic (same input -> byte-identical SVG), but
 * determinism alone does not prove identity: a pose could silently
 * stretch an arm or shrink the head and still render deterministically.
 * This fingerprint is the regression that catches that.
 *
 * A fingerprint is pure geometry + the rendered line-weight set:
 *  - head radius, torso length and the four limb lengths are measured
 *    from the skeleton (`computeSkeleton`), NOT read back from the
 *    character's proportions — so a pose-table or kinematics bug that
 *    changed a real limb length would move the fingerprint.
 *  - the silhouette is a bounding box over the skeleton joints,
 *    expanded by the head radius (head joint) and by the limb
 *    half-width (every other joint). Pure geometry, no DOM — getBBox
 *    does not exist in node. It is a geometry proxy, not a pixel
 *    bounding box: hair, hats, garments and props extend beyond it,
 *    and that is intentional — the DNA is the body, not the wardrobe.
 *  - strokeWidths is the sorted unique set of `stroke-width` values
 *    in the rendered SVG. It pins the character's line weights.
 *
 * What must NEVER change across poses/expressions for the same
 * character: headRadius, torsoLength, all four limb lengths, and
 * the silhouette within a pose (an expression must never move the
 * silhouette). See dna.test.ts for the exact assertions — and for
 * the two documented, intentional stroke-width variants
 * (surprised brows; recline/lie behind-head arms), which are NOT
 * DNA drift.
 */
import type { Character } from "./character";
import { computeSkeleton, renderCharacterSvg } from "./renderer";

export interface CharacterFingerprint {
  headRadius: number;
  torsoLength: number;
  upperArmLength: number;
  lowerArmLength: number;
  upperLegLength: number;
  lowerLegLength: number;
  /** Sorted unique stroke-width values found in the rendered SVG. */
  strokeWidths: string[];
  silhouette: { width: number; height: number };
}

type Pt = readonly [number, number];

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Sorted unique `stroke-width="..."` values from an SVG string.
 * Sorted numerically (parseFloat), with a lexicographic tie-break so
 * distinct spellings of the same value ("0.09" vs "0.090") order
 * deterministically. The raw strings are kept, not normalised:
 * a formatting change in the renderer is a visible change and the
 * fingerprint should record it, not hide it.
 */
export function extractStrokeWidths(svg: string): string[] {
  const found = new Set<string>();
  for (const m of svg.matchAll(/stroke-width="([^"]+)"/g)) {
    found.add(m[1]);
  }
  return [...found].sort((a, b) => {
    const d = parseFloat(a) - parseFloat(b);
    return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * Pure fingerprint of one character in its current pose/expression.
 * Deterministic: same character -> identical fingerprint (the
 * renderer is seeded, and every value here derives from it).
 */
export function characterFingerprint(character: Character): CharacterFingerprint {
  const sk = computeSkeleton(character);
  const svg = renderCharacterSvg(character);

  const headRadius = character.proportions.headRadius;
  // Limb half-width as actually drawn: tube() strokes the limb at
  // limbWidth with an outline of outlineWidth on each side.
  const limbHalf = character.style.limbWidth / 2 + character.style.outlineWidth;
  const headHalf = headRadius + character.style.outlineWidth;

  // Skeleton joints, each with the radius its drawn shape extends.
  const expanded: Array<{ p: Pt; r: number }> = [
    { p: sk.head, r: headHalf },
    { p: sk.neck, r: limbHalf },
    { p: sk.hip, r: limbHalf },
    { p: sk.shoulder, r: limbHalf },
    { p: sk.backArm.knee, r: limbHalf },
    { p: sk.backArm.end, r: limbHalf },
    { p: sk.frontArm.knee, r: limbHalf },
    { p: sk.frontArm.end, r: limbHalf },
    { p: sk.backLeg.knee, r: limbHalf },
    { p: sk.backLeg.end, r: limbHalf },
    { p: sk.frontLeg.knee, r: limbHalf },
    { p: sk.frontLeg.end, r: limbHalf },
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { p, r } of expanded) {
    minX = Math.min(minX, p[0] - r);
    maxX = Math.max(maxX, p[0] + r);
    minY = Math.min(minY, p[1] - r);
    maxY = Math.max(maxY, p[1] + r);
  }

  return {
    headRadius,
    torsoLength: dist(sk.hip, sk.neck),
    upperArmLength: dist(sk.shoulder, sk.frontArm.knee),
    lowerArmLength: dist(sk.frontArm.knee, sk.frontArm.end),
    upperLegLength: dist(sk.hip, sk.frontLeg.knee),
    lowerLegLength: dist(sk.frontLeg.knee, sk.frontLeg.end),
    strokeWidths: extractStrokeWidths(svg),
    silhouette: { width: maxX - minX, height: maxY - minY },
  };
}
