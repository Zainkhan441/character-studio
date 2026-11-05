"use client";

/**
 * Script-to-Video — /story
 *
 * Paste a script. Every line becomes a shot; long lines split into
 * two different shots. Each shot suggests a scene (background,
 * pose, props, animal, cut-away) from the line's keywords, and
 * renders it as a still thumbnail. Reorder by drag or by buttons,
 * retime is automatic (150 wpm), and the total runtime is always
 * visible.
 *
 * The format is a slideshow of stills with hard cuts (style guide
 * §5: median shot 2.3s) — so this page is the video. Export is
 * JSON for now; MP4 assembly is M3.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadCast } from "@/lib/cast";
import type { Character } from "@/lib/character";
import { FACE_NAMES, POSE_NAMES, type FaceName, type PoseName } from "@/lib/character";
import { BACKGROUND_IDS, BACKGROUND_NAMES, renderScene, type BackgroundId, type CameraKind, type Variant } from "@/lib/scene";
import {
  buildStoryboard,
  formatDuration,
  shotToScene,
  type Shot,
  type Storyboard,
} from "@/lib/story";

const STORAGE_KEY = "character-studio:story:script:v1";
const SHOTS_KEY = "character-studio:story:shots:v1";

const SAMPLE_SCRIPT = `THE FIRST NIGHT
Ancient humans did not sleep the way we do today.
They gathered around the fire at night and told stories while the stars came out.
The winter snow buried the camp, but inside the igloo the fire kept them warm.
Below the surface, layers of soil tell the story of everyone who lived here before us.
When morning came, they walked across the plain, following the horse herds for miles.
A king rose in the city, and everything changed.`;

export default function StoryPage() {
  const [mounted, setMounted] = useState(false);
  const [script, setScript] = useState("");
  const [board, setBoard] = useState<Storyboard | null>(null);
  const [cast, setCast] = useState<Character[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const boardRef = useRef<Storyboard | null>(null);

  useEffect(() => {
    const { cast: loadedCast } = loadCast();
    setCast(loadedCast);
    try {
      const savedScript = window.localStorage.getItem(STORAGE_KEY);
      if (savedScript) setScript(savedScript);
      const savedShots = window.localStorage.getItem(SHOTS_KEY);
      if (savedShots) {
        const parsed: unknown = JSON.parse(savedShots);
        if (parsed && typeof parsed === "object" && Array.isArray((parsed as { shots?: unknown }).shots)) {
          const b = parsed as Storyboard;
          boardRef.current = b;
          setBoard(b);
        }
      }
    } catch {
      // Corrupt saved storyboard: start fresh, never crash.
    }
    setMounted(true);
  }, []);

  const castMap = useMemo(() => new Map(cast.map((c) => [c.id, c])), [cast]);
  const castIds = useMemo(() => cast.map((c) => c.id), [cast]);

  const build = useCallback(() => {
    if (script.trim().length === 0) {
      setNotice("Paste a script first — or load the sample.");
      return;
    }
    const b = buildStoryboard(script, castIds);
    boardRef.current = b;
    setBoard(b);
    setSelectedId(b.shots[0]?.id ?? null);
    try {
      window.localStorage.setItem(STORAGE_KEY, script);
      window.localStorage.setItem(SHOTS_KEY, JSON.stringify(b));
    } catch {
      // Storage full/unavailable: the board still works in memory.
    }
    setNotice(
      `${b.lineCount} lines → ${b.shots.length} shots, ${formatDuration(b.totalSec)} total, ~${Math.round(b.shotsPerMinute)} shots/min.`,
    );
  }, [script, castIds]);

  const persistBoard = useCallback((b: Storyboard) => {
    boardRef.current = b;
    setBoard(b);
    try {
      window.localStorage.setItem(SHOTS_KEY, JSON.stringify(b));
    } catch {
      // Non-fatal.
    }
  }, []);

  const updateShot = useCallback(
    (id: string, patch: Partial<Shot["scene"]>) => {
      const b = boardRef.current;
      if (!b) return;
      const shots = b.shots.map((s) => (s.id === id ? { ...s, scene: { ...s.scene, ...patch } } : s));
      persistBoard({ ...b, shots });
    },
    [persistBoard],
  );

  const moveShot = useCallback(
    (id: string, dir: -1 | 1) => {
      const b = boardRef.current;
      if (!b) return;
      const idx = b.shots.findIndex((s) => s.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= b.shots.length) return;
      const shots = [...b.shots];
      const [moved] = shots.splice(idx, 1);
      shots.splice(target, 0, moved);
      persistBoard({ ...b, shots, totalSec: shots.reduce((s, x) => s + x.durationSec, 0) });
    },
    [persistBoard],
  );

  const dropShot = useCallback(
    (targetId: string) => {
      const b = boardRef.current;
      if (!b || !dragId || dragId === targetId) return;
      const from = b.shots.findIndex((s) => s.id === dragId);
      const to = b.shots.findIndex((s) => s.id === targetId);
      if (from < 0 || to < 0) return;
      const shots = [...b.shots];
      const [moved] = shots.splice(from, 1);
      shots.splice(to, 0, moved);
      persistBoard({ ...b, shots });
      setDragId(null);
    },
    [dragId, persistBoard],
  );

  const deleteShot = useCallback(
    (id: string) => {
      const b = boardRef.current;
      if (!b) return;
      const shots = b.shots.filter((s) => s.id !== id);
      persistBoard({ ...b, shots, totalSec: shots.reduce((s, x) => s + x.durationSec, 0) });
      if (selectedId === id) setSelectedId(shots[0]?.id ?? null);
    },
    [persistBoard, selectedId],
  );

  const selected = board?.shots.find((s) => s.id === selectedId) ?? null;
  const selectedIndex = board && selected ? board.shots.findIndex((s) => s.id === selected.id) : -1;

  const thumbs = useMemo(() => {
    if (!board) return new Map<string, string>();
    const out = new Map<string, string>();
    try {
      for (const shot of board.shots) {
        const scene = shotToScene(shot, 7);
        const { svg } = renderScene(scene, castMap, { width: 640, height: 360 });
        out.set(shot.id, svg);
      }
      setRenderError(null);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : "unknown error");
    }
    return out;
  }, [board, castMap]);

  const downloadJson = () => {
    if (!board) return;
    const blob = new Blob([JSON.stringify(board, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "storyboard.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("Could not copy — clipboard unavailable.");
    }
  };

  if (!mounted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white text-neutral-500">
        Loading the storyboard…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-white text-neutral-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3 sm:px-6">
        <span className="text-lg font-bold tracking-tight">Character Studio · Script → Video</span>
        <nav className="flex flex-wrap items-center gap-2">
          <a href="/" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">Home</a>
          <a href="/cast" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">Cast</a>
          <a href="/poses" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">Poses</a>
          <a href="/creator" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">Creator</a>
          <a href="/scenes" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700">Scene Editor</a>
        </nav>
      </header>

      {notice && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:mx-6">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-amber-700 underline">Dismiss</button>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 lg:flex-row">
        {/* Script input */}
        <section className="w-full shrink-0 lg:w-96">
          <h1 className="text-xl font-bold">Your script</h1>
          <p className="mt-1 text-sm leading-relaxed text-neutral-600">
            One line = one shot. Long lines split into two different shots automatically.
            ALL-CAPS lines become title cards. Timing is 150 words per minute.
          </p>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder={"Paste your script here — one idea per line.\n\nTHE FIRST NIGHT\nAncient humans did not sleep the way we do today.\nThey gathered around the fire at night…"}
            rows={14}
            className="mt-3 w-full rounded-xl border border-neutral-300 p-3 text-sm leading-relaxed"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={build} className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">
              Build storyboard →
            </button>
            <button
              type="button"
              onClick={() => {
                setScript(SAMPLE_SCRIPT);
                setNotice("Sample script loaded — press Build storyboard.");
              }}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
            >
              Load sample
            </button>
            <button type="button" onClick={copyScript} className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">
              {copied ? "Copied ✓" : "Copy script"}
            </button>
          </div>

          {board && (
            <div className="mt-4 rounded-xl border border-neutral-200 p-4">
              <h2 className="text-sm font-semibold">Video summary</h2>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-neutral-500">Shots</dt><dd className="font-medium">{board.shots.length}</dd></div>
                <div className="flex justify-between"><dt className="text-neutral-500">Script lines</dt><dd className="font-medium">{board.lineCount}</dd></div>
                <div className="flex justify-between"><dt className="text-neutral-500">Total runtime</dt><dd className="font-medium">{formatDuration(board.totalSec)}</dd></div>
                <div className="flex justify-between"><dt className="text-neutral-500">Pacing</dt><dd className="font-medium">~{Math.round(board.shotsPerMinute)} shots/min</dd></div>
                <div className="flex justify-between"><dt className="text-neutral-500">Format</dt><dd className="font-medium">Stills + hard cuts</dd></div>
              </dl>
              <button type="button" onClick={downloadJson} className="mt-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">
                Download storyboard JSON
              </button>
              <p className="mt-2 text-xs leading-relaxed text-neutral-500">
                MP4 export (stills + narration timing) is the next milestone — this JSON already
                describes every shot your video needs.
              </p>
            </div>
          )}

          {selected && (
            <div className="mt-4 rounded-xl border border-neutral-200 p-4">
              <h2 className="text-sm font-semibold">Edit shot {selectedIndex + 1}</h2>
              <p className="mt-1 text-sm leading-relaxed text-neutral-700">“{selected.text}”</p>
              <div className="mt-3 space-y-2 text-sm">
                <label className="block">
                  <span className="text-xs text-neutral-500">Background</span>
                  <select
                    value={selected.scene.background}
                    onChange={(e) => updateShot(selected.id, { background: e.target.value as BackgroundId })}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  >
                    {BACKGROUND_IDS.map((b) => (
                      <option key={b} value={b}>{BACKGROUND_NAMES[b]}</option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-2">
                  <label className="flex-1">
                    <span className="text-xs text-neutral-500">Time of day</span>
                    <select
                      value={selected.scene.variant}
                      onChange={(e) => updateShot(selected.id, { variant: e.target.value as Variant })}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                    >
                      <option value="day">Day</option>
                      <option value="dusk">Dusk</option>
                      <option value="night">Night</option>
                    </select>
                  </label>
                  <label className="flex-1">
                    <span className="text-xs text-neutral-500">Camera</span>
                    <select
                      value={selected.scene.camera}
                      onChange={(e) => updateShot(selected.id, { camera: e.target.value as CameraKind })}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                    >
                      <option value="wide">Wide</option>
                      <option value="medium">Medium</option>
                      <option value="closeup">Close-up</option>
                    </select>
                  </label>
                </div>
                <div className="flex gap-2">
                  <label className="flex-1">
                    <span className="text-xs text-neutral-500">Pose</span>
                    <select
                      value={selected.scene.pose}
                      onChange={(e) => updateShot(selected.id, { pose: e.target.value as PoseName })}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                    >
                      {POSE_NAMES.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex-1">
                    <span className="text-xs text-neutral-500">Expression</span>
                    <select
                      value={selected.scene.expression}
                      onChange={(e) => updateShot(selected.id, { expression: e.target.value as FaceName })}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                    >
                      {FACE_NAMES.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs text-neutral-500">Character</span>
                  <select
                    value={selected.scene.characterId ?? ""}
                    onChange={(e) => updateShot(selected.id, { characterId: e.target.value || null })}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">No character (diagram / title shot)</option>
                    {cast.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-neutral-500">
                  Shot {selected.part} of {selected.ofParts} · {selected.durationSec.toFixed(1)}s ·{" "}
                  {selected.scene.cutaway ? `Cut-away: ${selected.scene.cutaway}` : selected.scene.background}
                  {selected.scene.lighting !== "none" ? ` · ${selected.scene.lighting} light` : ""}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Storyboard */}
        <section className="min-w-0 flex-1">
          {!board || board.shots.length === 0 ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 p-8 text-center">
              <p className="text-lg font-semibold">No storyboard yet</p>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-600">
                Paste a script on the left and press “Build storyboard”. Every line becomes a
                still shot with its own scene — exactly how the videos in this niche are made:
                ~25 stills a minute, hard cuts, no in-shot animation.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-bold">
                  Storyboard — {board.shots.length} shots · {formatDuration(board.totalSec)}
                </h2>
                <p className="text-xs text-neutral-500">Drag cards to reorder · click a card to edit its scene</p>
              </div>
              {renderError && (
                <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
                  A thumbnail could not be rendered: {renderError}
                </div>
              )}
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {board.shots.map((shot, i) => (
                  <article
                    key={shot.id}
                    draggable
                    onDragStart={() => setDragId(shot.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropShot(shot.id)}
                    onClick={() => setSelectedId(shot.id)}
                    className={`cursor-pointer rounded-xl border p-3 ${selectedId === shot.id ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400"} ${dragId === shot.id ? "opacity-50" : ""}`}
                  >
                    <div className="overflow-hidden rounded-lg border border-neutral-100 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full">
                      {thumbs.get(shot.id) ? (
                        <span dangerouslySetInnerHTML={{ __html: thumbs.get(shot.id) as string }} />
                      ) : (
                        <div className="flex aspect-video items-center justify-center bg-neutral-100 text-xs text-neutral-400">No preview</div>
                      )}
                    </div>
                    <div className="mt-2 flex items-start justify-between gap-2">
                      <p className="text-sm leading-snug">
                        <span className="font-semibold">#{i + 1}</span> {shot.text}
                        {shot.ofParts === 2 && <span className="ml-1 text-xs text-neutral-500">(part {shot.part}/2)</span>}
                      </p>
                      <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs">{shot.durationSec.toFixed(1)}s</span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                      {shot.scene.cutaway ? `Cut-away: ${shot.scene.cutaway}` : BACKGROUND_NAMES[shot.scene.background]}
                      {` · ${shot.scene.variant} · ${shot.scene.camera} · ${shot.scene.pose}`}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); moveShot(shot.id, -1); }}
                        disabled={i === 0}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40"
                      >
                        ↑ Up
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); moveShot(shot.id, 1); }}
                        disabled={i === board.shots.length - 1}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40"
                      >
                        ↓ Down
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deleteShot(shot.id); }}
                        className="ml-auto rounded border border-red-200 px-2 py-0.5 text-xs text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
