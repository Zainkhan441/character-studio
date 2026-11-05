"use client";

/**
 * Character Studio — home.
 *
 * A real page, not a placeholder: a live character on a simple
 * background that waves when clicked and auto-plays three poses,
 * plus the path into the studio: create a character, browse the
 * cast, and (next) build scenes from a script.
 */
import { useEffect, useMemo, useState } from "react";
import { defaultCharacter, type PoseName } from "@/lib/character";
import { renderCharacterSvg } from "@/lib/renderer";

const DEMO_POSES: PoseName[] = ["stand", "wave", "cheer"];
/**
 * Demo frame, measured in the browser 2026-11-05 over the three demo
 * poses (stand / wave / cheer): union of the rendered bounds +
 * 0.35 margin. In SVG user space — the renderer shifts the character
 * by -ground (≈-1.98), so a frame written in character-local space
 * clips the head (seen in QA before this fix).
 */
const DEMO_VIEWBOX = "-1.8 -5.8 3.7 6.3";

export default function Home() {
  const [poseIndex, setPoseIndex] = useState(1); // start waving
  const [paused, setPaused] = useState(false);

  // Auto-play the three demo poses every 2.2s until the user clicks.
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setPoseIndex((i) => (i + 1) % DEMO_POSES.length), 2200);
    return () => clearInterval(t);
  }, [paused]);

  const svg = useMemo(() => {
    const c = { ...defaultCharacter(), pose: DEMO_POSES[poseIndex] };
    try {
      return renderCharacterSvg(c, { viewBox: DEMO_VIEWBOX, background: "#f5f3ef" });
    } catch {
      return "";
    }
  }, [poseIndex]);

  const waveNow = () => {
    setPaused(true);
    setPoseIndex(1);
  };

  return (
    <main className="flex min-h-screen flex-col bg-white text-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 sm:px-6">
        <span className="text-lg font-bold tracking-tight">Character Studio</span>
        <div className="flex items-center gap-2">
          <a href="/cast" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
            Cast
          </a>
          <a href="/poses" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
            Poses
          </a>
          <a href="/creator" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700">
            Open Creator
          </a>
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          One character. Every scene. Always the same face.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-neutral-600">
          A character-consistent animation studio for faceless YouTube channels. Your character is data, not a
          picture — video #1 and video #100 look exactly the same.
        </p>

        {/* Live demo: click the character to wave */}
        <button
          type="button"
          onClick={waveNow}
          title="Click the character — he waves back"
          className="mt-8 block w-full max-w-sm cursor-pointer rounded-2xl border border-neutral-200 bg-[#f5f3ef] transition hover:border-neutral-400"
        >
          <span className="block [&_svg]:mx-auto [&_svg]:block [&_svg]:h-[340px] [&_svg]:w-auto" dangerouslySetInnerHTML={{ __html: svg }} />
          <span className="block pb-4 text-xs text-neutral-500">
            {paused
              ? "He waved back 👋 — click again anytime"
              : "Live demo — stills that change every 2.2s, just like the videos this studio makes · click him to wave"}
          </span>
        </button>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a href="/creator" className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700">
            Create a character →
          </a>
          <a href="/cast" className="rounded-md border border-neutral-300 px-5 py-2.5 text-sm font-medium hover:bg-neutral-100">
            Browse the cast →
          </a>
          <span className="rounded-md border border-dashed border-neutral-300 px-5 py-2.5 text-sm text-neutral-400" title="Script → scenes is the next milestone">
            Scenes — coming next
          </span>
        </div>

        <div className="mt-12 grid w-full max-w-3xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
          <Feature title="Cast library" body="Five starter characters — adult, female, elder, child, warrior. One click opens any of them in the Creator." />
          <Feature title="Family generator" body="From any character, make a female, child or elder variant — same style, same outfit family." />
          <Feature title="Pose editor" body="Drag arms and legs right on the canvas, save the pose, reuse it forever. The same tool the character importer will use." />
        </div>
        <p className="mt-10 max-w-xl text-xs leading-relaxed text-neutral-400">
          Free to use. Characters render in your browser — nothing is uploaded, no account, no paid APIs.
          Scenes (script in → full video out) is the next milestone.
        </p>
      </div>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-neutral-600">{body}</p>
    </div>
  );
}
