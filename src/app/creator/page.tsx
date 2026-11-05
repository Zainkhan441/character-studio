"use client";

/**
 * Character Creator — /creator
 *
 * Live parametric character preview (SVG renderer ported from the
 * reference Python engine) + side controls. Autosaves to localStorage
 * on every change, so closing the browser never loses work.
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
  FACE_NAMES,
  HAIR_COLORS,
  HAIR_STYLES,
  HAT_NAMES,
  OUTFIT_NAMES,
  POSE_NAMES,
  PROP_NAMES,
  defaultCharacter,
  validateCharacter,
  type Character,
  type FaceName,
  type HairColorName,
  type HairStyle,
  type HatName,
  type OutfitName,
  type PoseName,
  type PropName,
} from "@/lib/character";
import { renderCharacterTimed } from "@/lib/renderer";

const STORAGE_KEY = "character-studio:creator:character:v1";

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

export default function CreatorPage() {
  const [mounted, setMounted] = useState(false);
  const [character, setCharacter] = useState<Character>(() => defaultCharacter());
  const [notice, setNotice] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load once on mount (client-only: localStorage does not exist on server).
  useEffect(() => {
    const { character: saved, notice: loadNotice } = loadSavedCharacter();
    setCharacter(saved);
    if (loadNotice) setNotice(loadNotice);
    setMounted(true);
  }, []);

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

  const update = useCallback((patch: Partial<Character>) => {
    setCharacter((prev) => ({ ...prev, ...patch }));
    setRenderError(null);
  }, []);

  const updateFace = useCallback((patch: Partial<Character["face"]>) => {
    setCharacter((prev) => ({ ...prev, face: { ...prev.face, ...patch } }));
    setRenderError(null);
  }, []);

  const updateHair = useCallback((patch: Partial<Character["hair"]>) => {
    setCharacter((prev) => ({ ...prev, hair: { ...prev.hair, ...patch } }));
    setRenderError(null);
  }, []);

  const updateOutfit = useCallback((patch: Partial<Character["outfit"]>) => {
    setCharacter((prev) => ({ ...prev, outfit: { ...prev.outfit, ...patch } }));
    setRenderError(null);
  }, []);

  const updateStyle = useCallback((patch: Partial<Character["style"]>) => {
    setCharacter((prev) => ({ ...prev, style: { ...prev.style, ...patch } }));
    setRenderError(null);
  }, []);

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
   * Auto-fit the preview frame. The renderer's default viewBox fits the
   * character in normal poses, but a long held prop in a raised-hand pose
   * (cheer + spear: tip at -11.9 units) or a lying character with a prop
   * extends beyond it. After every render, measure the drawn group's
   * bounding box and expand the viewBox to fit — never shrink below the
   * default frame, so ordinary poses keep a stable framing.
   */
  const previewRef = useRef<HTMLDivElement>(null);
  const [fittedViewBox, setFittedViewBox] = useState<string | null>(null);
  useLayoutEffect(() => {
    const g = previewRef.current?.querySelector("g[filter]");
    if (!g || !(g instanceof SVGGraphicsElement)) return;
    try {
      const b = g.getBBox();
      const m = 0.6; // margin in character units
      const minX = -4.5, minY = -9.5, maxX = 4.5, maxY = 1.0; // default frame
      const x = Math.min(minX, b.x - m);
      const y = Math.min(minY, b.y - m);
      const x2 = Math.max(maxX, b.x + b.width + m);
      const y2 = Math.max(maxY, b.y + b.height + m);
      const vb = `${fmt2(x)} ${fmt2(y)} ${fmt2(x2 - x)} ${fmt2(y2 - y)}`;
      setFittedViewBox((prev) => (prev === vb ? prev : vb));
    } catch {
      // getBBox can throw for a not-yet-laid-out element; keep the
      // default frame — the preview still renders.
    }
  }, [render.svg]);

  const previewSvg = useMemo(() => {
    if (!render.svg || !fittedViewBox) return render.svg;
    return render.svg.replace(/viewBox="[^"]*"/, `viewBox="${fittedViewBox}"`);
  }, [render.svg, fittedViewBox]);

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
    setCharacter(fresh);
    setNotice("Reset to the default character.");
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // Autosave effect will retry; never fail silently to the user.
      setNotice("Reset done, but autosave could not write — check browser storage.");
    }
  }, []);

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

  return (
    <main className="flex min-h-screen flex-col bg-white text-neutral-900">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <a href="/" className="text-lg font-bold tracking-tight">
            Character Studio
          </a>
          <span className="hidden rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 sm:inline">
            Creator
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-neutral-500 md:inline" title="Autosave status">
            {savedAt ? `Autosaved ${savedAt}` : "Autosave on"}
          </span>
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
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 sm:px-6">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-bold" aria-label="Dismiss notice">
            ×
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Canvas — biggest area */}
        <section className="flex flex-1 flex-col items-center justify-center p-4 sm:p-8" style={{ background: previewBg }}>
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
            <>
              <div
                ref={previewRef}
                className="w-full max-w-2xl"
                dangerouslySetInnerHTML={{ __html: previewSvg }}
              />
              <p className={`mt-4 text-xs ${overBudget ? "font-semibold text-red-600" : "text-neutral-500"}`}>
                Rendered in {render.ms.toFixed(2)} ms (budget &lt; 16 ms)
                {overBudget ? " — over budget, investigate before shipping" : ""}
                {" · "}Pose: {character.pose} · {character.face.expression}
              </p>
            </>
          ) : (
            <p className="text-sm text-neutral-500">No preview yet.</p>
          )}
        </section>

        {/* Controls — right edge */}
        <aside className="w-full shrink-0 overflow-y-auto border-t border-neutral-200 bg-white p-4 sm:p-5 lg:w-80 lg:border-l lg:border-t-0">
          <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500" htmlFor="char-name">
            Character name
          </label>
          <input
            id="char-name"
            value={character.name}
            onChange={(e) => update({ name: e.target.value })}
            maxLength={60}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />

          <ControlGroup title="Pose">
            <div className="grid grid-cols-3 gap-2">
              {CREATOR_POSES.map((p) => (
                <ChoiceButton key={p} active={character.pose === p} onClick={() => update({ pose: p })}>
                  {p}
                </ChoiceButton>
              ))}
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-neutral-500">All {POSE_NAMES.length} poses</summary>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {POSE_NAMES.filter((p) => !CREATOR_POSES.includes(p as PoseName)).map((p) => (
                  <ChoiceButton key={p} active={character.pose === p} onClick={() => update({ pose: p as PoseName })}>
                    {p}
                  </ChoiceButton>
                ))}
              </div>
            </details>
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
                onChange={(v) => updateFace({ mouth: v })}
              />
              <Slider
                label="Eye size"
                value={character.face.eyeSize}
                min={0.5}
                max={2}
                step={0.05}
                onChange={(v) => updateFace({ eyeSize: v })}
              />
              <Slider
                label="Eye spacing"
                value={character.face.eyeSpacing}
                min={0.5}
                max={2}
                step={0.05}
                onChange={(v) => updateFace({ eyeSpacing: v })}
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

          <ControlGroup title="Outfit & props">
            <label className="block text-xs text-neutral-500" htmlFor="outfit">Outfit</label>
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
            <label className="mt-3 block text-xs text-neutral-500" htmlFor="hat">Hat / headwear</label>
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
            <div className="mt-3">
              <Toggle label="Facing left" checked={character.facing === "left"} onChange={(v) => update({ facing: v ? "left" : "right" })} />
            </div>
          </ControlGroup>

          <ControlGroup title="Style">
            <Slider
              label="Outline wobble (×1 = engine default)"
              value={character.style.wobble}
              min={0}
              max={3}
              step={0.05}
              onChange={(v) => updateStyle({ wobble: v })}
            />
            <Slider
              label="Limb width"
              value={character.style.limbWidth}
              min={0.03}
              max={0.2}
              step={0.005}
              onChange={(v) => updateStyle({ limbWidth: v })}
            />
            <Slider
              label="Outline width"
              value={character.style.outlineWidth}
              min={0.02}
              max={0.2}
              step={0.005}
              onChange={(v) => updateStyle({ outlineWidth: v })}
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
                if (Number.isFinite(n)) updateStyle({ seed: Math.max(0, Math.min(100000, Math.round(n))) });
              }}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </ControlGroup>

          <div className="mt-4 flex gap-2 border-t border-neutral-200 pt-4">
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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
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
        className="mt-1 w-full accent-neutral-900"
      />
    </label>
  );
}
