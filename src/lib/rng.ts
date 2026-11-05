/**
 * Deterministic seeded RNG.
 *
 * The reference Python engine uses `random.Random(seed)` (Mersenne Twister).
 * We do NOT need byte-identical numbers to Python — we need the guarantee
 * that the same seed + same character always produces the same SVG in THIS
 * renderer. mulberry32 is small, fast, and deterministic across engines.
 * Never use Math.random() or Date.now() inside the renderer.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Float in [min, max). Mirrors Python's random.uniform(a, b). */
  uniform(min: number, max: number): number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    uniform: (min: number, max: number): number => min + (max - min) * next(),
  };
}
