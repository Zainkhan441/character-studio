/**
 * Character DNA regression — audit item 5 (the single most important
 * audit step: prove one character stays identical across all poses
 * and expressions). If this test fails, the product fails: a
 * character whose head, torso or limbs change size between shots is
 * not a consistent character.
 *
 * Default character, 21 poses x 13 expressions = 273 renders.
 * Geometry is asserted with exact equality (tolerance 1e-9, via
 * toBeCloseTo(..., 9)): limb lengths are computed from the skeleton
 * by Math.hypot, so any real change is far larger than float noise.
 *
 * STROKE WIDTHS — read this before "fixing" the test: the literal
 * full-set identity across all 273 renders is FALSE in the current
 * renderer, and it is false for two intentional reasons, proven by
 * probing every pose/expression before this test was written
 * (2026-11-05):
 *  1. `surprised` draws its brow arches at stroke-width 0.06
 *     (renderer.ts faceSvg), a width no other expression uses — so
 *     every surprised render adds "0.06" to the set.
 *  2. `recline` / `lie` draw both arms behind the head, so the hands
 *     (0.055) and the sleeved-arm tubes (0.087, 0.106) are not drawn
 *     and the behind-head arms are plain limb lines at 0.095
 *     (fmt(limbWidth)) instead.
 * Neither is DNA drift — the head, torso and limbs are identical in
 * those renders (asserted above). Unifying those widths would be a
 * renderer/visual change, out of scope for this audit item, so the
 * stroke assertion below pins the set exactly instead: every render
 * must contain the core widths, and must contain NO width outside
 * the canonical set plus the two known variants. A stray new width
 * (or a dropped core width) still fails the test.
 */
import { describe, expect, it } from "vitest";
import { FACE_NAMES, POSE_NAMES, defaultCharacter, type Character } from "./character";
import { characterFingerprint, type CharacterFingerprint } from "./dna";

/** toBeCloseTo digits: 9 decimals ~= 1e-9 tolerance. */
const DNA_DIGITS = 9;

function withPoseAndFace(pose: (typeof POSE_NAMES)[number], face: (typeof FACE_NAMES)[number]): Character {
  const base = defaultCharacter();
  return { ...base, pose, face: { ...base.face, expression: face } };
}

function expectSameDna(actual: CharacterFingerprint, canonical: CharacterFingerprint): void {
  expect(actual.headRadius).toBeCloseTo(canonical.headRadius, DNA_DIGITS);
  expect(actual.torsoLength).toBeCloseTo(canonical.torsoLength, DNA_DIGITS);
  expect(actual.upperArmLength).toBeCloseTo(canonical.upperArmLength, DNA_DIGITS);
  expect(actual.lowerArmLength).toBeCloseTo(canonical.lowerArmLength, DNA_DIGITS);
  expect(actual.upperLegLength).toBeCloseTo(canonical.upperLegLength, DNA_DIGITS);
  expect(actual.lowerLegLength).toBeCloseTo(canonical.lowerLegLength, DNA_DIGITS);
}

describe("character DNA — one character, every pose and expression", () => {
  it("canonical fingerprint (stand + neutral) matches the default proportions", () => {
    const fp = characterFingerprint(defaultCharacter());
    // Proportions of the default character (character.ts): these are
    // the DNA values every other render must match exactly.
    expect(fp.headRadius).toBe(1);
    expect(fp.torsoLength).toBeCloseTo(1.3, DNA_DIGITS);
    expect(fp.upperArmLength).toBeCloseTo(0.8, DNA_DIGITS);
    expect(fp.lowerArmLength).toBeCloseTo(0.75, DNA_DIGITS);
    expect(fp.upperLegLength).toBeCloseTo(0.95, DNA_DIGITS);
    expect(fp.lowerLegLength).toBeCloseTo(0.9, DNA_DIGITS);
    expect(fp.strokeWidths.length).toBeGreaterThan(0);
    expect(fp.silhouette.width).toBeGreaterThan(0);
    expect(fp.silhouette.height).toBeGreaterThan(0);
  });

  it("all 21 poses x 13 expressions (273 renders) keep identical DNA geometry", () => {
    const canonical = characterFingerprint(defaultCharacter());
    const t0 = performance.now();
    let count = 0;
    for (const pose of POSE_NAMES) {
      for (const face of FACE_NAMES) {
        const fp = characterFingerprint(withPoseAndFace(pose, face));
        expectSameDna(fp, canonical);
        count++;
      }
    }
    expect(count).toBe(21 * 13);
    const ms = performance.now() - t0;
    console.log(`DNA matrix: 273 renders in ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(5000);
  });

  it("silhouette is identical across all 13 expressions within the same pose", () => {
    for (const pose of POSE_NAMES) {
      const first = characterFingerprint(withPoseAndFace(pose, "neutral")).silhouette;
      for (const face of FACE_NAMES) {
        const s = characterFingerprint(withPoseAndFace(pose, face)).silhouette;
        // An expression must never move the silhouette — exact equality.
        expect(s.width).toBe(first.width);
        expect(s.height).toBe(first.height);
      }
    }
  });

  it("silhouette does change between poses (the test is not vacuous)", () => {
    // No direction assumed: `lie` is not rotated in skeleton space
    // (the -90° rotation happens in characterJoints), so just prove
    // the silhouette is not one constant value across poses.
    const seen = new Set<string>();
    for (const pose of POSE_NAMES) {
      const s = characterFingerprint(withPoseAndFace(pose, "neutral")).silhouette;
      seen.add(`${s.width.toFixed(6)}x${s.height.toFixed(6)}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("determinism: same pose+expression rendered twice gives the identical fingerprint", () => {
    for (const [pose, face] of [
      ["stand", "neutral"],
      ["cheer", "surprised"],
      ["lie", "sleepy"],
      ["run", "angry"],
    ] as const) {
      const a = characterFingerprint(withPoseAndFace(pose, face));
      const b = characterFingerprint(withPoseAndFace(pose, face));
      expect(b).toEqual(a);
    }
  });

  it("stroke widths: core widths always present, no unexpected widths anywhere", () => {
    const canonical = characterFingerprint(defaultCharacter());
    // Widths that legitimately disappear in recline/lie (behind-head
    // arms: no hands, no sleeved tubes) — see header comment.
    const poseDependent = new Set(["0.055", "0.087", "0.106"]);
    // Widths that legitimately appear only in some renders:
    // "0.06" = surprised brows; "0.095" = behind-head arm lines.
    const allowedExtra = new Set(["0.06", "0.095"]);
    const required = canonical.strokeWidths.filter((w) => !poseDependent.has(w));
    const allowed = new Set([...canonical.strokeWidths, ...allowedExtra]);

    let count = 0;
    for (const pose of POSE_NAMES) {
      for (const face of FACE_NAMES) {
        const fp = characterFingerprint(withPoseAndFace(pose, face));
        for (const w of required) {
          expect(fp.strokeWidths).toContain(w);
        }
        for (const w of fp.strokeWidths) {
          expect(allowed.has(w)).toBe(true);
        }
        count++;
      }
    }
    expect(count).toBe(21 * 13);
  });
});
