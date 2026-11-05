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
 * MP4 (WebCodecs), PNG sequence, storyboard JSON, or a
 * print-to-PDF storyboard.
 *
 * Quick wins (ChatGPT audit #4): shot numbering, duplicate, bulk
 * pose/expression, per-shot duration, aspect ratios, storyboard
 * PDF (print), autosave indicator, keyboard shortcuts, undo/redo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
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
import {
  buildNarrationTimeline,
  DEFAULT_VOICE,
  loadVoice,
  pcmToWav,
  retimeBoard,
  synthesizeLine,
  VOICE_OPTIONS,
  VoiceError,
  type VoiceClip,
  type VoiceId,
  type VoiceProgress,
} from "@/lib/voice";
import {
  aspectRatioToSize,
  exportStoryboardMp4,
  isAudioExportSupported,
  isMp4ExportSupported,
  Mp4UnsupportedError,
  type AspectRatio,
  type Mp4Progress,
} from "@/lib/export-mp4";
import { downloadBlob, svgToPng } from "@/lib/export-image";
import { History } from "@/lib/history";

const STORAGE_KEY = "character-studio:story:script:v1";
const SHOTS_KEY = "character-studio:story:shots:v1";

const SAMPLE_SCRIPT = `THE FIRST NIGHT
Ancient humans did not sleep the way we do today.
They gathered around the fire at night and told stories while the stars came out.
The winter snow buried the camp, but inside the igloo the fire kept them warm.
Below the surface, layers of soil tell the story of everyone who lived here before us.
When morning came, they walked across the plain, following the horse herds for miles.
A king rose in the city, and everything changed.`;

/** Per-shot duration limits (seconds). */
const MIN_DURATION_SEC = 0.5;
const MAX_DURATION_SEC = 30;

type SaveStatus = "idle" | "saving" | "saved" | "offline";

/** Recompute total runtime + pacing after any shot-list change. */
function retotal(b: Storyboard): Storyboard {
  const totalSec = b.shots.reduce((s, x) => s + x.durationSec, 0);
  return {
    ...b,
    totalSec,
    shotsPerMinute: totalSec > 0 ? (b.shots.length / totalSec) * 60 : 0,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
  // Voice (Kokoro in-browser TTS): one clip per script line, keyed
  // by the first shot id of the line. The timeline is built from
  // these clips — every shot lasts exactly as long as its narration.
  const [voice, setVoice] = useState<VoiceId>(DEFAULT_VOICE);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState<VoiceProgress | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [clips, setClips] = useState<Map<string, VoiceClip>>(new Map());
  const [voiceApplied, setVoiceApplied] = useState(false);
  const [playingLine, setPlayingLine] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // MP4 export.
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<Mp4Progress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioTimelineRef = useRef<{ samples: Float32Array; sampleRate: number } | null>(null);
  // Quick wins: undo/redo, aspect, selection, zoom, autosave.
  const historyRef = useRef<History<Storyboard> | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [aspect, setAspect] = useState<AspectRatio>("16:9");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [bulkPose, setBulkPose] = useState<PoseName>("stand");
  const [bulkExpression, setBulkExpression] = useState<FaceName>("neutral");
  const [zoom, setZoom] = useState(1);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const syncHistoryButtons = useCallback(() => {
    const h = historyRef.current;
    setCanUndo(h ? h.canUndo : false);
    setCanRedo(h ? h.canRedo : false);
  }, []);

  /** Write the board to state + localStorage (no history entry). */
  const writeBoard = useCallback((b: Storyboard) => {
    boardRef.current = b;
    setBoard(b);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSaveStatus("offline");
    } else {
      setSaveStatus("saving");
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        setSaveStatus("saved");
        setSavedAt(new Date().toLocaleTimeString("en-GB"));
      }, 400);
    }
    try {
      window.localStorage.setItem(SHOTS_KEY, JSON.stringify(b));
    } catch {
      // Non-fatal.
    }
  }, []);

  /** Record a board edit (undoable) and persist it. */
  const commitBoard = useCallback(
    (b: Storyboard) => {
      historyRef.current?.push(b);
      syncHistoryButtons();
      writeBoard(b);
    },
    [syncHistoryButtons, writeBoard],
  );

  const undo = useCallback(() => {
    const prev = historyRef.current?.undo();
    if (!prev) return;
    syncHistoryButtons();
    writeBoard(prev);
    if (selectedId && !prev.shots.some((s) => s.id === selectedId)) {
      setSelectedId(prev.shots[0]?.id ?? null);
    }
    setCheckedIds((ids) => ids.filter((id) => prev.shots.some((s) => s.id === id)));
  }, [selectedId, syncHistoryButtons, writeBoard]);

  const redo = useCallback(() => {
    const next = historyRef.current?.redo();
    if (!next) return;
    syncHistoryButtons();
    writeBoard(next);
    if (selectedId && !next.shots.some((s) => s.id === selectedId)) {
      setSelectedId(next.shots[0]?.id ?? null);
    }
    setCheckedIds((ids) => ids.filter((id) => next.shots.some((s) => s.id === id)));
  }, [selectedId, syncHistoryButtons, writeBoard]);

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
          historyRef.current = new History(b);
          boardRef.current = b;
          setBoard(b);
        }
      }
    } catch {
      // Corrupt saved storyboard: start fresh, never crash.
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) setSaveStatus("offline");
    setMounted(true);
  }, []);

  // Autosave indicator: track connectivity.
  useEffect(() => {
    const goOffline = () => setSaveStatus("offline");
    const goOnline = () => setSaveStatus(savedAt ? "saved" : "idle");
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [savedAt]);

  const castMap = useMemo(() => new Map(cast.map((c) => [c.id, c])), [cast]);
  const castIds = useMemo(() => cast.map((c) => c.id), [cast]);

  const build = useCallback(() => {
    if (script.trim().length === 0) {
      setNotice("Paste a script first — or load the sample.");
      return;
    }
    const b = buildStoryboard(script, castIds);
    historyRef.current = new History(b);
    syncHistoryButtons();
    boardRef.current = b;
    setBoard(b);
    setSelectedId(b.shots[0]?.id ?? null);
    setCheckedIds([]);
    // A new script invalidates the old narration.
    setClips(new Map());
    setVoiceApplied(false);
    audioTimelineRef.current = null;
    try {
      window.localStorage.setItem(STORAGE_KEY, script);
      window.localStorage.setItem(SHOTS_KEY, JSON.stringify(b));
    } catch {
      // Storage full/unavailable: the board still works in memory.
    }
    setNotice(
      `${b.lineCount} lines → ${b.shots.length} shots, ${formatDuration(b.totalSec)} total, ~${Math.round(b.shotsPerMinute)} shots/min.`,
    );
  }, [script, castIds, syncHistoryButtons]);

  const updateShot = useCallback(
    (id: string, patch: Partial<Shot["scene"]>) => {
      const b = boardRef.current;
      if (!b) return;
      const shots = b.shots.map((s) => (s.id === id ? { ...s, scene: { ...s.scene, ...patch } } : s));
      commitBoard({ ...b, shots });
    },
    [commitBoard],
  );

  const updateDuration = useCallback(
    (id: string, secs: number) => {
      const b = boardRef.current;
      if (!b) return;
      const clamped = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, secs));
      const shots = b.shots.map((s) => (s.id === id ? { ...s, durationSec: clamped } : s));
      commitBoard(retotal({ ...b, shots }));
    },
    [commitBoard],
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
      commitBoard(retotal({ ...b, shots }));
    },
    [commitBoard],
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
      commitBoard({ ...b, shots });
      setDragId(null);
    },
    [dragId, commitBoard],
  );

  const deleteShot = useCallback(
    (id: string) => {
      const b = boardRef.current;
      if (!b) return;
      const shots = b.shots.filter((s) => s.id !== id);
      commitBoard(retotal({ ...b, shots }));
      if (selectedId === id) setSelectedId(shots[0]?.id ?? null);
      setCheckedIds((ids) => ids.filter((x) => x !== id));
    },
    [commitBoard, selectedId],
  );

  /** Duplicate a shot: copy inserted right after the original, new id. */
  const duplicateShot = useCallback(
    (id: string) => {
      const b = boardRef.current;
      if (!b) return;
      const idx = b.shots.findIndex((s) => s.id === id);
      if (idx < 0) return;
      const src = b.shots[idx];
      const copy: Shot = {
        ...src,
        id: `${src.id}-copy-${Math.random().toString(36).slice(2, 8)}`,
        scene: { ...src.scene, props: src.scene.props.map((p) => ({ ...p })), textCard: src.scene.textCard ? { ...src.scene.textCard } : null },
      };
      const shots = [...b.shots];
      shots.splice(idx + 1, 0, copy);
      commitBoard(retotal({ ...b, shots }));
      setSelectedId(copy.id);
    },
    [commitBoard],
  );

  /** Apply a pose/expression to every checked shot. */
  const applyBulk = useCallback(
    (patch: Partial<Shot["scene"]>) => {
      const b = boardRef.current;
      if (!b || checkedIds.length === 0) return;
      const wanted = new Set(checkedIds);
      const shots = b.shots.map((s) => (wanted.has(s.id) ? { ...s, scene: { ...s.scene, ...patch } } : s));
      commitBoard({ ...b, shots });
    },
    [checkedIds, commitBoard],
  );

  const toggleChecked = useCallback((id: string) => {
    setCheckedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }, []);

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        if (selectedId) duplicateShot(selectedId);
        return;
      }
      if (mod && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((mod && e.key === "Z" && e.shiftKey) || (mod && (e.key === "y" || e.key === "Y"))) {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteShot(selectedId);
        return;
      }
      if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(2, Math.round((z + 0.25) * 100) / 100));
        return;
      }
      if (e.key === "-") {
        setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, duplicateShot, deleteShot, undo, redo]);

  const selected = board?.shots.find((s) => s.id === selectedId) ?? null;
  const selectedIndex = board && selected ? board.shots.findIndex((s) => s.id === selected.id) : -1;

  /** Thumbnail render size for the current aspect (max side 640px). */
  const thumbSize = useMemo(() => {
    const full = aspectRatioToSize(aspect);
    const scale = 640 / Math.max(full.width, full.height);
    return { width: Math.round(full.width * scale), height: Math.round(full.height * scale) };
  }, [aspect]);

  const thumbs = useMemo(() => {
    if (!board) return new Map<string, string>();
    const out = new Map<string, string>();
    try {
      for (const shot of board.shots) {
        const scene = shotToScene(shot, 7);
        const { svg } = renderScene(scene, castMap, { width: thumbSize.width, height: thumbSize.height });
        out.set(shot.id, svg);
      }
      setRenderError(null);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : "unknown error");
    }
    return out;
  }, [board, castMap, thumbSize]);

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

  /** Print-ready storyboard window — the user saves it as PDF from the browser. */
  const exportStoryboardPdf = useCallback(() => {
    const b = boardRef.current;
    if (!b) return;
    const size = aspectRatioToSize(aspect);
    const rows = b.shots
      .map((s, i) => {
        const sceneSummary = s.scene.cutaway
          ? `Cut-away: ${s.scene.cutaway}`
          : `${BACKGROUND_NAMES[s.scene.background]} · ${s.scene.variant} · ${s.scene.camera}`;
        return `<tr><td>${i + 1}</td><td>${escapeHtml(s.text)}</td><td>${escapeHtml(sceneSummary)}</td><td>${escapeHtml(s.scene.pose)} / ${escapeHtml(s.scene.expression)}</td><td>${s.durationSec.toFixed(1)}s</td></tr>`;
      })
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Storyboard — Character Studio</title><style>
      body { font-family: system-ui, sans-serif; color: #111; margin: 24px; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      p.meta { color: #555; font-size: 13px; margin: 0 0 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f0f0f0; }
      @media print { body { margin: 0; } }
    </style></head><body>
      <h1>Storyboard — Character Studio</h1>
      <p class="meta">${b.shots.length} shots · ${formatDuration(b.totalSec)} total · ${aspect} (${size.width}×${size.height}) · ${new Date().toLocaleDateString()}</p>
      <table><thead><tr><th>#</th><th>Narration</th><th>Scene</th><th>Pose / Expression</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table>
      <script>window.onload = function () { window.print(); };</script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) {
      setNotice("Allow pop-ups to open the print-ready storyboard, then save it as PDF.");
      return;
    }
    w.document.write(html);
    w.document.close();
  }, [aspect]);

  /** Group shots back into script lines (part 1 + part 2 pairs). */
  const lineGroups = useCallback((b: Storyboard): Array<{ first: Shot; second: Shot | null }> => {
    const groups: Array<{ first: Shot; second: Shot | null }> = [];
    let i = 0;
    while (i < b.shots.length) {
      const first = b.shots[i];
      const second = first.ofParts === 2 && b.shots[i + 1] ? b.shots[i + 1] : null;
      groups.push({ first, second });
      i += second ? 2 : 1;
    }
    return groups;
  }, []);

  /** Generate narration with Kokoro (free, in-browser) and re-time the board to the real audio. */
  const generateNarration = useCallback(async () => {
    const b = boardRef.current;
    if (!b) return;
    setVoiceBusy(true);
    setVoiceError(null);
    setVoiceProgress({ stage: "loading-model", percent: 0, note: "Starting…" });
    try {
      const tts = await loadVoice(setVoiceProgress);
      const groups = lineGroups(b).filter((g) => !g.first.scene.textCard);
      const newClips = new Map<string, VoiceClip>();
      let done = 0;
      for (const g of groups) {
        const text = g.second ? `${g.first.text} ${g.second.text}` : g.first.text;
        setVoiceProgress({
          stage: "synthesizing",
          percent: Math.round((done / Math.max(1, groups.length)) * 100),
          note: `Speaking line ${done + 1} of ${groups.length}…`,
        });
        const clip = await synthesizeLine(tts, text, voice, g.first.id);
        newClips.set(g.first.id, clip);
        done += 1;
      }
      const { samples, durations } = buildNarrationTimeline(b, newClips);
      const retimed = retimeBoard(b, durations);
      audioTimelineRef.current = { samples, sampleRate: 24000 };
      setClips(newClips);
      commitBoard(retimed);
      setVoiceApplied(true);
      setNotice(
        `Narration ready — ${groups.length} lines spoken, runtime now ${formatDuration(retimed.totalSec)} (real voice timing, not the 150 wpm estimate). Each shot now lasts exactly as long as its narration.`,
      );
    } catch (err) {
      setVoiceError(
        err instanceof VoiceError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Voice generation failed.",
      );
    } finally {
      setVoiceBusy(false);
      setVoiceProgress(null);
    }
  }, [lineGroups, commitBoard, voice]);

  /** Replay one line's narration (WAV, in the browser). */
  const playLine = useCallback(
    (lineFirstShotId: string) => {
      const clip = clips.get(lineFirstShotId);
      if (!clip) return;
      if (audioRef.current) audioRef.current.pause();
      const blob = pcmToWav(clip.samples, clip.sampleRate);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingLine(lineFirstShotId);
      audio.onended = () => {
        setPlayingLine(null);
        URL.revokeObjectURL(url);
      };
      void audio.play().catch(() => setPlayingLine(null));
    },
    [clips],
  );

  /** Full pipeline: shots (+ narration when available) → MP4 download. */
  const exportVideo = useCallback(
    async (withAudio: boolean) => {
      const b = boardRef.current;
      if (!b) return;
      if (!isMp4ExportSupported()) {
        setExportError(
          "This browser cannot encode video (WebCodecs is unavailable). Download the PNG stills instead — they are the same frames.",
        );
        return;
      }
      setExportBusy(true);
      setExportError(null);
      setExportDone(null);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const audio =
          withAudio && audioTimelineRef.current
            ? { samples: audioTimelineRef.current.samples, sampleRate: audioTimelineRef.current.sampleRate }
            : undefined;
        const { blob, audioIncluded } = await exportStoryboardMp4(b, castMap, {
          size: aspectRatioToSize(aspect),
          audio,
          onProgress: setExportProgress,
          signal: controller.signal,
        });
        downloadBlob(blob, "character-studio-video.mp4");
        setExportDone(
          audioIncluded
            ? `Video downloaded — ${formatDuration(b.totalSec)}, with narration.`
            : `Video downloaded — ${formatDuration(b.totalSec)}. No audio track: this browser cannot encode AAC, so the video is silent.`,
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") setExportError("Export cancelled.");
        else if (err instanceof Mp4UnsupportedError) setExportError(err.message);
        else setExportError(err instanceof Error ? err.message : "Export failed.");
      } finally {
        setExportBusy(false);
        setExportProgress(null);
        abortRef.current = null;
      }
    },
    [castMap, aspect],
  );

  /** Fallback: every shot as a PNG still (the same frames as the video). */
  const downloadStills = useCallback(async () => {
    const b = boardRef.current;
    if (!b) return;
    setExportBusy(true);
    setExportError(null);
    setExportDone(null);
    try {
      const { width, height } = aspectRatioToSize(aspect);
      for (let i = 0; i < b.shots.length; i++) {
        const shot = b.shots[i];
        const scene = shotToScene(shot, 7);
        const { svg } = renderScene(scene, castMap, { width, height });
        const blob = await svgToPng(svg, width, height);
        downloadBlob(blob, `shot-${String(i + 1).padStart(2, "0")}.png`);
        await new Promise((r) => setTimeout(r, 300));
      }
      setExportDone(`${b.shots.length} stills downloaded as PNG (${width}×${height}).`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "The stills could not be made.");
    } finally {
      setExportBusy(false);
    }
  }, [castMap, aspect]);

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
      <AppShell active="storyboards">
        <div className="flex min-h-64 items-center justify-center text-neutral-500">
          Loading the storyboard…
        </div>
      </AppShell>
    );
  }

  const exportSize = aspectRatioToSize(aspect);

  return (
    <AppShell active="storyboards">
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
                <div className="flex justify-between"><dt className="text-neutral-500">Total runtime</dt><dd className="font-medium">{formatDuration(board.totalSec)}{voiceApplied ? " · voice-timed ✓" : " · 150 wpm estimate"}</dd></div>
                <div className="flex justify-between"><dt className="text-neutral-500">Pacing</dt><dd className="font-medium">~{Math.round(board.shotsPerMinute)} shots/min</dd></div>
                <div className="flex justify-between"><dt className="text-neutral-500">Format</dt><dd className="font-medium">Stills + hard cuts · {aspect} ({exportSize.width}×{exportSize.height})</dd></div>
                <div className="flex justify-between">
                  <dt className="text-neutral-500">Autosave</dt>
                  <dd className="font-medium">
                    {saveStatus === "saving" && "Saving…"}
                    {saveStatus === "saved" && savedAt ? `Saved ${savedAt}` : saveStatus === "saved" ? "Saved" : ""}
                    {saveStatus === "offline" && "Offline — changes saved locally"}
                    {saveStatus === "idle" && "—"}
                  </dd>
                </div>
              </dl>

              <label className="mt-3 block">
                <span className="text-xs text-neutral-500">Aspect ratio (stills, PNG sequence &amp; MP4)</span>
                <select
                  value={aspect}
                  onChange={(e) => setAspect(e.target.value as AspectRatio)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                >
                  <option value="16:9">16:9 — landscape (1920×1080)</option>
                  <option value="9:16">9:16 — vertical / Shorts (1080×1920)</option>
                  <option value="1:1">1:1 — square (1080×1080)</option>
                </select>
              </label>

              {/* Voice */}
              <div className="mt-4 border-t border-neutral-100 pt-3">
                <h3 className="text-sm font-semibold">Narration — free voice, in your browser</h3>
                <label className="mt-2 block">
                  <span className="text-xs text-neutral-500">Voice</span>
                  <select
                    value={voice}
                    onChange={(e) => setVoice(e.target.value as VoiceId)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  >
                    {VOICE_OPTIONS.map((v) => (
                      <option key={v.id} value={v.id}>{v.name} — {v.gender} · {v.note}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={generateNarration}
                  disabled={voiceBusy}
                  className="mt-2 w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                >
                  {voiceBusy ? "Working…" : voiceApplied ? "Regenerate narration" : "Generate narration"}
                </button>
                {voiceProgress && (
                  <div className="mt-2">
                    <p className="text-xs text-neutral-600">{voiceProgress.note}</p>
                    {voiceProgress.percent >= 0 && (
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                        <div className="h-full bg-neutral-900 transition-all" style={{ width: `${voiceProgress.percent}%` }} />
                      </div>
                    )}
                    <p className="mt-1 text-xs text-neutral-500">First time only: the voice model (~86 MB) downloads once, then it works offline.</p>
                  </div>
                )}
                {voiceError && (
                  <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-900">{voiceError}</p>
                )}
                {voiceApplied && (
                  <p className="mt-2 text-xs leading-relaxed text-neutral-600">
                    Narration is on — every shot lasts exactly as long as its voice clip. Replay any line from its
                    shot card below.
                  </p>
                )}
              </div>

              {/* Export */}
              <div className="mt-4 border-t border-neutral-100 pt-3">
                <h3 className="text-sm font-semibold">Export</h3>
                <button
                  type="button"
                  onClick={() => exportVideo(true)}
                  disabled={exportBusy}
                  className="mt-2 w-full rounded-md bg-neutral-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                >
                  {exportBusy ? "Exporting…" : "🎬 Generate video (MP4)"}
                </button>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                  {voiceApplied
                    ? "One click: every shot held for its narration, with the voice track included. Silent-ready if the voice is off."
                    : "Tip: generate narration first — then each shot lasts exactly as long as its voice. Without it, the video uses the 150 wpm timing and is silent."}
                  {!isAudioExportSupported() && " This browser cannot encode an AAC audio track, so exports will be silent."}
                </p>
                {exportProgress && (
                  <div className="mt-2">
                    <p className="text-xs text-neutral-600">{exportProgress.stage} ({exportProgress.done}/{exportProgress.total})</p>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                      <div className="h-full bg-neutral-900 transition-all" style={{ width: `${Math.round((exportProgress.done / Math.max(1, exportProgress.total)) * 100)}%` }} />
                    </div>
                  </div>
                )}
                {exportBusy && (
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    className="mt-2 w-full rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700"
                  >
                    Cancel export
                  </button>
                )}
                {exportError && (
                  <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-900">{exportError}</p>
                )}
                {exportDone && (
                  <p className="mt-2 rounded-md border border-green-300 bg-green-50 px-2 py-1.5 text-xs text-green-900">{exportDone}</p>
                )}
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={downloadStills} disabled={exportBusy} className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 disabled:opacity-50">
                    PNG sequence
                  </button>
                  <button type="button" onClick={downloadJson} className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">
                    Storyboard JSON
                  </button>
                </div>
                <button
                  type="button"
                  onClick={exportStoryboardPdf}
                  className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
                >
                  Storyboard PDF (print to PDF)
                </button>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                  Opens a print-ready storyboard — save it as PDF from your browser&apos;s print dialog.
                </p>
              </div>
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
                <label className="block">
                  <span className="text-xs text-neutral-500">Duration (seconds, {MIN_DURATION_SEC}–{MAX_DURATION_SEC})</span>
                  <input
                    type="number"
                    min={MIN_DURATION_SEC}
                    max={MAX_DURATION_SEC}
                    step={0.5}
                    value={selected.durationSec}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isNaN(v)) updateDuration(selected.id, v);
                    }}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
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
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={undo}
                    disabled={!canUndo}
                    title="Undo (Ctrl+Z)"
                    className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40"
                  >
                    ↩ Undo
                  </button>
                  <button
                    type="button"
                    onClick={redo}
                    disabled={!canRedo}
                    title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
                    className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40"
                  >
                    ↪ Redo
                  </button>
                  <span className="flex items-center gap-1 text-xs text-neutral-600">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
                      className="rounded border border-neutral-300 px-2 py-1"
                      aria-label="Zoom out (−)"
                    >
                      −
                    </button>
                    <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.25) * 100) / 100))}
                      className="rounded border border-neutral-300 px-2 py-1"
                      aria-label="Zoom in (+)"
                    >
                      +
                    </button>
                  </span>
                </div>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                Drag cards to reorder · click a card to edit its scene · Ctrl/Cmd+D duplicate · Delete removes the selected shot · +/− zoom
              </p>
              {checkedIds.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm">
                  <span className="font-medium">{checkedIds.length} selected</span>
                  <label className="flex items-center gap-1 text-xs">
                    <span>Pose</span>
                    <select
                      value={bulkPose}
                      onChange={(e) => setBulkPose(e.target.value as PoseName)}
                      className="rounded border border-neutral-300 px-1.5 py-1 text-sm"
                    >
                      {POSE_NAMES.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => applyBulk({ pose: bulkPose })}
                    className="rounded-md bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-700"
                  >
                    Apply pose
                  </button>
                  <label className="flex items-center gap-1 text-xs">
                    <span>Expression</span>
                    <select
                      value={bulkExpression}
                      onChange={(e) => setBulkExpression(e.target.value as FaceName)}
                      className="rounded border border-neutral-300 px-1.5 py-1 text-sm"
                    >
                      {FACE_NAMES.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => applyBulk({ expression: bulkExpression })}
                    className="rounded-md bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-700"
                  >
                    Apply expression
                  </button>
                  <button
                    type="button"
                    onClick={() => setCheckedIds([])}
                    className="ml-auto rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
                  >
                    Clear selection
                  </button>
                </div>
              )}
              {renderError && (
                <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
                  A thumbnail could not be rendered: {renderError}
                </div>
              )}
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" style={{ zoom }}>
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
                        <input
                          type="checkbox"
                          checked={checkedIds.includes(shot.id)}
                          onChange={() => toggleChecked(shot.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select shot ${i + 1}`}
                          className="mr-1 align-middle"
                        />
                        <span className="font-semibold">#{i + 1}</span> {shot.text}
                        {shot.ofParts === 2 && <span className="ml-1 text-xs text-neutral-500">(part {shot.part}/2)</span>}
                      </p>
                      <label
                        className="flex shrink-0 items-center gap-0.5 rounded bg-neutral-100 px-1.5 py-0.5 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="number"
                          min={MIN_DURATION_SEC}
                          max={MAX_DURATION_SEC}
                          step={0.5}
                          value={shot.durationSec}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) updateDuration(shot.id, v);
                          }}
                          aria-label={`Duration of shot ${i + 1} in seconds`}
                          className="w-12 bg-transparent text-right text-xs outline-none"
                        />
                        <span>s</span>
                      </label>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                      {shot.scene.cutaway ? `Cut-away: ${shot.scene.cutaway}` : BACKGROUND_NAMES[shot.scene.background]}
                      {` · ${shot.scene.variant} · ${shot.scene.camera} · ${shot.scene.pose} · ${shot.scene.expression}`}
                    </p>
                    {(shot.scene as { reason?: string }).reason && (
                      <p className="mt-1 text-xs leading-snug text-neutral-600">
                        Why this scene: {(shot.scene as { reason?: string }).reason}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {shot.part === 1 && clips.has(shot.id) && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); playLine(shot.id); }}
                          className="rounded border border-neutral-300 px-2 py-0.5 text-xs"
                        >
                          {playingLine === shot.id ? "▶ Playing…" : "▶ Replay line"}
                        </button>
                      )}
                      <a
                        href={`/thumbs?character=${encodeURIComponent(shot.scene.characterId ?? "")}&title=${encodeURIComponent(shot.text.split(/\s+/).slice(0, 3).join(" "))}&bg=${encodeURIComponent(shot.scene.background)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100"
                      >
                        Make thumbnail →
                      </a>
                    </div>
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
                        onClick={(e) => { e.stopPropagation(); duplicateShot(shot.id); }}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs"
                      >
                        Duplicate
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
    </AppShell>
  );
}
