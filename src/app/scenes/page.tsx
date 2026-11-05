"use client";

/**
 * Scene Editor — /scenes
 *
 * Build one still scene: pick a background (11 + day/dusk/night),
 * place cast characters with poses, add props and animals, choose
 * camera + lighting, or drop in a cut-away template. The canvas is
 * the real renderScene() output — what you see is the still that
 * goes into the video.
 *
 * Autosaves the draft to localStorage on every change; undo/redo
 * (Ctrl+Z / Ctrl+Shift+Z) via a capped History stack. Saved scenes
 * live in localStorage (Supabase later — no auth/billing in MVP).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  BACKGROUND_IDS,
  BACKGROUND_NAMES,
  CAMERAS,
  CAMERA_NAMES,
  CUTAWAYS,
  CUTAWAY_NAMES,
  LIGHTINGS,
  LIGHTING_NAMES,
  PROP_IDS,
  PROP_NAMES,
  VARIANTS,
  defaultScene,
  loadDraft,
  loadScenes,
  removeScene,
  renderScene,
  saveDraft,
  saveScenes,
  upsertScene,
  type BackgroundId,
  type CameraKind,
  type CutawayId,
  type LightingKind,
  type PropId,
  type Scene,
  type Variant,
} from "@/lib/scene";
import { ANIMAL_NAMES, ANIMAL_SPECIES, type AnimalSpecies } from "@/lib/animals";
import { FACE_NAMES, POSE_NAMES, type FaceName, type PoseName } from "@/lib/character";
import { loadCast } from "@/lib/cast";
import { History } from "@/lib/history";
import type { Character } from "@/lib/character";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Aspect ratios for the still (also what the story export uses). */
type Aspect = "16:9" | "9:16" | "1:1";
const ASPECT_SIZES: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 720, height: 720 },
};

/** One-click scene presets (background + time + lighting + camera). */
const SCENE_PRESETS: Array<{
  id: string;
  name: string;
  patch: { background: BackgroundId; variant: Variant; lighting: LightingKind; camera: CameraKind; cutaway: null };
}> = [
  { id: "campfire", name: "Night campfire", patch: { background: "hut", variant: "night", lighting: "fire", camera: "medium", cutaway: null } },
  { id: "village", name: "Day village", patch: { background: "village", variant: "day", lighting: "none", camera: "wide", cutaway: null } },
  { id: "snow", name: "Snowy hunt", patch: { background: "snow", variant: "dusk", lighting: "night", camera: "wide", cutaway: null } },
  { id: "cave", name: "Cave story", patch: { background: "cave", variant: "night", lighting: "fire", camera: "closeup", cutaway: null } },
];

