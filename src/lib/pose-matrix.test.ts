/**
 * Pose-matrix tests (M1, 2026-11-05).
 *
 * The cheer pose shipped with both elbows THROUGH the head circle
 * (front arm spearing across the face) because nobody had ever checked
 * the pose table numerically. These tests check every pose's skeleton
 * geometry so a bad pose angle can never regress silently:
 *  - the front arm (drawn IN FRONT of the face) never passes near the head
 *  - cheer specifically: both elbows clear of the head, hands up high
 *  - the skeleton is deterministic and round-trips through characterJoints
 *  - limbAnglesForPoint (pose-editor IK) puts the limb end on target
 *  - the hanging-arm rule: a sleeveless hanging front arm renders
 *    BEHIND the garment; a sleeved one stays in front.
 */
import { describe, expect, it } from "vitest";
import {
  POSE_NAMES,
  POSES,
  defaultCharacter,
  type Character,
} from "./character";
import {
  characterJoints,
  computeSkeleton,
  jointsToCharacterSpace,
  limb,
  limbAnglesForPoint,
  renderCharacterSvg,
} from "./renderer";

type Pt = readonly [number, number];

/** Distance from a point to a line segment. */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

function withPose(pose: (typeof POSE_NAMES)[number]): Character {
  return { ...defaultCharacter(), pose };
}

describe("pose matrix — no arm crosses the face", () => {
  it.each(POSE_NAMES)(
    "pose %s: front arm stays clear of the head (when drawn in front of it)",
    (pose) => {
      const c = withPose(pose);
      const sk = computeSkeleton(c);
      // Arms drawn behind the head (recline/lie) are hidden by the head
      // circle, so only the front-drawn arms can visibly cross the face.
      if (sk.behind) return;
      const [hx, hy] = sk.head;
      const headR = c.proportions.headRadius;
      const segs: Array<[Pt, Pt]> = [
        [sk.shoulder, sk.frontArm.knee],
        [sk.frontArm.knee, sk.frontArm.end],
      ];
      for (const [a, b] of segs) {
        const d = distToSegment([hx, hy], a, b);
        expect(d).toBeGreaterThan(headR * 0.5);
      }
    },
  );

  it("cheer: both elbows clear of the head and both hands raised", () => {
    const sk = computeSkeleton(withPose("cheer"));
    const [hx, hy] = sk.head;
    const headR = 1;
    for (const arm of [sk.frontArm, sk.backArm]) {
      expect(Math.hypot(arm.knee[0] - hx, arm.knee[1] - hy)).toBeGreaterThan(headR);
      // Hands end up above shoulder height (y is down-positive).
      expect(arm.end[1]).toBeLessThan(sk.shoulder[1]);
    }
    // And the pose table itself no longer holds the old broken angles.
    expect(POSES.cheer.frontArm).toEqual([115, 30]);
    expect(POSES.cheer.backArm).toEqual([-115, -30]);
  });

  it("all poses keep every joint within a sane frame", () => {
    for (const pose of POSE_NAMES) {
      const sk = computeSkeleton(withPose(pose));
      const pts = [
        sk.head,
        sk.backArm.end,
        sk.frontArm.end,
        sk.backLeg.end,
        sk.frontLeg.end,
      ];
      for (const [x, y] of pts) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
        expect(Math.abs(x)).toBeLessThan(12);
        expect(Math.abs(y)).toBeLessThan(12);
      }
    }
  });
});

