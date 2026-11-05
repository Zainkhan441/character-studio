"use client";

/**
 * Cast library — /cast
 *
 * Pure library view: the 5 starter characters plus anything saved
 * from the Creator. Each card renders its character live (the
 * renderer is ~0.1ms, so a grid of SVGs is cheap) and opens in the
 * Creator in one click. Family variants can be made right here — each
 * one is added to the cast.
 *
 * Library tools: text search (name / outfit), archive (hidden by
 * default, "Show archived" reveals them), duplicate, inline rename,
 * and per-character version history with restore. Pose editing and
 * wardrobe live in /creator, not here.
 *
 * Stored in localStorage, Zod-validated on load; corrupt entries are
 * dropped and reported, never a crash. Archived ids live under
 * "character-studio-archived-v1"; version snapshots under
 * "character-studio-versions-v1" (see lib/versions.ts). The Character
 * schema itself is untouched.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  archiveId,
  loadArchivedIds,
  loadCast,
  removeFromCast,
  saveArchivedIds,
  saveCast,
  starterCast,
  unarchiveId,
  upsertCast,
  type CastLoadResult,
} from "@/lib/cast";
import type { Character } from "@/lib/character";
import { makeFamilyVariant, type FamilyKind } from "@/lib/family";
import { measureCharacterViewBox } from "@/lib/fit-viewbox";
import { renderCharacterSvg } from "@/lib/renderer";
import {
  clearVersionsFor,
  getVersions,
  loadVersions,
  restoreVersion,
  saveVersions,
  type VersionStore,
} from "@/lib/versions";

const CARD_VIEWBOX = "-4.5 -9.5 9 10.5";

function cardSvg(c: Character): string {
  try {
    return renderCharacterSvg(c, { viewBox: CARD_VIEWBOX, background: "#f5f3ef" });
  } catch {
    return "";
  }
}

function newCharacterId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `char-${crypto.randomUUID()}`;
  }
  return `char-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/**
 * One cast card's artwork: renders the character SVG, then fits the
 * viewBox to the figure (same measurement as the Creator) so the
 * character fills the card instead of sitting small in the loose
 * default frame. The fitted viewBox is set on the DOM node directly
 * — no React state, so no re-render loop.
 */
