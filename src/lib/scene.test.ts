import { describe, expect, it } from "vitest";
import { defaultCharacter } from "./character";
import { starterCast } from "./cast";
import {
  BACKGROUND_IDS,
  CUTAWAYS,
  PROP_IDS,
  cameraViewBox,
  defaultScene,
  renderScene,
  validateScene,
  type Scene,
} from "./scene";

function castMap(): Map<string, ReturnType<typeof defaultCharacter>> {
  return new Map(starterCast().map((c) => [c.id, c]));
}

describe("renderScene determinism", () => {
  it("same scene + same cast => byte-identical SVG", () => {
    const scene: Scene = {
      ...defaultScene(),
      background: "hut",
      variant: "night",
      lighting: "fire",
      placements: [{ id: "p1", characterId: "cast-arjun", x: -2, scale: 1, flip: false, pose: "point", expression: "happy" }],
      props: [{ id: "pr1", prop: "fire", x: 3, y: 0, scale: 1, text: "" }],
      animals: [{ id: "a1", species: "cow", x: 5, scale: 0.8, flip: false }],
    };
    const a = renderScene(scene, castMap());
    const b = renderScene(scene, castMap());
    expect(a.svg).toBe(b.svg);
    expect(a.warnings).toEqual([]);
  });

  it("different seed => different SVG (stars / rocks move)", () => {
    const s1 = { ...defaultScene(), background: "savanna" as const, seed: 7 };
    const s2 = { ...defaultScene(), background: "savanna" as const, seed: 8 };
    expect(renderScene(s1, castMap()).svg).not.toBe(renderScene(s2, castMap()).svg);
  });

  it("renders fast enough for thumbnails (<100ms with 4 characters)", () => {
    const scene: Scene = {
      ...defaultScene(),
      placements: [
        { id: "p1", characterId: "cast-arjun", x: -4, scale: 1, flip: false, pose: "stand", expression: "neutral" },
        { id: "p2", characterId: "cast-asha", x: -1.5, scale: 1, flip: false, pose: "wave", expression: "happy" },
        { id: "p3", characterId: "cast-baba", x: 1.5, scale: 1, flip: false, pose: "think", expression: "neutral" },
        { id: "p4", characterId: "cast-chotu", x: 4, scale: 0.8, flip: false, pose: "cheer", expression: "happy" },
      ],
    };
    const { ms } = renderScene(scene, castMap());
    expect(ms).toBeLessThan(100);
  });
});

describe("backgrounds and cut-aways", () => {
  it.each(BACKGROUND_IDS)("background %s renders a non-empty scene", (bg) => {
    const { svg, warnings } = renderScene({ ...defaultScene(), background: bg }, castMap());
    expect(warnings).toEqual([]);
    expect(svg).toContain("<svg");
    expect(svg.length).toBeGreaterThan(2000);
    expect(svg).toContain('filter="url(#hand)"');
  });

  it.each(BACKGROUND_IDS)("background %s renders in all 3 variants", (bg) => {
    for (const variant of ["day", "dusk", "night"] as const) {
      const { svg } = renderScene({ ...defaultScene(), background: bg, variant }, castMap());
      expect(svg.length).toBeGreaterThan(1500);
    }
  });

  it.each(CUTAWAYS)("cut-away %s renders", (cutaway) => {
    const { svg, warnings } = renderScene({ ...defaultScene(), cutaway }, castMap());
    expect(warnings).toEqual([]);
    expect(svg).toContain("<svg");
    expect(svg.length).toBeGreaterThan(2000);
  });

  it("cut-away scenes still place characters inside", () => {
    const scene: Scene = {
      ...defaultScene(),
      cutaway: "house",
      placements: [{ id: "p1", characterId: "cast-arjun", x: -3, scale: 1, flip: false, pose: "stand", expression: "neutral" }],
    };
    const { svg } = renderScene(scene, castMap());
    expect(svg).toContain("INSIDE THE HOUSE");
  });

  it("style-guide palettes are present (R11)", () => {
    const night = renderScene({ ...defaultScene(), background: "savanna", variant: "night" }, castMap()).svg;
    expect(night).toContain("#0d0d1f");
    const day = renderScene({ ...defaultScene(), background: "savanna", variant: "day" }, castMap()).svg;
    expect(day).toContain("#a8d8d8");
    const cream = renderScene({ ...defaultScene(), background: "modern" }, castMap()).svg;
    expect(cream).toContain("#f0f0e0");
  });
});

