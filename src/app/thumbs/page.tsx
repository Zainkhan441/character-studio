"use client";

/**
 * Thumbnail maker — /thumbs (M3).
 *
 * Pick a cast character + pose + background, type the title, and
 * get a 1280×720 thumbnail in the same style as the video: one big
 * character + big yellow letters. Three layout variants, PNG
 * download. Accepts ?character=&title=&bg= so /story can link here
 * for a shot.
 */
import { useEffect, useMemo, useState } from "react";
import { loadCast } from "@/lib/cast";
import {
  FACE_NAMES,
  POSE_NAMES,
  type Character,
  type FaceName,
  type PoseName,
} from "@/lib/character";
import { BACKGROUND_IDS, BACKGROUND_NAMES, type BackgroundId, type Variant } from "@/lib/scene";
import { renderThumbnailSvg, THUMBNAIL_HEIGHT, THUMBNAIL_VARIANTS, THUMBNAIL_WIDTH } from "@/lib/thumbnail";
import { downloadBlob, svgToPng } from "@/lib/export-image";

export default function ThumbsPage() {
  const [mounted, setMounted] = useState(false);
  const [cast, setCast] = useState<Character[]>([]);
  const [characterId, setCharacterId] = useState("");
  const [pose, setPose] = useState<PoseName>("point");
  const [expression, setExpression] = useState<FaceName>("happy");
  const [background, setBackground] = useState<BackgroundId>("savanna");
  const [variant, setVariant] = useState<Variant>("day");
  const [title, setTitle] = useState("FIRE");
  const [sub, setSub] = useState("");
  const [variantId, setVariantId] = useState(THUMBNAIL_VARIANTS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const { cast: loaded } = loadCast();
    setCast(loaded);
    const params = new URLSearchParams(window.location.search);
    const qChar = params.get("character");
    const qTitle = params.get("title");
    const qBg = params.get("bg");
    if (qChar && loaded.some((c) => c.id === qChar)) setCharacterId(qChar);
    else setCharacterId(loaded[0]?.id ?? "");
    if (qTitle) setTitle(qTitle.slice(0, 40));
    if (qBg && (BACKGROUND_IDS as readonly string[]).includes(qBg)) setBackground(qBg as BackgroundId);
    setMounted(true);
  }, []);

  const character = useMemo(
    () => cast.find((c) => c.id === characterId) ?? null,
    [cast, characterId],
  );

  const svg = useMemo(() => {
    if (!mounted) return "";
    try {
      return renderThumbnailSvg({ character, pose, expression, background, variant, title, sub, variantId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The thumbnail could not be rendered.");
      return "";
    }
  }, [mounted, character, pose, expression, background, variant, title, sub, variantId]);

  const downloadPng = async () => {
    if (!svg) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await svgToPng(svg, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
      downloadBlob(blob, `thumbnail-${(title || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`);
      setNotice("Thumbnail downloaded (1280×720 PNG).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The PNG could not be made.");
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white text-neutral-500">
        Loading the thumbnail maker…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-white text-neutral-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3 sm:px-6">
        <span className="text-lg font-bold tracking-tight">Character Studio · Thumbnail maker</span>
        <nav className="flex flex-wrap items-center gap-2">
          <a href="/" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">Home</a>
          <a href="/cast" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">Cast</a>
          <a href="/story" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">Script → Video</a>
          <a href="/creator" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700">Creator</a>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>
        )}
        {notice && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-amber-700 underline">Dismiss</button>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-neutral-200 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full">
          {svg ? (
            <span dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="flex aspect-video items-center justify-center bg-neutral-100 text-sm text-neutral-400">No preview</div>
          )}
        </div>
        <p className="mt-2 text-xs text-neutral-500">1280×720 · one big character + big yellow letters — the format that works in this niche.</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="text-xs text-neutral-500">Title (2–3 words work best)</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={40}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-base font-semibold"
                placeholder="FIRE"
              />
            </label>
            <label className="block">
              <span className="text-xs text-neutral-500">Sub-line (optional, top/bottom-centre variants)</span>
              <input
                value={sub}
                onChange={(e) => setSub(e.target.value)}
                maxLength={40}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5"
                placeholder="e.g. the night that changed everything"
              />
            </label>
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="text-xs text-neutral-500">Character</span>
                <select value={characterId} onChange={(e) => setCharacterId(e.target.value)} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5">
                  <option value="">No character (diagram)</option>
                  {cast.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex-1">
                <span className="text-xs text-neutral-500">Pose</span>
                <select value={pose} onChange={(e) => setPose(e.target.value as PoseName)} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5">
                  {POSE_NAMES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="text-xs text-neutral-500">Expression</span>
                <select value={expression} onChange={(e) => setExpression(e.target.value as FaceName)} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5">
                  {FACE_NAMES.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="flex-1">
                <span className="text-xs text-neutral-500">Background</span>
                <select value={background} onChange={(e) => setBackground(e.target.value as BackgroundId)} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5">
                  {BACKGROUND_IDS.map((b) => (
                    <option key={b} value={b}>{BACKGROUND_NAMES[b]}</option>
                  ))}
                </select>
              </label>
              <label className="flex-1">
                <span className="text-xs text-neutral-500">Time of day</span>
                <select value={variant} onChange={(e) => setVariant(e.target.value as Variant)} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5">
                  <option value="day">Day</option>
                  <option value="dusk">Dusk</option>
                  <option value="night">Night</option>
                </select>
              </label>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold">Layout variants</h2>
            <div className="mt-2 space-y-2">
              {THUMBNAIL_VARIANTS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVariantId(v.id)}
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm ${variantId === v.id ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400"}`}
                >
                  <span className="font-medium">{v.name}</span>
                  <span className="block text-xs text-neutral-500">
                    {v.id === "bottom-left" ? "Title bottom-left, character left" : v.id === "top-center" ? "Title top-centre with sub-line" : "Title bottom-centre with sub-line"}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={downloadPng}
              disabled={busy || !svg}
              className="mt-4 w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {busy ? "Making PNG…" : "Download thumbnail PNG"}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">
              The thumbnail uses the same cast and renderer as your video, so the art on the thumbnail is the art in
              the video — no mismatch, no AI drift.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