function CastCardArt({ svg }: { svg: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vb = measureCharacterViewBox(el);
    const svgEl = el.querySelector("svg");
    if (vb && svgEl) svgEl.setAttribute("viewBox", vb);
  }, [svg]);
  return (
    <div
      ref={ref}
      className="bg-[#f5f3ef] [&_svg]:mx-auto [&_svg]:block [&_svg]:h-64 [&_svg]:w-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function CastPage() {
  const [cast, setCast] = useState<Character[]>([]);
  const [archivedIds, setArchivedIds] = useState<string[]>([]);
  const [versions, setVersions] = useState<VersionStore>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);

  useEffect(() => {
    const result: CastLoadResult = loadCast();
    setCast(result.cast);
    setArchivedIds(loadArchivedIds());
    setVersions(loadVersions());
    if (result.dropped > 0) {
      setNotice(`${result.dropped} saved character${result.dropped > 1 ? "s" : ""} could not be read and ${result.dropped > 1 ? "were" : "was"} dropped.`);
    } else if (result.seeded) {
      setNotice("Welcome! Here is your starter cast — click any character to open it in the Creator.");
    }
    setLoaded(true);
  }, []);

  const persist = (next: Character[]) => {
    setCast(next);
    saveCast(next);
    // upsertCast snapshots the old version into localStorage first;
    // re-read so the version counts update immediately.
    setVersions(loadVersions());
  };

  const persistArchived = (next: string[]) => {
    setArchivedIds(next);
    saveArchivedIds(next);
  };

  const makeVariant = (base: Character, kind: FamilyKind) => {
    const v = makeFamilyVariant(base, kind);
    persist(upsertCast(cast, v));
    setNotice(`${v.name} added to your cast.`);
  };

  const remove = (id: string, name: string) => {
    persist(removeFromCast(cast, id));
    persistArchived(archivedIds.filter((x) => x !== id));
    setVersions((prev) => {
      const next = clearVersionsFor(prev, id);
      saveVersions(next);
      return next;
    });
    setNotice(`${name} removed from the cast.`);
  };

  const resetCast = () => {
    const fresh = starterCast();
    persist(fresh);
    // Fresh start: the starters are visible again.
    persistArchived([]);
    setNotice("Cast reset to the 5 starters.");
  };

  const duplicate = (c: Character) => {
    const copy: Character = { ...c, id: newCharacterId(), name: `${c.name} (copy)` };
    persist(upsertCast(cast, copy));
    setNotice(`${copy.name} added to your cast.`);
  };

  const startRename = (c: Character) => {
    setRenamingId(c.id);
    setRenameDraft(c.name);
  };

  const saveRename = (c: Character) => {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (name.length === 0 || name === c.name) return;
    persist(upsertCast(cast, { ...c, name }));
    setNotice(`Renamed to ${name}.`);
  };

  const toggleArchive = (c: Character) => {
    const isArchived = archivedIds.includes(c.id);
    persistArchived(
      isArchived ? unarchiveId(archivedIds, c.id) : archiveId(archivedIds, c.id),
    );
    setNotice(isArchived ? `${c.name} restored to your cast.` : `${c.name} archived.`);
  };

  const restore = (id: string, version: number) => {
    const snapshot = restoreVersion(versions, id, version);
    if (!snapshot) return;
    // Restoring upserts the snapshot as current; upsertCast snapshots
    // the pre-restore state first, so the restore itself is undoable.
    persist(upsertCast(cast, snapshot));
    setOpenHistoryId(null);
    setNotice(`${snapshot.name} restored to version ${version}.`);
  };

  const svgs = useMemo(() => new Map(cast.map((c) => [c.id, cardSvg(c)])), [cast]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cast.filter((c) => {
      if (!showArchived && archivedIds.includes(c.id)) return false;
      if (q.length === 0) return true;
      return (
        c.name.toLowerCase().includes(q) || c.outfit.outfit.toLowerCase().includes(q)
      );
    });
  }, [cast, archivedIds, query, showArchived]);

  const archivedCount = cast.filter((c) => archivedIds.includes(c.id)).length;

  if (!loaded) {
    return (
      <AppShell active="characters">
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-sm text-neutral-600">Loading your cast…</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      active="characters"
      actions={
        <>
          <button
            type="button"
            onClick={resetCast}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            Reset to starters
          </button>
          <a
            href="/creator"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
          >
            + New character
          </a>
        </>
      }
    >
      {notice && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 sm:px-6">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-bold" aria-label="Dismiss notice">
            ×
          </button>
        </div>
      )}

      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Your cast</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {cast.length} character{cast.length === 1 ? "" : "s"}
          {archivedCount > 0 ? ` (${archivedCount} archived)` : ""}. Each one is data — the same
          character renders identically in every pose, outfit and scene. Got your own cartoon?{" "}
          <a href="/import" className="font-medium text-neutral-900 underline">Add your own character →</a>
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or outfit…"
            aria-label="Search characters"
            className="w-full max-w-sm rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-4 w-4 accent-neutral-900"
            />
            Show archived
          </label>
        </div>

        {visible.length === 0 ? (
          <p className="mt-8 text-sm text-neutral-500">
            {query.trim().length > 0
              ? `No characters match “${query.trim()}”.`
              : archivedCount > 0 && !showArchived
                ? "All characters are archived — turn on “Show archived” to see them."
                : "No characters yet — create one in the Creator."}
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((c) => {
              const isArchived = archivedIds.includes(c.id);
              const history = getVersions(versions, c.id);
              const isRenaming = renamingId === c.id;
              const historyOpen = openHistoryId === c.id;
              return (
                <article
                  key={c.id}
                  className={`overflow-hidden rounded-xl border ${isArchived ? "border-neutral-300 opacity-75" : "border-neutral-200"}`}
                >
                  <CastCardArt svg={svgs.get(c.id) ?? ""} />
                  <div className="border-t border-neutral-200 p-4">
                    <div className="flex items-start justify-between gap-2">
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => saveRename(c)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(c);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          aria-label="Character name"
                          maxLength={60}
                          className="w-full rounded border border-neutral-900 px-2 py-1 text-base font-semibold outline-none"
                        />
                      ) : (
                        <h2
                          className="cursor-text text-base font-semibold"
                          onClick={() => startRename(c)}
                          title="Click to rename"
                        >
                          {c.name}
                        </h2>
                      )}
                      {isArchived && (
                        <span className="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {c.outfit.outfit} · {c.hair.style} hair · {c.pose}
                    </p>
                    {history.length > 0 && (
                      <p className="mt-1 text-xs text-neutral-500">
                        <button
                          type="button"
                          onClick={() => setOpenHistoryId(historyOpen ? null : c.id)}
                          className="font-medium text-neutral-700 underline"
                        >
                          v{history.length} · history
                        </button>
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={`/creator?cast=${encodeURIComponent(c.id)}`}
                        className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700"
                      >
                        Open in Creator →
                      </a>
                      {(["female", "child", "elder"] as FamilyKind[]).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => makeVariant(c, kind)}
                          className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs capitalize hover:bg-neutral-100"
                          title={`Make a ${kind} variant of ${c.name}`}
                        >
                          + {kind}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => duplicate(c)}
                        className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs hover:bg-neutral-100"
                        title={`Duplicate ${c.name}`}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleArchive(c)}
                        className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs hover:bg-neutral-100"
                      >
                        {isArchived ? "Unarchive" : "Archive"}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c.id, c.name)}
                        className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>

                    {historyOpen && history.length > 0 && (
                      <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                        <p className="text-xs font-semibold text-neutral-700">Version history</p>
                        <ul className="mt-2 space-y-2">
                          {[...history].reverse().map((v) => (
                            <li key={v.version} className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-neutral-600">
                                v{v.version} · {v.character.name} ·{" "}
                                {new Date(v.savedAt).toLocaleString()}
                              </span>
                              <button
                                type="button"
                                onClick={() => restore(c.id, v.version)}
                                className="shrink-0 rounded border border-neutral-300 bg-white px-2 py-1 hover:bg-neutral-100"
                              >
                                Restore
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-xs leading-relaxed text-neutral-400">
          Cast members are stored in this browser for now (localStorage). Cloud sync with accounts comes later —
          no auth or billing in this milestone.
        </p>
      </div>
    </AppShell>
  );
}
