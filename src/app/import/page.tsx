"use client";

/**
 * Character import — /import (M3, Zain's top demand).
 *
 * Upload ANY cartoon picture → the tool extracts the character
 * itself → you correct it → it joins your cast.
 *
 * Steps: 1 Upload → 2 Remove background (AI BiRefNet, or simple
 * mode for plain backgrounds) → 3 Fix the mask (brush) → 4 Review
 * the draft + drag joints to correct it → 5 Save to cast.
 *
 * Honest by design: the AI gets you ~80%; the correction UI gets
 * you 100%. If segmentation finds no figure, the page says so and
 * tells you what to try — it never silently saves a broken draft.
 * The image never leaves the browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  defaultCharacter,
  validateCharacter,
  FACE_NAMES,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFIT_NAMES,
  POSE_NAMES,
  type Character,
  type FaceName,
  type HairColorName,
  type HairStyle,
  type OutfitName,
  type PoseName,
} from "@/lib/character";
import {
  characterJoints,
  computeSkeleton,
  jointsToCharacterSpace,
  limbAnglesForPoint,
  renderCharacterSvg,
} from "@/lib/renderer";
import { loadCast, saveCast, upsertCast } from "@/lib/cast";
import {
  analyzeSilhouette,
  draftCharacterFromAnalysis,
  thresholdMask,
  type SilhouetteAnalysis,
} from "@/lib/extract";
import {
  loadImagePixels,
  segmentSimple,
  segmentWithAI,
  SegmentationError,
  type SegmentProgress,
  type SegmentResult,
} from "@/lib/segment";

const IMPORT_VIEWBOX = "-3.4 -6.0 6.8 6.8";
const MAX_FILE_MB = 10;

type Step = "upload" | "segment" | "correct" | "done";
type DragLimb = "frontArm" | "backArm" | "frontLeg" | "backLeg";

/** Draw a sample cartoon stick figure (for "Try a sample"). */
async function makeSampleImage(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 560;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 400, 560);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Body: blue shirt torso + legs.
  ctx.strokeStyle = "#211c19";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(200, 210);
  ctx.lineTo(200, 330);
  ctx.stroke();
  ctx.strokeStyle = "#5b8dc9";
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.moveTo(200, 225);
  ctx.lineTo(200, 320);
  ctx.stroke();
  // Arms: one waving.
  ctx.strokeStyle = "#211c19";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(200, 240);
  ctx.lineTo(150, 300);
  ctx.moveTo(200, 240);
  ctx.lineTo(255, 150);
  ctx.stroke();
  // Legs.
  ctx.beginPath();
  ctx.moveTo(200, 330);
  ctx.lineTo(170, 470);
  ctx.moveTo(200, 330);
  ctx.lineTo(230, 470);
  ctx.stroke();
  // Head: white circle, brown hair, dot eyes, smile.
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#211c19";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(200, 140, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#5b3a24";
  ctx.beginPath();
  ctx.arc(200, 128, 72, Math.PI * 1.05, Math.PI * 1.95);
  ctx.lineTo(268, 110);
  ctx.lineTo(260, 78);
  ctx.lineTo(200, 62);
  ctx.lineTo(140, 78);
  ctx.lineTo(132, 110);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#211c19";
  ctx.beginPath();
  ctx.arc(178, 140, 7, 0, Math.PI * 2);
  ctx.arc(222, 140, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#211c19";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(200, 168, 26, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Sample image could not be made."))), "image/png");
  });
}

