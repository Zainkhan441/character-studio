import { describe, expect, it } from "vitest";
import { ANIMAL_SPECIES, animalHeight, animalSvg } from "./animals";

describe("animalSvg", () => {
  it.each(ANIMAL_SPECIES)("species %s renders a non-empty group", (species) => {
    const svg = animalSvg(species);
    expect(svg).toContain("<g");
    expect(svg.length).toBeGreaterThan(800);
    expect(svg).toContain('transform="translate(0.00,0.00)');
  });

  it("same species + same opts => identical output (deterministic)", () => {
    expect(animalSvg("cow", { x: 2, scale: 0.8 })).toBe(animalSvg("cow", { x: 2, scale: 0.8 }));
  });

  it("different species render differently", () => {
    const svgs = ANIMAL_SPECIES.map((s) => animalSvg(s));
    const unique = new Set(svgs);
    expect(unique.size).toBe(ANIMAL_SPECIES.length);
  });

  it("flip faces the animal left", () => {
    expect(animalSvg("horse", { facing: "left" })).toContain("scale(-1.00,1.00)");
    expect(animalSvg("horse", { facing: "right" })).toContain("scale(1.00,1.00)");
  });

  it("cow has spots, horse has a mane, goat has horns, dog has floppy ears", () => {
    const cow = animalSvg("cow");
    expect(cow).toContain("#3c352f"); // dark spots
    const horse = animalSvg("horse");
    expect(horse).toContain("#3b2416"); // mane
    const goat = animalSvg("goat");
    expect(goat).toContain("#5a4a3a"); // horns
    const dog = animalSvg("dog");
    expect(dog).toContain("#6a4226"); // floppy ears
  });

  it("animal heights are ordered horse > cow > goat > dog", () => {
    expect(animalHeight("horse")).toBeGreaterThan(animalHeight("cow"));
    expect(animalHeight("cow")).toBeGreaterThan(animalHeight("goat"));
    expect(animalHeight("goat")).toBeGreaterThan(animalHeight("dog"));
  });

  it("unknown species throws a descriptive error", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => animalSvg("dragon" as any)).toThrow("unknown species");
  });
});
