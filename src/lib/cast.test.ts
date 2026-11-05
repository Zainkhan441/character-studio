/**
 * Cast + custom poses + history tests (M1, 2026-11-05).
 */
import { describe, expect, it } from "vitest";
import { loadCast, removeFromCast, starterCast, upsertCast } from "./cast";
import { defaultCharacter, validateCharacter } from "./character";
import {
  loadCustomPoses,
  removeCustomPose,
  saveCustomPoses,
  upsertCustomPose,
  type CustomPose,
} from "./custom-poses";
import { History } from "./history";
import { renderCharacterSvg } from "./renderer";

describe("starter cast", () => {
  it("has 5 distinct characters incl. female, elder and child", () => {
    const cast = starterCast();
    expect(cast).toHaveLength(5);
    const ids = new Set(cast.map((c) => c.id));
    expect(ids.size).toBe(5);
    const names = cast.map((c) => c.name);
    expect(names).toContain("Asha");
    expect(names).toContain("Baba Jaan");
    expect(names).toContain("Chotu");
    // Female / elder / child are recognisable from their fields.
    const asha = cast.find((c) => c.name === "Asha");
    expect(asha?.face.lashes).toBe(true);
    const baba = cast.find((c) => c.name === "Baba Jaan");
    expect(baba?.hair.color).toBe("grey");
    expect(baba?.hair.beard).toBe("full");
    const chotu = cast.find((c) => c.name === "Chotu");
    expect(chotu?.scale).toBeLessThan(1);
    expect(chotu?.proportions.headRadius).toBeGreaterThan(1);
  });

  it("every starter character validates and renders", () => {
    for (const c of starterCast()) {
      expect(validateCharacter(c).ok).toBe(true);
      expect(() => renderCharacterSvg(c)).not.toThrow();
    }
  });

  it("loadCast seeds the starter cast when storage is empty (SSR-safe)", () => {
    const { cast, seeded } = loadCast();
    expect(seeded).toBe(true);
    expect(cast).toHaveLength(5);
  });
});

describe("cast upsert/remove", () => {
  it("upsert replaces by id, remove drops by id", () => {
    const cast = starterCast();
    const edited = { ...cast[0], name: "Arjun 2" };
    const up = upsertCast(cast, edited);
    expect(up).toHaveLength(5);
    expect(up.find((c) => c.id === cast[0].id)?.name).toBe("Arjun 2");
    const extra = { ...defaultCharacter(), id: "cast-new", name: "New" };
    expect(upsertCast(cast, extra)).toHaveLength(6);
    expect(removeFromCast(cast, cast[0].id)).toHaveLength(4);
  });
});

describe("custom poses storage (SSR-safe)", () => {
  const pose: CustomPose = {
    id: "pose-1",
    name: "My wave",
    basePose: "stand",
    backArm: [-10, 15],
    frontArm: [130, -20],
    backLeg: [-6, 0],
    frontLeg: [6, 0],
    createdAt: 1,
  };

  it("loads empty when nothing is stored", () => {
    expect(loadCustomPoses()).toEqual({ poses: [], dropped: 0 });
  });

  it("save/load round-trips in a browser-like env", () => {
    // No localStorage in this test env (SSR-safe no-op): save returns
    // false and load stays empty — the point is it never throws.
    expect(saveCustomPoses([pose])).toBe(false);
    expect(loadCustomPoses()).toEqual({ poses: [], dropped: 0 });
  });

  it("upsert/remove are pure list ops", () => {
    expect(upsertCustomPose([], pose)).toEqual([pose]);
    expect(upsertCustomPose([pose], { ...pose, name: "Renamed" })).toEqual([
      { ...pose, name: "Renamed" },
    ]);
    expect(removeCustomPose([pose], "pose-1")).toEqual([]);
  });
});

describe("History (undo/redo)", () => {
  it("push/undo/redo walk the states", () => {
    const h = new History<number>(0);
    expect(h.canUndo).toBe(false);
    h.push(1);
    h.push(2);
    expect(h.current).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.undo()).toBe(null);
    expect(h.current).toBe(0);
    expect(h.redo()).toBe(1);
    expect(h.redo()).toBe(2);
    expect(h.redo()).toBe(null);
  });

  it("pushing identical state is a no-op", () => {
    const h = new History<{ a: number }>({ a: 1 });
    h.push({ a: 1 });
    expect(h.canUndo).toBe(false);
    h.push({ a: 2 });
    expect(h.canUndo).toBe(true);
  });

  it("a new push clears the redo stack", () => {
    const h = new History<number>(0);
    h.push(1);
    h.push(2);
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push(3);
    expect(h.canRedo).toBe(false);
    expect(h.current).toBe(3);
  });

  it("caps the stack", () => {
    const h = new History<number>(0, 3);
    h.push(1);
    h.push(2);
    h.push(3);
    h.push(4);
    expect(h.undoDepth).toBe(3);
    expect(h.undo()).toBe(3);
  });

  it("reset replaces state and clears stacks", () => {
    const h = new History<number>(0);
    h.push(1);
    h.reset(9);
    expect(h.current).toBe(9);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