export default function ImportPage() {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [pixels, setPixels] = useState<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);
  const [mask, setMask] = useState<Uint8Array | null>(null);
  const [maskSize, setMaskSize] = useState({ width: 0, height: 0 });
  const [method, setMethod] = useState<"ai" | "simple" | null>(null);
  const [progress, setProgress] = useState<SegmentProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SilhouetteAnalysis | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [charName, setCharName] = useState("Imported Character");
  const [brushMode, setBrushMode] = useState<"erase" | "restore">("erase");
  const [brushSize, setBrushSize] = useState(24);
  const [dragging, setDragging] = useState(false);

  const cutoutRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const characterRef = useRef<Character | null>(null);
  const dragRef = useRef<{ limb: DragLimb; startChar: Character } | null>(null);
  const maskRef = useRef<Uint8Array | null>(null);
  const pixelsRef = useRef<typeof pixels>(null);
  const fileRef = useRef<Blob | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    characterRef.current = character;
  }, [character]);

  /* ---------------- upload ---------------- */

  const handleFile = useCallback(async (file: Blob, name: string) => {
    setError(null);
    setNotice(null);
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`That file is over ${MAX_FILE_MB} MB. Use a smaller image.`);
      return;
    }
    if (file.type && !file.type.startsWith("image/")) {
      setError("That is not an image file. Upload a PNG or JPG.");
      return;
    }
    setBusy(true);
    try {
      const px = await loadImagePixels(file);
      fileRef.current = file;
      pixelsRef.current = px;
      setPixels(px);
      setFileName(name);
      setMask(null);
      setMethod(null);
      setAnalysis(null);
      setCharacter(null);
      setStep("segment");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The image could not be read.");
    } finally {
      setBusy(false);
    }
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f, f.name);
  };

  const onSample = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await makeSampleImage();
      await handleFile(blob, "sample-character.png");
      setNotice("Sample character loaded — try the AI background removal below.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The sample could not be made.");
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- segmentation ---------------- */

  const runSegmentAI = useCallback(async () => {
    if (!pixelsRef.current) return;
    setBusy(true);
    setError(null);
    setProgress({ stage: "loading-model", percent: 0, note: "Starting…" });
    try {
      const result: SegmentResult = await segmentWithAI(pixelsRef.current, setProgress);
      maskRef.current = result.mask;
      setMask(result.mask);
      setMaskSize({ width: result.width, height: result.height });
      setMethod("ai");
      setProgress(null);
      setNotice("Background removed with AI. Check the cutout — paint-fix it if needed, then continue.");
    } catch (err) {
      if (err instanceof SegmentationError) setError(err.message);
      else setError(err instanceof Error ? err.message : "Segmentation failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  const runSegmentSimple = useCallback(() => {
    if (!pixelsRef.current) return;
    setError(null);
    const result = segmentSimple(pixelsRef.current);
    maskRef.current = result.mask;
    setMask(result.mask);
    setMaskSize({ width: result.width, height: result.height });
    setMethod("simple");
    setNotice("Simple mode: background removed by colour. Works best on cartoons with a plain background — check the cutout carefully.");
  }, []);

  /* ---------------- mask preview + brush ---------------- */

  const drawCutout = useCallback(() => {
    const canvas = cutoutRef.current;
    const px = pixelsRef.current;
    const m = maskRef.current;
    if (!canvas || !px || !m) return;
    canvas.width = px.width;
    canvas.height = px.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Checkerboard for transparency.
    const cell = 16;
    for (let y = 0; y < px.height; y += cell) {
      for (let x = 0; x < px.width; x += cell) {
        ctx.fillStyle = ((x / cell + y / cell) % 2 === 0 ? "#e5e5e5" : "#ffffff");
        ctx.fillRect(x, y, cell, cell);
      }
    }
    const img = ctx.createImageData(px.width, px.height);
    for (let i = 0; i < m.length; i++) {
      img.data[i * 4] = px.data[i * 4];
      img.data[i * 4 + 1] = px.data[i * 4 + 1];
      img.data[i * 4 + 2] = px.data[i * 4 + 2];
      img.data[i * 4 + 3] = m[i];
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  useEffect(() => {
    drawCutout();
  }, [mask, pixels, drawCutout]);

  const paintMask = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = cutoutRef.current;
    const m = maskRef.current;
    if (!canvas || !m || maskSize.width === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * maskSize.width;
    const y = ((e.clientY - rect.top) / rect.height) * maskSize.height;
    const r = (brushSize / rect.width) * maskSize.width;
    const value = brushMode === "erase" ? 0 : 255;
    const next = new Uint8Array(m);
    for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(maskSize.height - 1, Math.ceil(y + r)); yy++) {
      for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(maskSize.width - 1, Math.ceil(x + r)); xx++) {
        if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) next[yy * maskSize.width + xx] = value;
      }
    }
    maskRef.current = next;
    setMask(next);
  };

  /* ---------------- analysis + correction ---------------- */

  const runAnalysis = useCallback(() => {
    const m = maskRef.current;
    const px = pixelsRef.current;
    if (!m || !px) return;
    const binary = thresholdMask(m, 128);
    const result = analyzeSilhouette({ data: binary, width: px.width, height: px.height }, px);
    if (!result) {
      setError(
        "No figure was found in the cutout. Try a clearer picture with the character on a plain background, or paint the mask back in with the restore brush.",
      );
      return;
    }
    setAnalysis(result);
    const draft = draftCharacterFromAnalysis(result, charName);
    setCharacter(draft);
    setStep("correct");
    setError(null);
    setNotice(
      `Draft ready — pose guessed as "${result.snappedPose}" (${Math.round(result.confidence * 100)}% confident). Drag the blue dots to fix any limb, or pick a different pose below.`,
    );
  }, [charName]);

  const updateCharacter = useCallback((patch: Partial<Character>) => {
    setCharacter((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const joints = (() => {
    if (!character) return null;
    try {
      return characterJoints(character);
    } catch {
      return null;
    }
  })();

  const startDrag = useCallback(
    (e: React.PointerEvent<SVGCircleElement>, limb: DragLimb) => {
      e.preventDefault();
      e.stopPropagation();
      const startChar = characterRef.current;
      if (!startChar) return;
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
        if (!c) return;
        let next: Character | null = null;
        if (drag.limb === "frontArm" || drag.limb === "backArm") {
          const [a1, a2] = limbAnglesForPoint(sk.shoulder, c.proportions.upperArm, c.proportions.lowerArm, target, -1);
          next = drag.limb === "frontArm" ? { ...c, frontArm: [a1, a2] } : { ...c, backArm: [a1, a2] };
        } else {
          const [a1, a2] = limbAnglesForPoint(sk.hip, c.proportions.upperLeg, c.proportions.lowerLeg, target, 1);
          next = drag.limb === "frontLeg" ? { ...c, frontLeg: [a1, a2] } : { ...c, backLeg: [a1, a2] };
        }
        if (next) setCharacter(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        dragRef.current = null;
        setDragging(false);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [],
  );

  const draftSvg = (() => {
    if (!character) return "";
    try {
      return renderCharacterSvg(character, { viewBox: IMPORT_VIEWBOX }).replace(
        /viewBox="[^"]*"/,
        `viewBox="${IMPORT_VIEWBOX}"`,
      );
    } catch {
      return "";
    }
  })();

  const saveToCast = () => {
    if (!character) return;
    const named = { ...character, name: charName.trim() || "Imported Character" };
    const v = validateCharacter(named);
    if (!v.ok) {
      setError(`The character could not be saved: ${v.error}`);
      return;
    }
    const { cast } = loadCast();
    if (!saveCast(upsertCast(cast, v.character))) {
      setError("Storage is unavailable — the character works in this session only.");
      return;
    }
    setCharacter(v.character);
    setStep("done");
    setNotice(`"${v.character.name}" is in your cast.`);
  };

  if (!mounted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white text-neutral-500">
        Loading the importer…
      </main>
    );
  }

  return (
    <AppShell active="characters">
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        <p className="text-sm text-neutral-600">
          Upload any cartoon picture — the tool extracts the character, you correct it in about two minutes, and it
          joins your cast. The picture never leaves your browser. <strong>Step {step === "upload" ? 1 : step === "segment" ? 2 : step === "correct" ? 3 : 4} of 4</strong>
        </p>

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>
        )}
        {notice && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-amber-700 underline">Dismiss</button>
          </div>
        )}

        {/* STEP 1 — upload */}
        {step === "upload" && (
          <section className="mt-6">
            <div
              className="flex min-h-64 flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 p-8 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFile(f, f.name);
              }}
            >
              <p className="text-lg font-semibold">Drop a cartoon picture here</p>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-600">
                A single character on a plain background works best. PNG or JPG, up to {MAX_FILE_MB} MB. The picture
                is processed in your browser — it is never uploaded anywhere.
              </p>
              <label className="mt-4 cursor-pointer rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700">
                Choose a picture
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFileInput} />
              </label>
              <button type="button" onClick={onSample} disabled={busy} className="mt-3 rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 disabled:opacity-50">
                {busy ? "Loading…" : "Try a sample character"}
              </button>
            </div>
          </section>
        )}

        {/* STEP 2 — segment + mask fix */}
        {step === "segment" && pixels && (
          <section className="mt-6">
            <h1 className="text-xl font-bold">Remove the background</h1>
            <p className="mt-1 text-sm text-neutral-600">
              {fileName} · {pixels.width}×{pixels.height}px · {method ? `method: ${method === "ai" ? "AI (BiRefNet)" : "simple"}` : "no cutout yet"}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={runSegmentAI} disabled={busy} className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50">
                {busy ? "Working…" : "Remove background (AI)"}
              </button>
              <button type="button" onClick={runSegmentSimple} disabled={busy} className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 disabled:opacity-50">
                Simple mode (plain backgrounds)
              </button>
              <button type="button" onClick={() => setStep("upload")} className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100">
                Upload a different picture
              </button>
            </div>
            {progress && (
              <div className="mt-4 rounded-xl border border-neutral-200 p-4">
                <p className="text-sm font-medium">{progress.note}</p>
                {progress.percent >= 0 && (
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                    <div className="h-full bg-neutral-900 transition-all" style={{ width: `${progress.percent}%` }} />
                  </div>
                )}
                <p className="mt-2 text-xs text-neutral-500">First time only: the AI model (~98 MB) downloads once, then it works offline.</p>
              </div>
            )}
            {mask && (
              <>
                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                  <div>
                    <h2 className="text-sm font-semibold">Cutout — check it before continuing</h2>
                    <p className="mt-1 text-xs text-neutral-500">Checkerboard = removed background. Paint with the brush to fix mistakes.</p>
                    <canvas
                      ref={cutoutRef}
                      className="mt-2 max-h-[420px] w-full cursor-crosshair rounded-xl border border-neutral-200 object-contain"
                      onPointerDown={(e) => {
                        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                        paintMask(e);
                      }}
                      onPointerMove={(e) => {
                        if (e.buttons === 1) paintMask(e);
                      }}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <button type="button" onClick={() => setBrushMode("erase")} className={`rounded-md border px-3 py-1.5 ${brushMode === "erase" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}>Erase</button>
                      <button type="button" onClick={() => setBrushMode("restore")} className={`rounded-md border px-3 py-1.5 ${brushMode === "restore" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}>Restore</button>
                      <label className="ml-2 flex items-center gap-2 text-xs text-neutral-600">
                        Brush size
                        <input type="range" min={8} max={64} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
                        {brushSize}px
                      </label>
                    </div>
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">What happens next</h2>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-neutral-600">
                      <li>The tool measures the figure: head size, body proportions, colours, pose.</li>
                      <li>It snaps the pose to the closest of our 21 poses and builds a draft character.</li>
                      <li>You drag the blue dots to fix any limb and pick hair, outfit and expression.</li>
                      <li>Save — the character joins your cast and works in every scene.</li>
                    </ol>
                    <button type="button" onClick={runAnalysis} className="mt-4 w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700">
                      Analyse the cutout →
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {/* STEP 3 — correct the draft */}
        {step === "correct" && character && analysis && (
          <section className="mt-6">
            <h1 className="text-xl font-bold">Correct the draft</h1>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-neutral-100 px-2 py-1">Pose guess: {analysis.snappedPose}</span>
              <span className="rounded bg-neutral-100 px-2 py-1">Confidence: {Math.round(analysis.confidence * 100)}%</span>
              <span className="rounded bg-neutral-100 px-2 py-1">Head: {Math.round(analysis.headRatio * 100)}% of height</span>
              <span className="rounded bg-neutral-100 px-2 py-1">Skin: {analysis.palette.skin}</span>
              <span className="rounded bg-neutral-100 px-2 py-1">Hair: {analysis.palette.hair}</span>
              <span className="rounded bg-neutral-100 px-2 py-1">Outfit: {analysis.palette.outfit}</span>
            </div>
            {analysis.warnings.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
                {analysis.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <div className="relative overflow-hidden rounded-xl border border-neutral-200 bg-[#f5f3ef]">
                <div className="[&_svg]:block [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: draftSvg }} />
                {joints && (
                  <svg
                    ref={overlayRef}
                    viewBox={IMPORT_VIEWBOX}
                    className="pointer-events-none absolute inset-0 h-full w-full"
                  >
                    {([
                      ["frontArm", joints.frontHand],
                      ["backArm", joints.backHand],
                      ["frontLeg", joints.frontFoot],
                      ["backLeg", joints.backFoot],
                    ] as const).map(([limb, pt]) =>
                      pt ? (
                        <circle
                          key={limb}
                          cx={pt[0]}
                          cy={pt[1]}
                          r={0.22}
                          fill="#2563eb"
                          stroke="#ffffff"
                          strokeWidth={0.06}
                          className="pointer-events-auto cursor-grab active:cursor-grabbing"
                          onPointerDown={(e) => startDrag(e, limb)}
                        >
                          <title>{`Drag to move the ${limb === "frontArm" ? "front arm" : limb === "backArm" ? "back arm" : limb === "frontLeg" ? "front leg" : "back leg"}`}</title>
                        </circle>
                      ) : null,
                    )}
                  </svg>
                )}
                <p className="border-t border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-500">
                  Drag the blue dots to move arms and legs. {dragging ? "Dragging…" : ""}
                </p>
              </div>
              <div className="space-y-3 text-sm">
                <label className="block">
                  <span className="text-xs text-neutral-500">Character name</span>
                  <input
                    value={charName}
                    onChange={(e) => setCharName(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-neutral-500">Pose {character.pose !== analysis.snappedPose ? "(changed from the AI guess)" : ""}</span>
                  <select
                    value={character.pose}
                    onChange={(e) => updateCharacter({ pose: e.target.value as PoseName, backArm: null, frontArm: null, backLeg: null, frontLeg: null })}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5"
                  >
                    {POSE_NAMES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-2">
                  <label className="flex-1">
                    <span className="text-xs text-neutral-500">Hair style</span>
                    <select
                      value={character.hair.style}
                      onChange={(e) => updateCharacter({ hair: { ...character.hair, style: e.target.value as HairStyle } })}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5"
                    >
                      {HAIR_STYLES.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex-1">
                    <span className="text-xs text-neutral-500">Hair colour</span>
                    <select
                      value={character.hair.color}
                      onChange={(e) => updateCharacter({ hair: { ...character.hair, color: e.target.value as HairColorName } })}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5"
                    >
                      {Object.keys(HAIR_COLORS).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex gap-2">
                  <label className="flex-1">
                    <span className="text-xs text-neutral-500">Outfit</span>
                    <select
                      value={character.outfit.outfit}
                      onChange={(e) => updateCharacter({ outfit: { ...character.outfit, outfit: e.target.value as OutfitName } })}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5"
                    >
                      {OUTFIT_NAMES.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex-1">
                    <span className="text-xs text-neutral-500">Expression</span>
                    <select
                      value={character.face.expression}
                      onChange={(e) => updateCharacter({ face: { ...character.face, expression: e.target.value as FaceName } })}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5"
                    >
                      {FACE_NAMES.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => updateCharacter({ backArm: null, frontArm: null, backLeg: null, frontLeg: null })}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
                >
                  Reset dragged limbs
                </button>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button type="button" onClick={saveToCast} className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700">
                    Save to my cast →
                  </button>
                  <button type="button" onClick={() => setStep("segment")} className="rounded-md border border-neutral-300 px-4 py-2.5 text-sm hover:bg-neutral-100">
                    Back to cutout
                  </button>
                </div>
                <p className="text-xs leading-relaxed text-neutral-500">
                  Only import characters you own or have the right to use. This tool is for your own art and
                  licensed characters — not for copying someone else's character.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* STEP 4 — done */}
        {step === "done" && character && (
          <section className="mt-6 text-center">
            <p className="text-2xl font-bold">“{character.name}” is in your cast ✓</p>
            <p className="mt-2 text-sm text-neutral-600">
              Use {character.name} in the Creator, in scenes, and in script-to-video — just like any other character.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <a href={`/creator?cast=${encodeURIComponent(character.id)}`} className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700">
                Open in Creator →
              </a>
              <a href="/cast" className="rounded-md border border-neutral-300 px-5 py-2.5 text-sm hover:bg-neutral-100">
                View my cast
              </a>
              <button
                type="button"
                onClick={() => {
                  setStep("upload");
                  setPixels(null);
                  setMask(null);
                  setAnalysis(null);
                  setCharacter(null);
                  setCharName("Imported Character");
                  setError(null);
                  setNotice(null);
                }}
                className="rounded-md border border-neutral-300 px-5 py-2.5 text-sm hover:bg-neutral-100"
              >
                Import another character
              </button>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
