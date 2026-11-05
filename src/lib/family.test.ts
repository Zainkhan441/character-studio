/**
 * Family generator tests (M1, 2026-11-05).
 *
 * The style lock is the whole point: a family member must keep the
 * base character's style (ink, line weight, wobble, skin, seed)
 * exactly, and must still render. Only proportions / face / hair /
 * outfit-family may change.
 */
import { describe, expect, it } from "vitest";
import { defaultCharacter, type Character } from "./character";
import {
  makeChild,
  makeElder,
  makeFamilyVariant,
  makeFemale,
} from "./family";
import { renderCharacterSvg } from "./renderer";

describe("family generator", () => {
  const base = defaultCharacter();

  it("female: keeps the style lock, slimmer proportions, lashes, long hair", () => {
    const f = makeFemale(base);
    expect(f.style).toEqual(base.style);
    expect(f.id).not.toBe(base.id);
    expect(f.name).toContain("Female");
    expect(f.proportions.torso).toBeLessThan(base.proportions.torso);
    expect(f.proportions.upperArm).toBeLessThan(base.proportions.upperArm);
    expect(f.face.lashes).toBe(true);
    expect(f.face.eyeSize).toBeGreaterThan(base.face.eyeSize);
    expect(f.hair.style).toBe("long");
    expect(f.hair.beard).toBe("none");
    expect(f.face.stubble).toBe(false);
  });

  it("female: caveman becomes cavedress (same fur style)", () => {
    const cave: Character = {
      ...base,
      outfit: { ...base.outfit, outfit: "caveman" },
    };
    expect(makeFemale(cave).outfit.outfit).toBe("cavedress");
    // Other outfits are unchanged.
    expect(makeFemale(base).outfit.outfit).toBe("shirt");
  });

  it("child: big head, short limbs, big eyes, smaller scale", () => {
    const k = makeChild(base);
    expect(k.style).toEqual(base.style);
    expect(k.id).not.toBe(base.id);
    expect(k.name).toContain("Child");
    expect(k.proportions.headRadius).toBeGreaterThan(base.proportions.headRadius);
    expect(k.proportions.torso).toBeLessThan(base.proportions.torso);
    expect(k.proportions.upperLeg).toBeLessThan(base.proportions.upperLeg);
    expect(k.face.eyeSize).toBeGreaterThan(base.face.eyeSize);
    expect(k.scale).toBeLessThan(base.scale);
    expect(k.hair.beard).toBe("none");
  });

  it("elder: grey hair, stoop, smaller eyes, style lock intact", () => {
    const e = makeElder(base);
    expect(e.style).toEqual(base.style);
    expect(e.id).not.toBe(base.id);
    expect(e.name).toContain("Elder");
    expect(e.hair.color).toBe("grey");
    expect(e.lean).toBeGreaterThan(base.lean);
    expect(e.face.eyeSize).toBeLessThan(base.face.eyeSize);
    expect(e.proportions.torso).toBeLessThan(base.proportions.torso);
  });

  it("makeFamilyVariant dispatches all three kinds", () => {
    expect(makeFamilyVariant(base, "female").name).toContain("Female");
    expect(makeFamilyVariant(base, "child").name).toContain("Child");
    expect(makeFamilyVariant(base, "elder").name).toContain("Elder");
  });

  it("every variant renders without throwing", () => {
    for (const kind of ["female", "child", "elder"] as const) {
      const v = makeFamilyVariant(base, kind);
      expect(() => renderCharacterSvg(v)).not.toThrow();
      expect(renderCharacterSvg(v)).toContain("<svg");
    }
  });

  it("is deterministic apart from the generated id", () => {
    const a = makeFemale(base);
    const b = makeFemale(base);
    expect({ ...a, id: "x" }).toEqual({ ...b, id: "x" });
  });
});
