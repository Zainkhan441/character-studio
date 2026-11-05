/**
 * Character version history (audit item 3, 2026-11-05).
 *
 * Every time a character already in the cast is overwritten with
 * different content, the OLD version is snapshotted here first, so a
 * bad edit can always be restored. Per character id, up to 10
 * snapshots are kept (oldest dropped first). Stored in localStorage
 * under "character-studio-versions-v1" — the Character schema itself
 * is untouched; versions are a separate store keyed by character id.
 *
 * Pure list ops (pushVersion / recordOverwrite / restoreVersion) so
 * they are unit-testable without storage; loadVersions / saveVersions
 * are the SSR-safe storage wrappers.
 */
import { validateCharacter, type Character } from "./character";

export const VERSIONS_STORAGE_KEY = "character-studio-versions-v1";

/** Max snapshots kept per character id. */
export const MAX_VERSIONS_PER_CHARACTER = 10;

export interface CharacterVersion {
  /** 1-based, increments per character id, never reused. */
  version: number;
  character: Character;
  /** Epoch ms when the snapshot was taken. */
  savedAt: number;
}

/** character id -> snapshots, oldest first. */
export type VersionStore = Record<string, CharacterVersion[]>;

function isBrowser(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/** Load the version store. Corrupt entries are dropped, never crash. */
export function loadVersions(): VersionStore {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(VERSIONS_STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const store: VersionStore = {};
    for (const [id, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const versions: CharacterVersion[] = [];
      for (const entry of list) {
        if (
          typeof entry !== "object" ||
          entry === null ||
          typeof (entry as { version?: unknown }).version !== "number" ||
          typeof (entry as { savedAt?: unknown }).savedAt !== "number"
        ) {
          continue;
        }
        const result = validateCharacter((entry as { character?: unknown }).character);
        if (!result.ok) continue;
        versions.push({
          version: (entry as { version: number }).version,
          character: result.character,
          savedAt: (entry as { savedAt: number }).savedAt,
        });
      }
      if (versions.length > 0) store[id] = versions;
    }
    return store;
  } catch {
    return {};
  }
}

/** Persist the version store. Returns false when storage is unavailable. */
export function saveVersions(store: VersionStore): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(VERSIONS_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/** Snapshots for one character, oldest first (empty when none). */
export function getVersions(store: VersionStore, id: string): CharacterVersion[] {
  return store[id] ? [...store[id]] : [];
}

/**
 * Push a snapshot of `snapshot` for `id`. Version numbers keep
 * incrementing (never reused after a drop); the list is capped at
 * MAX_VERSIONS_PER_CHARACTER, oldest dropped first. Pure.
 */
export function pushVersion(
  store: VersionStore,
  id: string,
  snapshot: Character,
  savedAt: number = Date.now(),
): VersionStore {
  const existing = store[id] ?? [];
  const nextVersion =
    existing.reduce((max, v) => Math.max(max, v.version), 0) + 1;
  const next = [...existing, { version: nextVersion, character: snapshot, savedAt }];
  const capped = next.slice(-MAX_VERSIONS_PER_CHARACTER);
  return { ...store, [id]: capped };
}

/**
 * Record the old character before an overwrite: when `oldChar`
 * exists and differs from `newChar`, push the OLD version into the
 * store. New characters and identical overwrites record nothing.
 * Pure — used by upsertCast in ./cast.ts.
 */
export function recordOverwrite(
  store: VersionStore,
  oldChar: Character | undefined,
  newChar: Character,
): VersionStore {
  if (!oldChar) return store;
  if (JSON.stringify(oldChar) === JSON.stringify(newChar)) return store;
  return pushVersion(store, oldChar.id, oldChar);
}

/**
 * Return the snapshot for `version` of character `id`, or null when
 * there is no such snapshot. The caller upserts the returned
 * character back into the cast to restore it.
 */
export function restoreVersion(
  store: VersionStore,
  id: string,
  version: number,
): Character | null {
  const found = (store[id] ?? []).find((v) => v.version === version);
  return found ? found.character : null;
}

/** Drop all versions for one character (e.g. when it is deleted). */
export function clearVersionsFor(store: VersionStore, id: string): VersionStore {
  if (!(id in store)) return store;
  const next = { ...store };
  delete next[id];
  return next;
}