describe("props, lighting, text card, watermark", () => {
  it.each(PROP_IDS)("prop %s renders", (prop) => {
    const scene: Scene = {
      ...defaultScene(),
      props: [{ id: "p", prop, x: 0, y: prop === "clock" ? -4 : 0, scale: 1, text: "TEST" }],
    };
    const { svg } = renderScene(scene, castMap());
    expect(svg.length).toBeGreaterThan(1500);
  });

  it("fire lighting adds a warm glow pool (R12)", () => {
    const scene: Scene = {
      ...defaultScene(),
      lighting: "fire",
      props: [{ id: "p", prop: "fire", x: 2, y: 0, scale: 1, text: "" }],
    };
    const { svg } = renderScene(scene, castMap());
    expect(svg).toContain("fireGlow");
    expect(svg).toContain("#ff9a2a");
  });

  it("text card renders all-caps hand-font title (R19)", () => {
    const scene: Scene = {
      ...defaultScene(),
      textCard: { title: "We never think twice", sub: "Chapter one" },
    };
    const { svg } = renderScene(scene, castMap());
    expect(svg).toContain("WE NEVER THINK TWICE");
    expect(svg).toContain("Chapter one");
    expect(svg).toContain("Patrick Hand");
  });

  it("watermark slot is present by default, off when disabled (R20)", () => {
    const on = renderScene({ ...defaultScene(), watermark: true }, castMap()).svg;
    expect(on).toContain("CHARACTER STUDIO");
    const off = renderScene({ ...defaultScene(), watermark: false }, castMap()).svg;
    expect(off).not.toContain("CHARACTER STUDIO");
  });

  it("name labels draw the cast name under the feet", () => {
    const scene: Scene = {
      ...defaultScene(),
      nameLabels: true,
      placements: [{ id: "p1", characterId: "cast-asha", x: 0, scale: 1, flip: false, pose: "stand", expression: "neutral" }],
    };
    const { svg } = renderScene(scene, castMap());
    expect(svg).toContain("ASHA");
  });
});

describe("camera", () => {
  it("wide = full 16x9 frame", () => {
    expect(cameraViewBox({ ...defaultScene(), camera: "wide" })).toBe("-8 -7 16 9");
  });

  it("medium narrows to 10 units around the cast centroid", () => {
    const scene: Scene = {
      ...defaultScene(),
      camera: "medium",
      placements: [
        { id: "p1", characterId: "cast-arjun", x: -2, scale: 1, flip: false, pose: "stand", expression: "neutral" },
        { id: "p2", characterId: "cast-asha", x: 2, scale: 1, flip: false, pose: "stand", expression: "neutral" },
      ],
    };
    expect(cameraViewBox(scene)).toBe("-5.00 -5.4 10 5.625");
  });

  it("close-up frames 6 units on the first character", () => {
    const scene: Scene = {
      ...defaultScene(),
      camera: "closeup",
      placements: [{ id: "p1", characterId: "cast-arjun", x: 1, scale: 1, flip: false, pose: "stand", expression: "neutral" }],
    };
    expect(cameraViewBox(scene)).toBe("-2.00 -5.1 6 3.375");
  });
});

describe("missing characters and validation", () => {
  it("a placement whose cast member is gone warns and still renders", () => {
    const scene: Scene = {
      ...defaultScene(),
      placements: [{ id: "p1", characterId: "cast-deleted", x: 0, scale: 1, flip: false, pose: "stand", expression: "neutral" }],
    };
    const { svg, warnings } = renderScene(scene, castMap());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("cast-deleted");
    expect(svg).toContain("<svg");
  });

  it("validateScene rejects a bad background and accepts a good scene", () => {
    expect(validateScene({ ...defaultScene(), background: "mars" }).ok).toBe(false);
    expect(validateScene(defaultScene()).ok).toBe(true);
  });

  it("pose/expression overrides on a placement change the render", () => {
    const base: Scene = {
      ...defaultScene(),
      placements: [{ id: "p1", characterId: "cast-arjun", x: 0, scale: 1, flip: false, pose: "stand", expression: "neutral" }],
    };
    const waved: Scene = {
      ...base,
      placements: [{ id: "p1", characterId: "cast-arjun", x: 0, scale: 1, flip: false, pose: "wave", expression: "happy" }],
    };
    expect(renderScene(base, castMap()).svg).not.toBe(renderScene(waved, castMap()).svg);
  });
});
