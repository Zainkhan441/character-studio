import { describe, expect, it } from "vitest";
import {
  CREATOR_EXPRESSIONS,
  CREATOR_POSES,
  FACE_NAMES,
  POSE_NAMES,
  defaultCharacter,
  validateCharacter,
} from "./character";
import { characterSvg, faceSvg, limb, propSvg, renderCharacterSvg } from "./renderer";
import { mulberry32 } from "./rng";

describe("limb() forward kinematics (ported from ink.py)", () => {
  it("straight down: angle 0 puts knee and foot below the origin", () => {
    const { knee, end } = limb(0, 0, 1.1, 1.05, 0, 0);
    expect(knee[0]).toBeCloseTo(0, 10);
    expect(knee[1]).toBeCloseTo(1.1, 10);
    expect(end[0]).toBeCloseTo(0, 10);
    expect(end[1]).toBeCloseTo(2.15, 10);
  });

  it("90 degrees forward: limb points along +x", () => {
    const { knee, end } = limb(0, 0, 1.1, 1.05, 90, 0);
    expect(knee[0]).toBeCloseTo(1.1, 10);
    expect(knee[1]).toBeCloseTo(0, 10);
    expect(end[0]).toBeCloseTo(2.15, 10);
    expect(end[1]).toBeCloseTo(0, 10);
  });

  it("bend rotates only the lower segment", () => {
    // upper 0 (straight down), lower bent 90 forward: foot ends at (+1.05, 1.1)
    const { knee, end } = limb(0, 0, 1.1, 1.05, 0, 90);
    expect(knee).toEqual([0, 1.1]);
    expect(end[0]).toBeCloseTo(1.05, 10);
    expect(end[1]).toBeCloseTo(1.1, 10);
  });

  it("matches the Python reference values for the stand pose arms", () => {
    // stand back arm (-10, 8) from shoulder (0,0): knee = 1.1*sin(-10°), 1.1*cos(-10°)
    const { knee } = limb(0, 0, 1.1, 1.05, -10, 8);
    expect(knee[0]).toBeCloseTo(1.1 * Math.sin((-10 * Math.PI) / 180), 10);
    expect(knee[1]).toBeCloseTo(1.1 * Math.cos((-10 * Math.PI) / 180), 10);
  });
});

describe("renderer determinism", () => {
  it("same character renders byte-identical SVG twice", () => {
    const c = defaultCharacter();
    const a = renderCharacterSvg(c);
    const b = renderCharacterSvg(c);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(1000);
  });

  it("same seed, different JS runs of the character function agree", () => {
    const c = { ...defaultCharacter(), pose: "walk" as const };
    const a = characterSvg(c, mulberry32(7));
    const b = characterSvg(c, mulberry32(7));
    expect(a).toBe(b);
  });

  it("different seeds change the SVG (seeded RNG is actually used)", () => {
    const base = defaultCharacter();
    const a = renderCharacterSvg({ ...base, style: { ...base.style, seed: 7 } });
    const b = renderCharacterSvg({ ...base, style: { ...base.style, seed: 8 } });
    expect(a).not.toBe(b);
  });

  it("changing the pose changes the SVG", () => {
    const base = defaultCharacter();
    const a = renderCharacterSvg(base);
    const b = renderCharacterSvg({ ...base, pose: "cheer" });
    expect(a).not.toBe(b);
  });

  it("output contains the hand filter and grain overlay", () => {
    const svg = renderCharacterSvg(defaultCharacter());
    expect(svg).toContain('id="hand"');
    // Python pixel-space values converted to character-unit space
    // (720 px / 9 viewBox units = 80 px/unit): hand turbulence
    // 0.025/px -> 2.0/unit, grain 0.9/px -> 72.0/unit.
    expect(svg).toContain('feTurbulence type="fractalNoise" baseFrequency="2.000"');
    expect(svg).toContain('feTurbulence type="fractalNoise" baseFrequency="72.0"');
    expect(svg).toContain('feDisplacementMap');
    expect(svg).toContain('id="grain"');
    expect(svg).toContain('filter="url(#hand)"');
  });

  it("default wobble 1 gives the engine displacement scale (1.8px / 80px-per-unit = 0.0225)", () => {
    const svg = renderCharacterSvg(defaultCharacter());
    expect(svg).toContain('scale="0.0225"');
  });

  it("wobble 0 produces a displacement scale of 0.0", () => {
    const base = defaultCharacter();
    const svg = renderCharacterSvg({ ...base, style: { ...base.style, wobble: 0 } });
    expect(svg).toContain('scale="0.0000"');
  });
});

describe("all poses render", () => {
  it.each(POSE_NAMES)("pose %s renders without throwing", (pose) => {
    const c = { ...defaultCharacter(), pose };
    const svg = renderCharacterSvg(c);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
  });
});

describe("all expressions render", () => {
  it.each(FACE_NAMES)("face %s renders without throwing", (face) => {
    const base = defaultCharacter();
    const c = { ...base, face: { ...base.face, expression: face } };
    const svg = renderCharacterSvg(c);
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it.each(CREATOR_EXPRESSIONS)("creator expression %s renders", (face) => {
    const svg = faceSvg(0, -2.8, {
      face,
      look: "forward",
      blink: false,
      mouth: 0,
      lashes: false,
      stubble: false,
      blush: false,
      cold: false,
      eyeSize: 1,
      eyeSpacing: 1,
    }, "#211c19");
    expect(svg.length).toBeGreaterThan(50);
  });
});

describe("creator poses render", () => {
  it.each(CREATOR_POSES)("creator pose %s renders", (pose) => {
    const svg = renderCharacterSvg({ ...defaultCharacter(), pose });
    expect(svg).toContain("<svg");
  });
});

describe("props render", () => {
  it.each(["spear", "torch", "book", "phone", "shovel", "sword"] as const)(
    "prop %s renders",
    (prop) => {
      const svg = propSvg(prop, 0, "#211c19", 0.075);
      expect(svg).toContain("<g");
      expect(svg).toContain("</g>");
    },
  );

  it("character holding a spear renders the prop", () => {
    const base = defaultCharacter();
    const c = {
      ...base,
      pose: "hold" as const,
      outfit: { ...base.outfit, hold: "spear" as const },
    };
    const svg = renderCharacterSvg(c);
    expect(svg).toContain("#8a5d34");
  });
});

describe("character validation", () => {
  it("accepts a valid default character", () => {
    const result = validateCharacter(defaultCharacter());
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown pose with a readable error", () => {
    const result = validateCharacter({ pose: "backflip" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("pose");
    }
  });

  it("rejects a bad colour with a readable error", () => {
    const result = validateCharacter({ style: { ink: "red" } });
    expect(result.ok).toBe(false);
  });

  it("fills defaults for a partial character", () => {
    const result = validateCharacter({ name: "Asha", pose: "think" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.character.name).toBe("Asha");
      expect(result.character.pose).toBe("think");
      expect(result.character.hair.style).toBe("ragged");
    }
  });
});
