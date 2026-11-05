/**
 * Version history tests (audit item 3, 2026-11-05).
 *
 * Covers: cap at 10 snapshots per character, restore returns the
 * right snapshot, and overwriting a character saves the old version
 * (via the pure recordOverwrite helper that upsertCast uses).
 */
import { describe, expect, it } from "vitest";
import { defaultCharacter, type Character } from "./character";
import {
  clearVersionsFor,
  getVersions,
  loadVersions,
  MAX_VERSIONS_PER_CHARACTER,
  pushVersion,
  recordOverwrite,
  restoreVersion,
  saveVersions,
  type VersionStore,
} from "./versions";

function charWithName(id: string, name: string): Character {
  return { ...defaultCharacter(), id, name };
}

describe("pushVersion", () => {
  it("numbers versions from 1 and appends in order", () => {
    let store: VersionStore = {};
    store = pushVersion(store, "c1", charWithName("c1", "v1"), 100);
    store = pushVersion(store, "c1", charWithName("c1", "v2"), 200);
    const versions = getVersions(store, "c1");
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(1);
    expect(versions[0].character.name).toBe("v1");
    expect(versions[0].savedAt).toBe(100);
    expect(versions[1].version).toBe(2);
    expect(versions[1].character.name).toBe("v2");
  });

  it("caps at 10 snapshots per character, oldest dropped first", () => {
    expect(MAX_VERSIONS_PER_CHARACTER).toBe(10);
    let store: VersionStore = {};
    for (let i = 1; i <= 12; i++) {
      store = pushVersion(store, "c1", charWithName("c1", `name-${i}`), i);
    }
    const versions = getVersions(store, "c1");
    expect(versions).toHaveLength(10);
    // Versions 1-2 dropped; version numbers keep incrementing.
    expect(versions[0].version).toBe(3);
    expect(versions[0].character.name).toBe("name-3");
    expect(versions[9].version).toBe(12);
    expect(versions[9].character.name).toBe("name-12");
  });

  it("versions are per character id", () => {
    let store: VersionStore = {};
    store = pushVersion(store, "c1", charWithName("c1", "a"), 1);
    store = pushVersion(store, "c2", charWithName("c2", "b"), 2);
    expect(getVersions(store, "c1")).toHaveLength(1);
    expect(getVersions(store, "c2")).toHaveLength(1);
    expect(getVersions(store, "c3")).toEqual([]);
  });
});

describe("restoreVersion", () => {
  it("returns the right snapshot by version number", () => {
    let store: VersionStore = {};
    store = pushVersion(store, "c1", charWithName("c1", "first"), 1);
    store = pushVersion(store, "c1", charWithName("c1", "second"), 2);
    store = pushVersion(store, "c1", charWithName("c1", "third"), 3);
    expect(restoreVersion(store, "c1", 1)?.name).toBe("first");
    expect(restoreVersion(store, "c1", 2)?.name).toBe("second");
    expect(restoreVersion(store, "c1", 3)?.name).toBe("third");
  });

  it("returns null for a missing version or character", () => {
    let store: VersionStore = {};
    store = pushVersion(store, "c1", charWithName("c1", "only"), 1);
    expect(restoreVersion(store, "c1", 99)).toBeNull();
    expect(restoreVersion(store, "nope", 1)).toBeNull();
  });
});

describe("recordOverwrite (the upsertCast hook)", () => {
  it("overwriting with different content saves the OLD version", () => {
    const oldChar = charWithName("c1", "Before");
    const newChar = charWithName("c1", "After");
    const store = recordOverwrite({}, oldChar, newChar);
    const versions = getVersions(store, "c1");
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].character.name).toBe("Before");
  });

  it("overwriting with identical content records nothing", () => {
    const c = charWithName("c1", "Same");
    expect(recordOverwrite({}, c, { ...c })).toEqual({});
  });

  it("adding a new character records nothing", () => {
    const c = charWithName("c1", "New");
    expect(recordOverwrite({}, undefined, c)).toEqual({});
  });

  it("repeated overwrites accumulate versions of each old state", () => {
    let store: VersionStore = {};
    const v1 = charWithName("c1", "v1");
    const v2 = charWithName("c1", "v2");
    const v3 = charWithName("c1", "v3");
    store = recordOverwrite(store, v1, v2);
    store = recordOverwrite(store, v2, v3);
    const versions = getVersions(store, "c1");
    expect(versions.map((v) => v.character.name)).toEqual(["v1", "v2"]);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });
});

describe("clearVersionsFor", () => {
  it("drops one character's versions and leaves the rest", () => {
    let store: VersionStore = {};
    store = pushVersion(store, "c1", charWithName("c1", "a"), 1);
    store = pushVersion(store, "c2", charWithName("c2", "b"), 2);
    const next = clearVersionsFor(store, "c1");
    expect(getVersions(next, "c1")).toEqual([]);
    expect(getVersions(next, "c2")).toHaveLength(1);
  });
});

describe("versions storage (SSR-safe)", () => {
  it("loads empty and save returns false without localStorage", () => {
    expect(loadVersions()).toEqual({});
    expect(saveVersions({})).toBe(false);
  });
});