describe("skeleton determinism and joints round-trip", () => {
  it("computeSkeleton is deterministic", () => {
    const c = withPose("point");
    const a = computeSkeleton(c);
    const b = computeSkeleton(c);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("characterJoints round-trips through jointsToCharacterSpace", () => {
    for (const pose of POSE_NAMES) {
      const c = withPose(pose);
      const sk = computeSkeleton(c);
      const j = characterJoints(c);
      const back = jointsToCharacterSpace(c, j.frontHand);
      expect(back[0]).toBeCloseTo(sk.frontArm.end[0], 6);
      expect(back[1]).toBeCloseTo(sk.frontArm.end[1], 6);
      const backFoot = jointsToCharacterSpace(c, j.backFoot);
      expect(backFoot[0]).toBeCloseTo(sk.backLeg.end[0], 6);
      expect(backFoot[1]).toBeCloseTo(sk.backLeg.end[1], 6);
    }
  });

  it("characterJoints ground is 0 (ground maps to the viewBox baseline)", () => {
    const j = characterJoints(withPose("stand"));
    expect(j.ground).toBe(0);
  });
});

describe("limbAnglesForPoint (pose-editor IK)", () => {
  it("puts a reachable limb end on target", () => {
    const start: Pt = [0, -1.55];
    const target: Pt = [1.2, -1.0];
    const [a1, a2] = limbAnglesForPoint(start, 1.1, 1.05, target);
    const { end } = limb(start[0], start[1], 1.1, 1.05, a1, a2);
    expect(end[0]).toBeCloseTo(target[0], 6);
    expect(end[1]).toBeCloseTo(target[1], 6);
  });

  it("beyond reach the limb extends straight at the target", () => {
    const start: Pt = [0, -1.55];
    const target: Pt = [5, -1.55];
    const [a1, a2] = limbAnglesForPoint(start, 1.1, 1.05, target);
    // Full extension in the target direction (2.15 units from the joint).
    const { end } = limb(start[0], start[1], 1.1, 1.05, a1, a2);
    expect(end[0]).toBeCloseTo(2.15, 2);
    expect(end[1]).toBeCloseTo(-1.55, 2);
    expect(Math.abs(a1 - 90)).toBeLessThan(3);
    expect(Math.abs(a2)).toBeLessThan(5);
  });

  it("returns finite angles for a target at the joint", () => {
    const [a1, a2] = limbAnglesForPoint([0, -1.55], 1.1, 1.05, [0, -1.55]);
    expect(Number.isFinite(a1)).toBe(true);
    expect(Number.isFinite(a2)).toBe(true);
  });
});

describe("hanging-arm rule (no diagonal scratch across the garment)", () => {
  // The front hand's <g transform="translate(x,y)..."> in the SVG.
  // Computed from the skeleton, not hardcoded, so a proportion rescale
  // does not silently break the test — it checks z-order, not geometry.
  const handMarker = (c: Character): string => {
    const sk = computeSkeleton(c);
    const [x, y] = sk.frontArm.end;
    return `translate(${x.toFixed(3)},${y.toFixed(3)})`;
  };

  it("caveman stand: front arm renders BEHIND the fur garment", () => {
    const base = defaultCharacter();
    const c: Character = {
      ...base,
      outfit: { ...base.outfit, outfit: "caveman" },
    };
    const svg = renderCharacterSvg(c);
    // Front hand group vs the torso group (the fur lives inside it).
    const handAt = svg.indexOf(handMarker(c));
    const torsoAt = svg.indexOf('<g transform="rotate(0.0)">');
    expect(handAt).toBeGreaterThan(-1);
    expect(torsoAt).toBeGreaterThan(-1);
    expect(handAt).toBeLessThan(torsoAt);
  });

  it("shirt stand: front arm (sleeve) stays IN FRONT of the shirt", () => {
    const c = defaultCharacter(); // shirt by default
    const svg = renderCharacterSvg(c);
    const handAt = svg.indexOf(handMarker(c));
    const torsoAt = svg.indexOf('<g transform="rotate(0.0)">');
    expect(handAt).toBeGreaterThan(-1);
    expect(torsoAt).toBeGreaterThan(-1);
    expect(handAt).toBeGreaterThan(torsoAt);
  });

  it("caveman point: raised front arm stays in front of the fur", () => {
    const base = defaultCharacter();
    const c: Character = {
      ...base,
      pose: "point",
      outfit: { ...base.outfit, outfit: "caveman" },
    };
    const svg = renderCharacterSvg(c);
    const handAt = svg.indexOf(handMarker(c));
    const torsoAt = svg.indexOf('<g transform="rotate(0.0)">');
    expect(handAt).toBeGreaterThan(-1);
    expect(handAt).toBeGreaterThan(torsoAt);
  });
});
