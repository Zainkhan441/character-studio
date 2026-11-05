"use client";

/**
 * Character Creator — /creator
 *
 * Live parametric character preview (SVG renderer ported from the
 * reference Python engine) + side controls. Autosaves to localStorage
 * on every change, so closing the browser never loses work.
 *
 * M1 features:
 * - Canvas fills the viewport (100dvh minus header); the auto-fit
 *   viewBox is snug (~10% padding) so the character fills ~70%+ of
 *   the preview instead of ~30%.
 * - Undo/redo (Ctrl+Z / Ctrl+Shift+Z) via a capped History stack.
 * - Visual pose editor: drag the blue dots on the canvas to move
 *   arms and legs (two-bone IK); release to commit; save as a named
 *   custom pose and reuse it forever.
 * - Wardrobe slots (headwear / top / bottom / footwear / accessory /
 *   prop) + one-click era packs (Modern / Medieval / Stone Age).
 * - Family generator: one click creates a female / child / elder
 *   variant and adds it to the cast.
 * - Save to cast; open a cast member via ?cast=<id>.
 *
 * Quality notes:
 * - Render is synchronous and measured on every change; the time is
 *   shown live against the <16ms preview budget.
 * - Any render failure is caught and shown as an error state instead
 *   of a blank page (never fail silently).
 * - localStorage data is validated with the Zod schema before use;
 *   corrupt data falls back to the default character with a warning.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CREATOR_EXPRESSIONS,
  CREATOR_POSES,
  ERA_PACKS,
  FACE_NAMES,
  HAIR_COLORS,
  HAIR_STYLES,
  HAT_NAMES,
  OUTFIT_NAMES,
  POSES,
  POSE_NAMES,
  PROP_NAMES,
  defaultCharacter,
  validateCharacter,
  type Character,
  type EraPack,
  type FaceName,
  type HairColorName,
  type HairStyle,
  type HatName,
  type OutfitName,
  type PoseName,
  type PropName,
} from "@/lib/character";
import { loadCast, saveCast, upsertCast } from "@/lib/cast";
import {
  loadCustomPoses,
  removeCustomPose,
  saveCustomPoses,
  upsertCustomPose,
  type CustomPose,
} from "@/lib/custom-poses";
import { makeFamilyVariant, type FamilyKind } from "@/lib/family";
import { History } from "@/lib/history";
import { measureCharacterViewBox } from "@/lib/fit-viewbox";
import {
  characterJoints,
  computeSkeleton,
  jointsToCharacterSpace,
  limbAnglesForPoint,
  renderCharacterTimed,
} from "@/lib/renderer";

const STORAGE_KEY = "character-studio:creator:character:v1";
const DEFAULT_VIEWBOX = "-4.5 -9.5 9 10.5";

const PREVIEW_BG_LIGHT = "#f5f3ef";
const PREVIEW_BG_DARK = "#171412";

/** Format a viewBox number to 2 decimals (stable string comparison). */
function fmt2(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function loadSavedCharacter(): { character: Character; notice: string | null } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { character: defaultCharacter(), notice: null };
    const parsed: unknown = JSON.parse(raw);
    const result = validateCharacter(parsed);
    if (result.ok) return { character: result.character, notice: "Saved character restored." };
    return { character: defaultCharacter(), notice: `Saved data was invalid (${result.error}) — started fresh.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return { character: defaultCharacter(), notice: `Could not read saved character (${message}) — started fresh.` };
  }
}

type DragLimb = "frontArm" | "backArm" | "frontLeg" | "backLeg";

export default function CreatorPage() {
  const [mounted, setMounted] = useState(false);
  const [character, setCharacter] = useState<Character>(() => defaultCharacter());
  const [notice, setNotice] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [poseEdit, setPoseEdit] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [histState, setHistState] = useState({ canUndo: false, canRedo: false });
  const [customPoses, setCustomPoses] = useState<CustomPose[]>([]);
  const [poseName, setPoseName] = useState("My pose");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<History<Character> | null>(null);
  const characterRef = useRef<Character>(character);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    limb: DragLimb;
    startChar: Character;
  } | null>(null);

  const refreshHistState = useCallback(() => {
    const h = historyRef.current;
    setHistState({ canUndo: h?.canUndo ?? false, canRedo: h?.canRedo ?? false });
  }, []);

  // Load once on mount (client-only: localStorage does not exist on server).
  // ?cast=<id> opens a cast member instead of the saved character.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const castId = params.get("cast");
    if (castId) {
      const { cast } = loadCast();
      const found = cast.find((c) => c.id === castId);
      if (found) {
        setCharacter(found);
        characterRef.current = found;
        historyRef.current = new History<Character>(found);
        setNotice(`Loaded ${found.name} from your cast.`);
        setMounted(true);
        refreshHistState();
        return;
      }
      setNotice("That cast member was not found — opened your saved character.");
    }
    const { character: saved, notice: loadNotice } = loadSavedCharacter();
    setCharacter(saved);
    characterRef.current = saved;
    historyRef.current = new History<Character>(saved);
    if (loadNotice) setNotice(loadNotice);
    setCustomPoses(loadCustomPoses().poses);
    setMounted(true);
    refreshHistState();
  }, [refreshHistState]);

  // Autosave (debounced 300ms) on every change after mount.
  useEffect(() => {
    if (!mounted) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(character));
        setSavedAt(new Date().toLocaleTimeString());
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        setNotice(`Autosave failed (${message}). Your changes are still on screen.`);
      }
    }, 300);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [character, mounted]);

  /** Record a discrete change in history and apply it. */
  const commit = useCallback(
    (next: Character) => {
      historyRef.current?.push(next);
      characterRef.current = next;
      setCharacter(next);
      setRenderError(null);
      refreshHistState();
    },
    [refreshHistState],
  );

  /** Apply a live change (slider drag, pose-editor drag, typing) without a history entry. */
  const setLive = useCallback((next: Character) => {
    characterRef.current = next;
    setCharacter(next);
    setRenderError(null);
  }, []);

  /** Push the current (live-edited) state into history — call on release/blur. */
  const commitCurrent = useCallback(() => {
    historyRef.current?.push(characterRef.current);
    refreshHistState();
  }, [refreshHistState]);

  const undo = useCallback(() => {
    const prev = historyRef.current?.undo();
    if (prev !== null && prev !== undefined) {
      characterRef.current = prev;
      setCharacter(prev);
      refreshHistState();
    }
  }, [refreshHistState]);

  const redo = useCallback(() => {
    const next = historyRef.current?.redo();
    if (next !== null && next !== undefined) {
      characterRef.current = next;
      setCharacter(next);
      refreshHistState();
    }
  }, [refreshHistState]);

  // Keyboard shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y redo, Esc exits the pose editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;
      if (e.key === "Escape" && poseEdit) {
        setPoseEdit(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !inField) {
        if ((e.key === "z" || e.key === "Z") && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((e.key === "Z" && e.shiftKey) || e.key === "y" || e.key === "Y") {
          e.preventDefault();
          redo();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, poseEdit]);

  const update = useCallback(
    (patch: Partial<Character>) => {
      commit({ ...characterRef.current, ...patch });
    },
    [commit],
  );

  const updateLive = useCallback(
    (patch: Partial<Character>) => {
      setLive({ ...characterRef.current, ...patch });
    },
    [setLive],
  );

  const updateFace = useCallback(
    (patch: Partial<Character["face"]>) => {
      const c = characterRef.current;
      commit({ ...c, face: { ...c.face, ...patch } });
    },
    [commit],
  );

  const updateFaceLive = useCallback(
    (patch: Partial<Character["face"]>) => {
      const c = characterRef.current;
      setLive({ ...c, face: { ...c.face, ...patch } });
    },
    [setLive],
  );

  const updateHair = useCallback(
    (patch: Partial<Character["hair"]>) => {
      const c = characterRef.current;
      commit({ ...c, hair: { ...c.hair, ...patch } });
    },
    [commit],
  );

  const updateOutfit = useCallback(
    (patch: Partial<Character["outfit"]>) => {
      const c = characterRef.current;
      commit({ ...c, outfit: { ...c.outfit, ...patch } });
    },
    [commit],
  );

  const updateStyleLive = useCallback(
    (patch: Partial<Character["style"]>) => {
      const c = characterRef.current;
      setLive({ ...c, style: { ...c.style, ...patch } });
    },
    [setLive],
  );

  const setPose = useCallback(
    (pose: PoseName) => {
      // Switching pose clears limb overrides — a dragged arm from
      // "stand" must not leak into "wave".
      const c = characterRef.current;
      commit({ ...c, pose, backArm: null, frontArm: null, backLeg: null, frontLeg: null });
    },
    [commit],
  );

  const render = useMemo(() => {
    if (!mounted) return { svg: "", ms: 0 };
    try {
      return renderCharacterTimed(character, {
        background: dark ? PREVIEW_BG_DARK : PREVIEW_BG_LIGHT,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown render error";
      // setState during render is not allowed; defer via queueMicrotask.
      queueMicrotask(() => setRenderError(message));
      return { svg: "", ms: 0 };
    }
  }, [character, dark, mounted]);

  /**
   * Auto-fit the preview frame. Measured from the rendered character
   * (see measureCharacterViewBox): the frame hugs the figure with
   * ~0.35 units (~10%) padding, so the character fills ~70%+ of the
   * preview instead of ~50% of the loose default frame. A minimum
   * frame (3.2 x 5.4) keeps small characters (child scale) from
   * zooming in too far. Frozen while a pose-editor drag is in
   * progress, so the canvas never rescales under the pointer; refits
   * once the drag ends.
   */
  const previewRef = useRef<HTMLDivElement>(null);
  const [fittedViewBox, setFittedViewBox] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (dragging) return;
    const el = previewRef.current;
    if (!el) return;
    const vb = measureCharacterViewBox(el);
    if (vb) setFittedViewBox((prev) => (prev === vb ? prev : vb));
  }, [render.svg, dragging]);

  const previewSvg = useMemo(() => {
    if (!render.svg || !fittedViewBox) return render.svg;
    return render.svg.replace(/viewBox="[^"]*"/, `viewBox="${fittedViewBox}"`);
  }, [render.svg, fittedViewBox]);

  // Pose-editor drag handles (SVG user space, same viewBox as the preview).
  const joints = useMemo(() => {
    if (!mounted || !poseEdit) return null;
    try {
      return characterJoints(character);
    } catch {
      return null;
    }
  }, [character, mounted, poseEdit]);

  const startDrag = useCallback(
    (e: React.PointerEvent<SVGCircleElement>, limb: DragLimb) => {
      e.preventDefault();
      e.stopPropagation();
      const startChar = characterRef.current;
      dragRef.current = { limb, startChar };
      setDragging(true);
      (e.target as SVGCircleElement).setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current;
        const svg = overlayRef.current;
        if (!drag || !svg) return;
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
        const target = jointsToCharacterSpace(drag.startChar, [pt.x, pt.y]);
        const sk = computeSkeleton(drag.startChar);
        const c = characterRef.current;
        let next: Character | null = null;
        if (drag.limb === "frontArm" || drag.limb === "backArm") {
          const [a1, a2] = limbAnglesForPoint(sk.shoulder, c.proportions.upperArm, c.proportions.lowerArm, target, -1);
          next = drag.limb === "frontArm" ? { ...c, frontArm: [a1, a2] } : { ...c, backArm: [a1, a2] };
        } else {
          const [a1, a2] = limbAnglesForPoint(sk.hip, c.proportions.upperLeg, c.proportions.lowerLeg, target, 1);
          next = drag.limb === "frontLeg" ? { ...c, frontLeg: [a1, a2] } : { ...c, backLeg: [a1, a2] };
        }
        if (next) setLive(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        dragRef.current = null;
        setDragging(false);
        commitCurrent();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [commitCurrent, setLive],
  );

  const resetPose = useCallback(() => {
    const c = characterRef.current;
    commit({ ...c, backArm: null, frontArm: null, backLeg: null, frontLeg: null });
    setNotice("Pose overrides cleared — back to the base pose.");
  }, [commit]);

  const saveCurrentPose = useCallback(() => {
    const c = characterRef.current;
    const pose = POSES[c.pose];
    const p: CustomPose = {
      id: `pose-${Date.now()}`,
      name: poseName.trim() || "My pose",
      basePose: c.pose,
      // POSES angles are readonly tuples — copy them into mutable ones.
      backArm: [...(c.backArm ?? pose.backArm)] as [number, number],
      frontArm: [...(c.frontArm ?? pose.frontArm)] as [number, number],
      backLeg: [...(c.backLeg ?? pose.backLeg)] as [number, number],
      frontLeg: [...(c.frontLeg ?? pose.frontLeg)] as [number, number],
      createdAt: Date.now(),
    };
    const next = upsertCustomPose(customPoses, p);
    setCustomPoses(next);
    if (!saveCustomPoses(next)) setNotice(`Pose "${p.name}" saved in this session only — storage unavailable.`);
    else setNotice(`Pose "${p.name}" saved — reuse it anytime.`);
  }, [poseName, customPoses]);

  const applyCustomPose = useCallback(
    (p: CustomPose) => {
      const c = characterRef.current;
      commit({ ...c, pose: p.basePose, backArm: p.backArm, frontArm: p.frontArm, backLeg: p.backLeg, frontLeg: p.frontLeg });
      setNotice(`Applied pose "${p.name}".`);
    },
    [commit],
  );

  const deleteCustomPose = useCallback((id: string) => {
    setCustomPoses((prev) => {
      const next = removeCustomPose(prev, id);
      saveCustomPoses(next);
      return next;
    });
  }, []);

  const applyEraPack = useCallback(
    (pack: EraPack) => {
      const c = characterRef.current;
      commit({
        ...c,
        outfit: { ...c.outfit, outfit: pack.outfit, hat: pack.hat },
        hair: { ...c.hair, style: pack.hairStyle },
      });
      setNotice(`Dressed for the ${pack.name} era.`);
    },
    [commit],
  );

  const makeVariant = useCallback(
    (kind: FamilyKind) => {
      const v = makeFamilyVariant(characterRef.current, kind);
      commit(v);
      const { cast } = loadCast();
      saveCast(upsertCast(cast, v));
      setNotice(`${kind === "female" ? "Female" : kind === "child" ? "Child" : "Elder"} variant created and added to your cast.`);
    },
    [commit],
  );

  const saveToCast = useCallback(() => {
    const c = characterRef.current;
    const { cast } = loadCast();
    saveCast(upsertCast(cast, c));
    setNotice(`${c.name} saved to your cast.`);
  }, []);

  const downloadSvg = useCallback(() => {
    if (!previewSvg) return;
    try {
      const blob = new Blob([previewSvg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${character.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "character"}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      setNotice(`Download failed (${message}).`);
    }
  }, [previewSvg, character.name]);

  const copyJson = useCallback(() => {
    const json = JSON.stringify(character, null, 2);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(json).then(
        () => setNotice("Character JSON copied to clipboard."),
        () => setNotice("Copy failed — clipboard unavailable."),
      );
    } else {
      setNotice("Copy failed — clipboard unavailable in this browser.");
    }
  }, [character]);

  const reset = useCallback(() => {
    const fresh = defaultCharacter();
    commit(fresh);
    setNotice("Reset to the default character.");
  }, [commit]);

  if (!mounted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" />
          <p className="mt-4 text-sm text-neutral-600">Loading your character…</p>
        </div>
      </main>
    );
  }

  const overBudget = render.ms >= 16;
  const previewBg = dark ? PREVIEW_BG_DARK : PREVIEW_BG_LIGHT;
  const overlayViewBox = fittedViewBox ?? DEFAULT_VIEWBOX;

  const handles: Array<{ key: DragLimb; point: readonly [number, number] | null; label: string }> = joints
    ? [
        { key: "frontArm", point: joints.frontHand, label: "Front hand — drag to move the front arm" },
        { key: "backArm", point: joints.backHand, label: "Back hand — drag to move the back arm" },
        { key: "frontLeg", point: joints.frontFoot, label: "Front foot — drag to move the front leg" },
        { key: "backLeg", point: joints.backFoot, label: "Back foot — drag to move the back leg" },
      ]
    : [];

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-white text-neutral-900">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <a href="/" className="text-lg font-bold tracking-tight">
            Character Studio
          </a>
          <span className="hidden rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 sm:inline">
            Creator
          </span>
          <a href="/cast" className="hidden rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200 sm:inline">
            Cast →
          </a>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-neutral-500 md:inline" title="Autosave status">
            {savedAt ? `Autosaved ${savedAt}` : "Autosave on"}
          </span>
          <button
            type="button"
            onClick={undo}
            disabled={!histState.canUndo}
            title="Undo (Ctrl+Z)"
            className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40"
          >
            ↩ Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!histState.canRedo}
            title="Redo (Ctrl+Shift+Z)"
            className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40"
          >
            ↪ Redo
          </button>
          <button
            type="button"
            onClick={() => setPoseEdit((v) => !v)}
            aria-pressed={poseEdit}
            title="Drag the blue dots to move arms and legs"
            className={`rounded-md border px-3 py-1.5 text-sm ${poseEdit ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100"}`}
          >
            ✏️ Pose editor
          </button>
          <button
            type="button"
            onClick={() => setDark((d) => !d)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
            aria-label={dark ? "Switch to light preview" : "Switch to dark preview"}
          >
            {dark ? "☀ Light" : "🌙 Dark"}
          </button>
          <button
            type="button"
            onClick={downloadSvg}
            disabled={!render.svg}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            Download SVG
          </button>
        </div>
      </header>

      {notice && (
        <div className="flex shrink-0 items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 sm:px-6">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-bold" aria-label="Dismiss notice">
            ×
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Canvas — biggest area, fills the viewport */}
        <section className="relative flex min-h-0 flex-1 flex-col items-center justify-center" style={{ background: previewBg }}>
          {poseEdit && (
            <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-neutral-900 px-3 py-1 text-xs text-white shadow">
              Drag the blue dots to move arms and legs · Esc to exit
            </div>
          )}
          {renderError ? (
            <div className="max-w-md rounded-lg border border-red-300 bg-red-50 p-6 text-center" role="alert">
              <p className="font-semibold text-red-800">Couldn’t render this character</p>
              <p className="mt-2 break-words text-sm text-red-700">{renderError}</p>
              <button
                type="button"
                onClick={reset}
                className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-600"
              >
                Reset to default character
              </button>
            </div>
          ) : render.svg ? (
            <div className="relative h-full w-full">
              <div
                ref={previewRef}
                className="absolute inset-0 [&_svg]:h-full [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: previewSvg }}
              />
              {poseEdit && joints && (
                <svg
                  ref={overlayRef}
                  viewBox={overlayViewBox}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  aria-label="Pose editor handles"
                >
                  {handles.map(
                    (h) =>
                      h.point && (
                        <circle
                          key={h.key}
                          cx={h.point[0]}
                          cy={h.point[1]}
                          r={0.28}
                          fill="#2563eb"
                          fillOpacity={0.9}
                          stroke="#ffffff"
                          strokeWidth={0.06}
                          style={{ pointerEvents: "auto", touchAction: "none", cursor: "grab" }}
                          onPointerDown={(e) => startDrag(e, h.key)}
                        >
                          <title>{h.label}</title>
                        </circle>
                      ),
                  )}
                </svg>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-500">No preview yet.</p>
          )}
          <p className={`absolute bottom-2 left-3 z-10 text-xs ${overBudget ? "font-semibold text-red-600" : "text-neutral-500"}`}>
            Rendered in {render.ms.toFixed(2)} ms (budget &lt; 16 ms)
            {overBudget ? " — over budget, investigate before shipping" : ""}
            {" · "}Pose: {character.pose} · {character.face.expression}
          </p>
        </section>

        {/* Controls — right edge */}
        <aside className="max-h-[45dvh] w-full shrink-0 overflow-y-auto border-t border-neutral-200 bg-white p-4 sm:p-5 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
          <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500" htmlFor="char-name">
            Character name
          </label>
          <input
            id="char-name"
            value={character.name}
            onChange={(e) => updateLive({ name: e.target.value })}
            onBlur={commitCurrent}
            maxLength={60}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />

          <ControlGroup title="Pose">
            <div className="grid grid-cols-3 gap-2">
              {CREATOR_POSES.map((p) => (
                <ChoiceButton key={p} active={character.pose === p} onClick={() => setPose(p)}>
                  {p}
                </ChoiceButton>
              ))}
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-neutral-500">All {POSE_NAMES.length} poses</summary>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {POSE_NAMES.filter((p) => !CREATOR_POSES.includes(p as PoseName)).map((p) => (
                  <ChoiceButton key={p} active={character.pose === p} onClick={() => setPose(p as PoseName)}>
                    {p}
                  </ChoiceButton>
                ))}
              </div>
            </details>
            <div className="mt-3 flex gap-2">
              <input
                value={poseName}
                onChange={(e) => setPoseName(e.target.value)}
                maxLength={40}
                aria-label="Custom pose name"
                className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={saveCurrentPose}
                className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
                title="Save the current limb angles as a reusable pose"
              >
                Save pose
              </button>
              <button
                type="button"
                onClick={resetPose}
                className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
                title="Clear dragged limb angles, back to the base pose"
              >
                Reset
              </button>
            </div>
            {customPoses.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {customPoses.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-1 pl-3 pr-1 text-xs">
                    <button type="button" onClick={() => applyCustomPose(p)} title={`Apply pose ${p.name}`}>
                      {p.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteCustomPose(p.id)}
                      aria-label={`Delete pose ${p.name}`}
                      className="rounded-full px-1 font-bold text-neutral-500 hover:text-red-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs leading-relaxed text-neutral-400">
              Turn on the pose editor above the canvas and drag the blue dots to pose the limbs by hand.
            </p>
          </ControlGroup>

          <ControlGroup title="Family — one character, whole family">
            <div className="grid grid-cols-3 gap-2">
              {(["female", "child", "elder"] as FamilyKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => makeVariant(kind)}
                  className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm capitalize hover:bg-neutral-100"
                  title={`Create a ${kind} variant of this character and add it to your cast`}
                >
                  {kind}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-neutral-400">
              Same style, same outfit family — adjusted proportions, face and hair. The variant is added to your cast.
            </p>
          </ControlGroup>

          <ControlGroup title="Expression">
            <div className="grid grid-cols-3 gap-2">
              {CREATOR_EXPRESSIONS.map((f) => (
                <ChoiceButton key={f} active={character.face.expression === f} onClick={() => updateFace({ expression: f })}>
                  {f}
                </ChoiceButton>
              ))}
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-neutral-500">All {FACE_NAMES.length} expressions</summary>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {FACE_NAMES.filter((f) => !CREATOR_EXPRESSIONS.includes(f as FaceName)).map((f) => (
                  <ChoiceButton
                    key={f}
                    active={character.face.expression === f}
                    onClick={() => updateFace({ expression: f as FaceName })}
                  >
                    {f}
                  </ChoiceButton>
                ))}
              </div>
            </details>
            <div className="mt-3 space-y-2">
              <Toggle label="Blink" checked={character.face.blink} onChange={(v) => updateFace({ blink: v })} />
              <Toggle label="Blush" checked={character.face.blush} onChange={(v) => updateFace({ blush: v })} />
              <Toggle label="Lashes" checked={character.face.lashes} onChange={(v) => updateFace({ lashes: v })} />
              <Toggle label="Cold (blue cheeks)" checked={character.face.cold} onChange={(v) => updateFace({ cold: v })} />
              <Slider
                label="Mouth open"
                value={character.face.mouth}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => updateFaceLive({ mouth: v })}
                onCommit={commitCurrent}
              />
              <Slider
                label="Eye size"
                value={character.face.eyeSize}
                min={0.5}
                max={2}
                step={0.05}
                onChange={(v) => updateFaceLive({ eyeSize: v })}
                onCommit={commitCurrent}
              />
              <Slider
                label="Eye spacing"
                value={character.face.eyeSpacing}
                min={0.5}
                max={2}
                step={0.05}
                onChange={(v) => updateFaceLive({ eyeSpacing: v })}
                onCommit={commitCurrent}
              />
            </div>
          </ControlGroup>

          <ControlGroup title="Hair">
            <label className="block text-xs text-neutral-500" htmlFor="hair-style">Style</label>
            <select
              id="hair-style"
              value={character.hair.style}
              onChange={(e) => updateHair({ style: e.target.value as HairStyle })}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm"
            >
              {HAIR_STYLES.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <p className="mt-3 text-xs text-neutral-500">Colour</p>
            <div className="mt-1 flex gap-2">
              {(Object.keys(HAIR_COLORS) as HairColorName[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  aria-label={`Hair colour ${c}`}
                  onClick={() => updateHair({ color: c })}
                  className={`h-8 w-8 rounded-full border-2 ${character.hair.color === c ? "border-neutral-900" : "border-neutral-300"}`}
                  style={{ background: HAIR_COLORS[c].base }}
                />
              ))}
            </div>
            <label className="mt-3 block text-xs text-neutral-500" htmlFor="beard">Beard</label>
            <select
              id="beard"
              value={character.hair.beard}
              onChange={(e) => updateHair({ beard: e.target.value as Character["hair"]["beard"] })}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm"
            >
              <option value="none">none</option>
              <option value="full">full</option>
              <option value="long">long</option>
            </select>
          </ControlGroup>

          <ControlGroup title="Wardrobe">
            <p className="mb-2 text-xs text-neutral-500">Era packs — one click dresses the character:</p>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {ERA_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => applyEraPack(pack)}
                  title={pack.description}
                  className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm hover:bg-neutral-100"
                >
                  {pack.name}
                </button>
              ))}
            </div>
            <label className="block text-xs text-neutral-500" htmlFor="hat">Headwear</label>
            <select
              id="hat"
              value={character.outfit.hat}
              onChange={(e) => updateOutfit({ hat: e.target.value as HatName })}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm"
            >
              {HAT_NAMES.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <label className="mt-3 block text-xs text-neutral-500" htmlFor="outfit">Top / outfit</label>
            <select
              id="outfit"
              value={character.outfit.outfit}
              onChange={(e) => updateOutfit({ outfit: e.target.value as OutfitName })}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm"
            >
              {OUTFIT_NAMES.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <label className="mt-3 block text-xs text-neutral-500" htmlFor="legs">Bottom</label>
            <select
              id="legs"
              value={character.outfit.legsOverride ?? "default"}
              onChange={(e) =>
                updateOutfit({ legsOverride: e.target.value === "default" ? null : (e.target.value as "long" | "shorts") })
              }
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm"
            >
              <option value="default">Outfit default</option>
              <option value="long">Long trousers</option>
              <option value="shorts">Shorts</option>
            </select>
            <div className="mt-3 flex items-end gap-2">
              <label className="block flex-1 text-xs text-neutral-500" htmlFor="shoe-color">
                Footwear colour
                <input
                  id="shoe-color"
                  type="color"
                  value={character.outfit.shoeColor ?? "#3a2a20"}
                  onChange={(e) => updateOutfit({ shoeColor: e.target.value })}
                  className="mt-1 block h-9 w-full cursor-pointer rounded-md border border-neutral-300 bg-white px-1"
                />
              </label>
              <button
                type="button"
                onClick={() => updateOutfit({ shoeColor: null })}
                disabled={character.outfit.shoeColor === null}
                className="rounded-md border border-neutral-300 px-2 py-2 text-xs hover:bg-neutral-100 disabled:opacity-40"
                title="Use the outfit's own shoe colour"
              >
                Default
              </button>
            </div>
            <label className="mt-3 block text-xs text-neutral-500" htmlFor="accessory">Accessory</label>
            <select
              id="accessory"
              value={character.outfit.accessory}
              onChange={(e) => updateOutfit({ accessory: e.target.value as Character["outfit"]["accessory"] })}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm"
            >
              <option value="none">none</option>
              <option value="scarf">scarf</option>
            </select>
            {character.outfit.accessory === "scarf" && (
              <label className="mt-2 block text-xs text-neutral-500" htmlFor="accessory-color">
                Scarf colour
                <input
                  id="accessory-color"
                  type="color"
                  value={character.outfit.accessoryColor}
                  onChange={(e) => updateOutfit({ accessoryColor: e.target.value })}
                  className="mt-1 block h-9 w-full cursor-pointer rounded-md border border-neutral-300 bg-white px-1"
                />
              </label>
            )}
            <label className="mt-3 block text-xs text-neutral-500" htmlFor="prop">Held prop</label>
            <select
              id="prop"
              value={character.outfit.hold}
              onChange={(e) => updateOutfit({ hold: e.target.value as PropName })}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm"
            >
              {PROP_NAMES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {character.outfit.hold !== "none" && (
              <label className="mt-3 block text-xs text-neutral-500" htmlFor="hold-hand">
                Held in
                <select
                  id="hold-hand"
                  value={character.outfit.holdHand}
                  onChange={(e) => updateOutfit({ holdHand: e.target.value as "front" | "back" })}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm"
                >
                  <option value="front">Front hand</option>
                  <option value="back">Back hand</option>
                </select>
              </label>
            )}
            <div className="mt-3">
              <Toggle label="Facing left" checked={character.facing === "left"} onChange={(v) => update({ facing: v ? "left" : "right" })} />
            </div>
          </ControlGroup>

          <ControlGroup title="Style">
            <label className="block text-xs text-neutral-500" htmlFor="skin">
              Skin (white = day, tan = warm day, silhouette = night)
            </label>
            <select
              id="skin"
              value={character.style.skin}
              onChange={(e) => updateStyleLive({ skin: e.target.value as Character["style"]["skin"] })}
              onBlur={commitCurrent}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              <option value="white">White</option>
              <option value="tan">Tan</option>
              <option value="silhouette">Silhouette</option>
            </select>
            <Slider
              label="Outline wobble (×1 = engine default)"
              value={character.style.wobble}
              min={0}
              max={3}
              step={0.05}
              onChange={(v) => updateStyleLive({ wobble: v })}
              onCommit={commitCurrent}
            />
            <Slider
              label="Limb width"
              value={character.style.limbWidth}
              min={0.03}
              max={0.2}
              step={0.005}
              onChange={(v) => updateStyleLive({ limbWidth: v })}
              onCommit={commitCurrent}
            />
            <Slider
              label="Outline width"
              value={character.style.outlineWidth}
              min={0.02}
              max={0.2}
              step={0.005}
              onChange={(v) => updateStyleLive({ outlineWidth: v })}
              onCommit={commitCurrent}
            />
            <label className="mt-3 block text-xs text-neutral-500" htmlFor="seed">
              Random seed (same seed = same drawing)
            </label>
            <input
              id="seed"
              type="number"
              min={0}
              max={100000}
              value={character.style.seed}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) updateStyleLive({ seed: Math.max(0, Math.min(100000, Math.round(n))) });
              }}
              onBlur={commitCurrent}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </ControlGroup>

          <div className="mt-4 flex gap-2 border-t border-neutral-200 pt-4">
            <button
              type="button"
              onClick={saveToCast}
              className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700"
              title="Add this character to your cast library"
            >
              Save to cast
            </button>
            <button
              type="button"
              onClick={copyJson}
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
            >
              Copy JSON
            </button>
            <button
              type="button"
              onClick={reset}
              className="flex-1 rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
            >
              Reset
            </button>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-neutral-400">
            A character is data, not a picture. The same character renders identically in every pose,
            outfit and scene — video #1 and video #100 look the same.
          </p>
        </aside>
      </div>
    </main>
  );
}

function ControlGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t border-neutral-200 pt-4 first:mt-4 first:border-t-0 first:pt-0">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}

function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-2 py-1.5 text-sm capitalize ${
        active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-neutral-900" />
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between text-neutral-600">
        <span>{label}</span>
        <span className="font-mono text-xs">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onBlur={onCommit}
        className="mt-1 w-full accent-neutral-900"
      />
    </label>
  );
}
