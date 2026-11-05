/**
 * Cast library (M1, 2026-11-05).
 *
 * The cast is a list of Characters stored as typed JSON in localStorage
 * (Supabase later — no auth/billing in the MVP). Every entry is
 * Zod-validated on load; corrupt entries are dropped and counted, never
 * allowed to crash the page.
 *
 * Starter cast: 5 characters built from the default + the family
 * transforms, covering adult male/female, elder, child and a medieval
 * warrior — so a new user has a usable cast in one click.
 */
import {
  defaultCharacter,
  validateCharacter,
  type Character,
} from "./character";
import { makeChild, makeElder, makeFemale } from "./family";

export const CAST_STORAGE_KEY = "character-studio:cast:v1";

/** Build the 5 starter characters. Pure — safe to call anywhere. */
export function starterCast(): Character[] {
  const base = defaultCharacter();

  const arjun: Character = {
    ...base,
    id: "cast-arjun",
    name: "Arjun",
    pose: "stand",
    hair: { ...base.hair, style: "short", color: "black" },
    outfit: { ...base.outfit, outfit: "shirt", hat: "none", hold: "none" },
  };

  const asha: Character = {
    ...makeFemale(arjun),
    id: "cast-asha",
    name: "Asha",
    hair: { ...arjun.hair, style: "long", color: "black" },
    outfit: { ...arjun.outfit, outfit: "shirt_red", hat: "none", hold: "none" },
  };

  const baba: Character = {
    ...makeElder(arjun),
    id: "cast-baba",
    name: "Baba Jaan",
    pose: "think",
    hair: { ...arjun.hair, style: "short", color: "grey", beard: "full" },
    outfit: { ...arjun.outfit, outfit: "robe", hat: "none", hold: "staff" },
  };

  const chotu: Character = {
    ...makeChild(arjun),
    id: "cast-chotu",
    name: "Chotu",
    pose: "wave",
    hair: { ...arjun.hair, style: "messy", color: "brown" },
    outfit: { ...arjun.outfit, outfit: "hoodie", hat: "none", hold: "none" },
  };

  const raja: Character = {
    ...base,
    id: "cast-raja",
    name: "Raja",
    pose: "aim",
    hair: { ...base.hair, style: "long", color: "black" },
    face: { ...base.face, stubble: true },
    outfit: { ...base.outfit, outfit: "medieval", hat: "helmet", hold: "spear" },
  };

  return [arjun, asha, baba, chotu, raja];
}

export interface CastLoadResult {
  cast: Character[];
  /** Entries dropped because they failed validation. */
  dropped: number;
  /** True when nothing was stored yet (first run). */
  seeded: boolean;
}

function readRaw(): unknown {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(CAST_STORAGE_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return { __corrupt: true };
  }
}

/**
 * Load the cast. Missing storage seeds the starter cast; corrupt
 * entries are dropped (and counted) instead of crashing.
 */
export function loadCast(): CastLoadResult {
  const raw = readRaw();
  if (raw === null) {
    return { cast: starterCast(), dropped: 0, seeded: true };
  }
  if (!Array.isArray(raw)) {
    return { cast: starterCast(), dropped: 1, seeded: true };
  }
  const cast: Character[] = [];
  let dropped = 0;
  for (const entry of raw) {
    const result = validateCharacter(entry);
    if (result.ok) cast.push(result.character);
    else dropped += 1;
  }
  if (cast.length === 0) {
    return { cast: starterCast(), dropped, seeded: true };
  }
  return { cast, dropped, seeded: false };
}

/** Persist the cast. Returns false when storage is unavailable. */
export function saveCast(cast: Character[]): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    window.localStorage.setItem(CAST_STORAGE_KEY, JSON.stringify(cast));
    return true;
  } catch {
    return false;
  }
}

/** Add a character to the cast (replaces any entry with the same id). */
export function upsertCast(cast: Character[], c: Character): Character[] {
  const rest = cast.filter((x) => x.id !== c.id);
  return [...rest, c];
}

export function removeFromCast(cast: Character[], id: string): Character[] {
  return cast.filter((x) => x.id !== id);
}
