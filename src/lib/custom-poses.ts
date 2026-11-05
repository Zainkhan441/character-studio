/**
 * Custom poses (M1, 2026-11-05).
 *
 * A custom pose is a named set of limb angles on top of a base pose,
 * saved from the visual pose editor and reusable forever. Stored as
 * typed JSON in localStorage; validated on load, corrupt entries
 * dropped, never a crash.
 *
 * Applying a custom pose in the creator sets the base pose plus the
 * four per-limb overrides (the Character schema already carries those
 * fields — backArm / frontArm / backLeg / frontLeg).
 */
import { POSE_NAMES, type PoseName } from "./character";

export interface CustomPose {
  id: string;
  name: string;
  /** Base pose the angles were edited from. */
  basePose: PoseName;
  backArm: [number, number];
  frontArm: [number, number];
  backLeg: [number, number];
  frontLeg: [number, number];
  createdAt: number;
}

export const CUSTOM_POSES_STORAGE_KEY = "character-studio:custom-poses:v1";

function isTuple(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

function isCustomPose(v: unknown): v is CustomPose {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    typeof o.name === "string" &&
    o.name.length > 0 &&
    typeof o.basePose === "string" &&
    (POSE_NAMES as readonly string[]).includes(o.basePose) &&
    isTuple(o.backArm) &&
    isTuple(o.frontArm) &&
    isTuple(o.backLeg) &&
    isTuple(o.frontLeg) &&
    typeof o.createdAt === "number"
  );
}

export function loadCustomPoses(): { poses: CustomPose[]; dropped: number } {
  if (typeof window === "undefined" || !window.localStorage) {
    return { poses: [], dropped: 0 };
  }
  try {
    const raw = window.localStorage.getItem(CUSTOM_POSES_STORAGE_KEY);
    if (raw === null) return { poses: [], dropped: 0 };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { poses: [], dropped: 1 };
    const poses: CustomPose[] = [];
    let dropped = 0;
    for (const entry of parsed) {
      if (isCustomPose(entry)) poses.push(entry);
      else dropped += 1;
    }
    return { poses, dropped };
  } catch {
    return { poses: [], dropped: 1 };
  }
}

export function saveCustomPoses(poses: CustomPose[]): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    window.localStorage.setItem(CUSTOM_POSES_STORAGE_KEY, JSON.stringify(poses));
    return true;
  } catch {
    return false;
  }
}

export function upsertCustomPose(poses: CustomPose[], p: CustomPose): CustomPose[] {
  return [...poses.filter((x) => x.id !== p.id), p];
}

export function removeCustomPose(poses: CustomPose[], id: string): CustomPose[] {
  return poses.filter((x) => x.id !== id);
}