export default function ScenesPage() {
  const [mounted, setMounted] = useState(false);
  const [scene, setScene] = useState<Scene>(() => defaultScene());
  const [cast, setCast] = useState<Character[]>([]);
  const [saved, setSaved] = useState<Scene[]>([]);
  const [savedDropped, setSavedDropped] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [histState, setHistState] = useState({ canUndo: false, canRedo: false });
  const [sceneName, setSceneName] = useState("");
  const [newCharId, setNewCharId] = useState("");
  const [newProp, setNewProp] = useState<PropId>("fire");
  const [newAnimal, setNewAnimal] = useState<AnimalSpecies>("cow");
  const [labelText, setLabelText] = useState("Look here");
  const [copied, setCopied] = useState(false);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "offline">("saved");
  const [online, setOnline] = useState(true);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<History<Scene> | null>(null);
  const sceneRef = useRef<Scene>(scene);

  const refreshHistState = useCallback(() => {
    const h = historyRef.current;
    setHistState({ canUndo: h?.canUndo ?? false, canRedo: h?.canRedo ?? false });
  }, []);

  useEffect(() => {
    const { scene: draft, notice: draftNotice } = loadDraft();
    const { cast: loadedCast } = loadCast();
    const { scenes: loadedScenes, dropped } = loadScenes();
    setScene(draft);
    sceneRef.current = draft;
    historyRef.current = new History<Scene>(draft);
    setCast(loadedCast);
    setSaved(loadedScenes);
    setSavedDropped(dropped);
    setSceneName(draft.name);
    if (loadedCast.length > 0) setNewCharId(loadedCast[0].id);
    if (draftNotice) setNotice(draftNotice);
    setMounted(true);
    refreshHistState();
  }, [refreshHistState]);

  // Autosave the draft (debounced) on every change.
  useEffect(() => {
    if (!mounted) return;
    setSaveStatus(online ? "saving" : "offline");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDraft(sceneRef.current);
      setSavedAt(new Date().toLocaleTimeString());
      setSaveStatus(navigator.onLine ? "saved" : "offline");
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [scene, mounted, online]);

  // Online/offline indicator for the autosave status.
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      setSaveStatus("saved");
    };
    const goOffline = () => {
      setOnline(false);
      setSaveStatus("offline");
    };
    setOnline(navigator.onLine);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const commit = useCallback(
    (next: Scene) => {
      historyRef.current?.push(next);
      sceneRef.current = next;
      setScene(next);
      refreshHistState();
    },
    [refreshHistState],
  );

  const update = useCallback(
    (patch: Partial<Scene>) => {
      commit({ ...sceneRef.current, ...patch });
    },
    [commit],
  );

  const undo = useCallback(() => {
    const prev = historyRef.current?.undo();
    if (prev) {
      sceneRef.current = prev;
      setScene(prev);
      setSceneName(prev.name);
      refreshHistState();
    }
  }, [refreshHistState]);

  const redo = useCallback(() => {
    const next = historyRef.current?.redo();
    if (next) {
      sceneRef.current = next;
      setScene(next);
      setSceneName(next.name);
      refreshHistState();
    }
  }, [refreshHistState]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const castMap = useMemo(() => new Map(cast.map((c) => [c.id, c])), [cast]);

  const rendered = useMemo(() => {
    try {
      const r = renderScene(scene, castMap, ASPECT_SIZES[aspect]);
      setRenderError(null);
      return r;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      setRenderError(message);
      return { svg: "", warnings: [] as string[], ms: 0 };
    }
  }, [scene, castMap, aspect]);

  // Preview must crop like the export does: the scene viewBox is
  // always 16:9, so a 9:16/1:1 preview letterboxed the still into a
  // band while the MP4 export cropped vertically (QA 2026-11-05).
  // slice + the aspect-ratio container = true WYSIWYG.
  const previewSvg = useMemo(
    () => rendered.svg.replace("<svg ", '<svg preserveAspectRatio="xMidYMid slice" '),
    [rendered.svg],
  );

  const applyPreset = useCallback(
    (preset: (typeof SCENE_PRESETS)[number]) => {
      update(preset.patch);
      setNotice(`Scene preset applied: ${preset.name}.`);
    },
    [update],
  );

  const downloadSvg = () => {
    const blob = new Blob([rendered.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scene.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "scene"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(scene, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("Could not copy — clipboard unavailable.");
    }
  };

  const saveScene = () => {
    const named: Scene = { ...sceneRef.current, name: sceneName.trim() || "Untitled scene" };
    commit(named);
    const next = upsertScene(saved, named);
    setSaved(next);
    saveScenes(next);
    setNotice(`Scene "${named.name}" saved.`);
  };

  const loadSavedScene = (id: string) => {
    const found = saved.find((s) => s.id === id);
    if (!found) return;
    commit(found);
    setSceneName(found.name);
    setNotice(`Loaded "${found.name}".`);
  };

  const deleteSavedScene = (id: string) => {
    const next = removeScene(saved, id);
    setSaved(next);
    saveScenes(next);
  };

  const applyCutaway = (cutaway: CutawayId) => {
    update({ cutaway });
    setNotice(
      cutaway === "house"
        ? "House cut-away — the house is sliced open so the rooms show."
        : cutaway === "igloo"
          ? "Igloo cut-away — dome sliced open, fire and sleeping mat inside."
          : "Soil strata — grass, topsoil, clay and rock, with a buried bone and pot.",
    );
  };

  const addCharacter = () => {
    const member = cast.find((c) => c.id === newCharId);
    if (!member) {
      setNotice("No cast member selected — add characters in the Creator first.");
      return;
    }
    const xs = sceneRef.current.placements.map((p) => p.x);
    const x = xs.length === 0 ? -2.5 : Math.min(7, Math.max(...xs) + 2.5);
    commit({
      ...sceneRef.current,
      placements: [
        ...sceneRef.current.placements,
        { id: uid("pl"), characterId: member.id, x, scale: 1, flip: false, pose: null, expression: null },
      ],
    });
  };

  const addProp = () => {
    commit({
      ...sceneRef.current,
      props: [
        ...sceneRef.current.props,
        { id: uid("pr"), prop: newProp, x: 3, y: newProp === "clock" ? -4 : 0, scale: 1, text: newProp === "label" ? labelText : "" },
      ],
    });
  };

  const addAnimal = () => {
    commit({
      ...sceneRef.current,
      animals: [...sceneRef.current.animals, { id: uid("an"), species: newAnimal, x: 4.5, scale: 0.8, flip: false }],
    });
  };

  const saveLabel =
    saveStatus === "offline"
      ? "● Offline — saved on this device"
      : saveStatus === "saving"
        ? "● Saving…"
        : savedAt
          ? `● Saved ${savedAt}`
          : "● Autosave on";

  if (!mounted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white text-neutral-500">
        Loading the scene studio…
      </main>
    );
  }

  return (
    <AppShell
      active="scenes"
      actions={
        <>
          <span className="hidden text-xs text-neutral-500 md:inline" title="Autosave status">
            {saveLabel}
          </span>
          <button type="button" onClick={undo} disabled={!histState.canUndo} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40">↩ Undo</button>
          <button type="button" onClick={redo} disabled={!histState.canRedo} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40">↪ Redo</button>
          <button type="button" onClick={downloadSvg} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">Download SVG</button>
          <button type="button" onClick={copyJson} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">{copied ? "Copied ✓" : "Copy JSON"}</button>
        </>
      }
    >

      {notice && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:mx-6">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-amber-700 underline">Dismiss</button>
        </div>
      )}
      {savedDropped > 0 && (
        <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 sm:mx-6">
          {savedDropped} saved scene{savedDropped > 1 ? "s" : ""} failed validation and were dropped.
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 lg:flex-row">
        {/* Canvas */}
        <section className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold">
              {scene.name}
              <span className="ml-2 text-sm font-normal text-neutral-500">
                {scene.cutaway ? ` · ${CUTAWAY_NAMES[scene.cutaway]}` : ` · ${BACKGROUND_NAMES[scene.background]} · ${scene.variant}`}
                {` · ${CAMERA_NAMES[scene.camera]} · ${LIGHTING_NAMES[scene.lighting]}`}
              </span>
            </h1>
            <div className="flex items-center gap-2" role="group" aria-label="Aspect ratio">
              {(["16:9", "9:16", "1:1"] as Aspect[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAspect(a)}
                  aria-pressed={aspect === a}
                  title={a === "16:9" ? "Widescreen video" : a === "9:16" ? "Vertical Short / Reel" : "Square post"}
                  className={`rounded-md border px-3 py-1.5 text-sm ${aspect === a ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100"}`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {renderError ? (
            <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-6 text-sm text-red-900">
              This scene could not be rendered: {renderError}
            </div>
          ) : (
            <div
              className="mt-3 overflow-hidden rounded-xl border border-neutral-200 [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
              style={{ aspectRatio: `${ASPECT_SIZES[aspect].width} / ${ASPECT_SIZES[aspect].height}` }}
            >
              <span className="block h-full w-full" dangerouslySetInnerHTML={{ __html: previewSvg }} />
            </div>
          )}
          <p className="mt-2 text-xs text-neutral-500">
            Rendered in {rendered.ms.toFixed(2)} ms (thumbnail budget &lt;100 ms) · {aspect} still — one shot in your video, held ~2.3 s.
            {rendered.warnings.length > 0 && (
              <span className="text-amber-700"> Warnings: {rendered.warnings.join(" ")}</span>
            )}
          </p>

          {/* Saved scenes */}
          <div className="mt-6 rounded-xl border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold">Save this scene</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={sceneName}
                onChange={(e) => setSceneName(e.target.value)}
                placeholder="Scene name"
                className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
              />
              <button type="button" onClick={saveScene} className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm text-white hover:bg-neutral-700">Save scene</button>
              <button
                type="button"
                onClick={() => {
                  const fresh = defaultScene();
                  commit(fresh);
                  setSceneName(fresh.name);
                }}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
              >
                New scene
              </button>
            </div>
            {saved.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">No saved scenes yet — save this one and it will be here next time.</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {saved.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-neutral-100 px-3 py-2 text-sm">
                    <button type="button" onClick={() => loadSavedScene(s.id)} className="text-left font-medium hover:underline">
                      {s.name}
                      <span className="ml-2 font-normal text-neutral-500">
                        {s.cutaway ? CUTAWAY_NAMES[s.cutaway] : BACKGROUND_NAMES[s.background]} · {s.placements.length} character{s.placements.length === 1 ? "" : "s"}
                      </span>
                    </button>
                    <button type="button" onClick={() => deleteSavedScene(s.id)} className="text-red-700 hover:underline">Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Controls */}
        <aside className="w-full shrink-0 space-y-5 lg:w-80">
          <section className="rounded-xl border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold">Scene presets</h2>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              One click sets background, time of day, lighting and camera.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {SCENE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="rounded-md border border-neutral-300 px-2 py-1.5 text-xs hover:bg-neutral-100"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold">Background</h2>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {BACKGROUND_IDS.map((bg) => (
                <button
                  key={bg}
                  type="button"
                  onClick={() => update({ background: bg as BackgroundId, cutaway: null })}
                  className={`rounded-md border px-2 py-1.5 text-xs ${scene.background === bg && !scene.cutaway ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100"}`}
                >
                  {BACKGROUND_NAMES[bg]}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              {VARIANTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update({ variant: v as Variant })}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs capitalize ${scene.variant === v ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold">Cut-away templates</h2>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              The most valuable shot in this genre — the scene sliced open so the inside shows.
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {CUTAWAYS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => applyCutaway(c as CutawayId)}
                  className={`rounded-md border px-2 py-1.5 text-xs ${scene.cutaway === c ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100"}`}
                >
                  {CUTAWAY_NAMES[c]}
                </button>
              ))}
            </div>
            {scene.cutaway && (
              <button type="button" onClick={() => update({ cutaway: null })} className="mt-2 text-xs text-neutral-600 underline">
                Clear cut-away (back to background)
              </button>
            )}
          </section>

          <section className="rounded-xl border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold">Camera &amp; lighting</h2>
            <div className="mt-2 flex gap-2">
              {CAMERAS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update({ camera: c as CameraKind })}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${scene.camera === c ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100"}`}
                >
                  {CAMERA_NAMES[c]}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {LIGHTINGS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => update({ lighting: l as LightingKind })}
                  className={`rounded-md border px-2 py-1.5 text-xs ${scene.lighting === l ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100"}`}
                >
                  {LIGHTING_NAMES[l]}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold">Characters ({scene.placements.length}/6)</h2>
            {scene.placements.length === 0 && (
              <p className="mt-1 text-xs text-neutral-500">No characters yet — add one from your cast.</p>
            )}
            <div className="mt-2 space-y-3">
              {scene.placements.map((p, i) => {
                const member = castMap.get(p.characterId);
                return (
                  <div key={p.id} className="rounded-lg border border-neutral-100 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{member ? member.name : p.characterId}</span>
                      <button
                        type="button"
                        onClick={() => commit({ ...sceneRef.current, placements: sceneRef.current.placements.filter((x) => x.id !== p.id) })}
                        className="text-xs text-red-700 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <label className="mt-2 block text-xs text-neutral-500">
                      Position {p.x.toFixed(1)}
                      <input
                        type="range" min={-7} max={7} step={0.5} value={p.x}
                        onChange={(e) => {
                          const next = [...sceneRef.current.placements];
                          next[i] = { ...next[i], x: Number(e.target.value) };
                          commit({ ...sceneRef.current, placements: next });
                        }}
                        className="w-full"
                      />
                    </label>
                    <label className="mt-1 block text-xs text-neutral-500">
                      Size {p.scale.toFixed(1)}×
                      <input
                        type="range" min={0.3} max={2} step={0.1} value={p.scale}
                        onChange={(e) => {
                          const next = [...sceneRef.current.placements];
                          next[i] = { ...next[i], scale: Number(e.target.value) };
                          commit({ ...sceneRef.current, placements: next });
                        }}
                        className="w-full"
                      />
                    </label>
                    <div className="mt-1 flex gap-2">
                      <select
                        value={p.pose ?? ""}
                        onChange={(e) => {
                          const next = [...sceneRef.current.placements];
                          next[i] = { ...next[i], pose: (e.target.value || null) as PoseName | null };
                          commit({ ...sceneRef.current, placements: next });
                        }}
                        className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs"
                      >
                        <option value="">Pose: as designed</option>
                        {POSE_NAMES.map((pn) => (
                          <option key={pn} value={pn}>{pn}</option>
                        ))}
                      </select>
                      <select
                        value={p.expression ?? ""}
                        onChange={(e) => {
                          const next = [...sceneRef.current.placements];
                          next[i] = { ...next[i], expression: (e.target.value || null) as FaceName | null };
                          commit({ ...sceneRef.current, placements: next });
                        }}
                        className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs"
                      >
                        <option value="">Face: as designed</option>
                        {FACE_NAMES.map((fn) => (
                          <option key={fn} value={fn}>{fn}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox" checked={p.flip}
                          onChange={(e) => {
                            const next = [...sceneRef.current.placements];
                            next[i] = { ...next[i], flip: e.target.checked };
                            commit({ ...sceneRef.current, placements: next });
                          }}
                        />
                        Flip
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <select
                value={newCharId}
                onChange={(e) => setNewCharId(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              >
                {cast.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                {cast.length === 0 && <option value="">No cast yet</option>}
              </select>
              <button type="button" onClick={addCharacter} disabled={scene.placements.length >= 6} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
                + Add
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold">Props ({scene.props.length}/12)</h2>
            <div className="mt-2 space-y-2">
              {scene.props.map((pr) => (
                <div key={pr.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{PROP_NAMES[pr.prop]}{pr.prop === "label" && pr.text ? ` — “${pr.text}”` : ""}</span>
                  <label className="text-xs text-neutral-500">
                    x
                    <input
                      type="number" min={-8} max={8} step={0.5} value={pr.x}
                      onChange={(e) => {
                        const next = [...sceneRef.current.props];
                        const idx = next.findIndex((x) => x.id === pr.id);
                        next[idx] = { ...next[idx], x: Number(e.target.value) };
                        commit({ ...sceneRef.current, props: next });
                      }}
                      className="ml-1 w-16 rounded-md border border-neutral-300 px-1 py-0.5 text-xs"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => commit({ ...sceneRef.current, props: sceneRef.current.props.filter((x) => x.id !== pr.id) })}
                    className="text-xs text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <select value={newProp} onChange={(e) => setNewProp(e.target.value as PropId)} className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
                {PROP_IDS.map((p) => (
                  <option key={p} value={p}>{PROP_NAMES[p]}</option>
                ))}
              </select>
              <button type="button" onClick={addProp} disabled={scene.props.length >= 12} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">+ Add</button>
            </div>
            {newProp === "label" && (
              <input
                value={labelText}
                onChange={(e) => setLabelText(e.target.value)}
                placeholder="Label text"
                className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              />
            )}
          </section>

          <section className="rounded-xl border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold">Animals ({scene.animals.length}/6)</h2>
            <div className="mt-2 space-y-2">
              {scene.animals.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{ANIMAL_NAMES[a.species]}</span>
                  <label className="text-xs text-neutral-500">
                    x
                    <input
                      type="number" min={-8} max={8} step={0.5} value={a.x}
                      onChange={(e) => {
                        const next = [...sceneRef.current.animals];
                        const idx = next.findIndex((x) => x.id === a.id);
                        next[idx] = { ...next[idx], x: Number(e.target.value) };
                        commit({ ...sceneRef.current, animals: next });
                      }}
                      className="ml-1 w-16 rounded-md border border-neutral-300 px-1 py-0.5 text-xs"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => commit({ ...sceneRef.current, animals: sceneRef.current.animals.filter((x) => x.id !== a.id) })}
                    className="text-xs text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <select value={newAnimal} onChange={(e) => setNewAnimal(e.target.value as AnimalSpecies)} className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
                {ANIMAL_SPECIES.map((s) => (
                  <option key={s} value={s}>{ANIMAL_NAMES[s]}</option>
                ))}
              </select>
              <button type="button" onClick={addAnimal} disabled={scene.animals.length >= 6} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">+ Add</button>
            </div>
          </section>

          <section className="rounded-xl border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold">Text card &amp; labels</h2>
            <input
              value={scene.textCard?.title ?? ""}
              onChange={(e) => update({ textCard: e.target.value.trim() ? { title: e.target.value, sub: scene.textCard?.sub ?? "" } : null })}
              placeholder="Title card text (empty = no card)"
              className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
            <input
              value={scene.textCard?.sub ?? ""}
              onChange={(e) => update({ textCard: scene.textCard ? { title: scene.textCard.title, sub: e.target.value } : null })}
              placeholder="Subtitle (optional)"
              disabled={!scene.textCard}
              className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm disabled:opacity-40"
            />
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={scene.watermark} onChange={(e) => update({ watermark: e.target.checked })} />
              Watermark (bottom-right, every frame)
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={scene.nameLabels} onChange={(e) => update({ nameLabels: e.target.checked })} />
              Name labels under feet (SARAH / JOHN)
            </label>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
