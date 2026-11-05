import { describe, expect, it } from "vitest";
import { defaultCharacter } from "./character";
import { renderCharacterSvg } from "./renderer";

function medianMs(render: () => string, warmup = 20, runs = 100): { median: number; p95: number; max: number } {
  for (let i = 0; i < warmup; i++) render();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    render();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(runs / 2)], p95: times[Math.floor(runs * 0.95)], max: times[runs - 1] };
}

describe("preview render budget (<16ms)", () => {
  it("default character (stand, ragged, caveman) renders under budget", () => {
    const c = defaultCharacter();
    const { median, p95, max } = medianMs(() => renderCharacterSvg(c));
    // Logged for the M0b report; the assertion is the budget.
    console.log(`stand: median ${median.toFixed(3)}ms p95 ${p95.toFixed(3)}ms max ${max.toFixed(3)}ms`);
    expect(median).toBeLessThan(16);
  });

  it("heavy character (lie + spiky + suit + sword + wizard) renders under budget", () => {
    const base = defaultCharacter();
    const c = {
      ...base,
      pose: "lie" as const,
      hair: { ...base.hair, style: "spiky" as const },
      outfit: { ...base.outfit, outfit: "suit" as const, hat: "wizard" as const, hold: "sword" as const },
    };
    const { median, p95, max } = medianMs(() => renderCharacterSvg(c));
    console.log(`heavy: median ${median.toFixed(3)}ms p95 ${p95.toFixed(3)}ms max ${max.toFixed(3)}ms`);
    expect(median).toBeLessThan(16);
  });

  it("walk pose renders under budget", () => {
    const c = { ...defaultCharacter(), pose: "walk" as const };
    const { median } = medianMs(() => renderCharacterSvg(c));
    console.log(`walk: median ${median.toFixed(3)}ms`);
    expect(median).toBeLessThan(16);
  });
});
