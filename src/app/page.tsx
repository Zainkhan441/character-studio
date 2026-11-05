"use client";

/**
 * Character Studio — home.
 *
 * Positioning: "One character. Every scene. An entire video."
 * A real page, not a placeholder: the live character demo (click to
 * wave, auto-plays three poses), a script → storyboard before/after,
 * the 3-step workflow, a same-character consistency demo, cut-away
 * examples, and the starter family — all rendered by the real
 * renderer, scene and story libraries.
 */
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { defaultCharacter, type PoseName } from "@/lib/character";
import { renderCharacterSvg } from "@/lib/renderer";
import { starterCast } from "@/lib/cast";
import { buildStoryboard, formatDuration, shotToScene } from "@/lib/story";
import { defaultScene, renderScene } from "@/lib/scene";

const DEMO_POSES: PoseName[] = ["stand", "wave", "cheer"];
/**
 * Demo frame, measured in the browser 2026-11-05 over the three demo
 * poses (stand / wave / cheer): union of the rendered bounds +
 * 0.35 margin. In SVG user space — the renderer shifts the character
 * by -ground (≈-1.98), so a frame written in character-local space
 * clips the head (seen in QA before this fix).
 */
const DEMO_VIEWBOX = "-1.8 -5.8 3.7 6.3";

const SAMPLE_SCRIPT = [
  "The first humans walked out of Africa.",
  "They followed the herds across the savanna, and at night they gathered around the fire.",
  "Inside the cave, they painted the hunt on the wall.",
].join("\n");

const CONSISTENCY_POSES: PoseName[] = ["stand", "wave", "cheer", "think", "point", "walk"];

function safeSvg(fn: () => string): string {
  try {
    return fn();
  } catch {
    return "";
  }
}

export default function Home() {
  const [poseIndex, setPoseIndex] = useState(1); // start waving
  const [paused, setPaused] = useState(false);

  // Auto-play the three demo poses every 2.2s until the user clicks.
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setPoseIndex((i) => (i + 1) % DEMO_POSES.length), 2200);
    return () => clearInterval(t);
  }, [paused]);

  const demoSvg = useMemo(() => {
    const c = { ...defaultCharacter(), pose: DEMO_POSES[poseIndex] };
    return safeSvg(() => renderCharacterSvg(c, { viewBox: DEMO_VIEWBOX, background: "#f5f3ef" }));
  }, [poseIndex]);

  const waveNow = () => {
    setPaused(true);
    setPoseIndex(1);
  };

  // (b) Before / after: the same sample script, turned into shots.
  const beforeAfter = useMemo(() => {
    const cast = starterCast();
    const castMap = new Map(cast.map((c) => [c.id, c]));
    const castIds = cast.map((c) => c.id);
    const board = buildStoryboard(SAMPLE_SCRIPT, castIds);
    const stills = board.shots.slice(0, 3).map((shot) => {
      const scene = shotToScene(shot, 7);
      return { shot, svg: safeSvg(() => renderScene(scene, castMap, { width: 640, height: 360 }).svg) };
    });
    return { board, stills };
  }, []);

  // (d) Consistency: the SAME character in six different poses.
  const consistencySvgs = useMemo(
    () =>
      CONSISTENCY_POSES.map((pose) => ({
        pose,
        svg: safeSvg(() =>
          renderCharacterSvg({ ...defaultCharacter(), pose }, { viewBox: DEMO_VIEWBOX, background: "#f5f3ef" }),
        ),
      })),
    [],
  );

  // (e) Cut-away examples: house + igloo, rendered by renderScene.
  const cutaways = useMemo(
    () =>
      (["house", "igloo"] as const).map((cutaway) => {
        const scene = { ...defaultScene(), id: `home-${cutaway}`, name: `${cutaway} cut-away`, cutaway, variant: "day" as const };
        return { cutaway, svg: safeSvg(() => renderScene(scene, new Map(), { width: 640, height: 360 }).svg) };
      }),
    [],
  );

  // (f) Family demo: three starter characters together in one scene.
  const family = useMemo(() => {
    const cast = starterCast();
    const three = cast.slice(0, 3); // Arjun, Asha, Baba Jaan
    const castMap = new Map(cast.map((c) => [c.id, c]));
    const scene = {
      ...defaultScene(),
      id: "home-family",
      name: "The family",
      background: "savanna" as const,
      variant: "day" as const,
      nameLabels: true,
      placements: three.map((c, i) => ({
        id: `home-family-${c.id}`,
        characterId: c.id,
        x: [-4, 0, 4][i] ?? 0,
        scale: 1,
        flip: false,
        pose: null,
        expression: null,
      })),
    };
    return { three, svg: safeSvg(() => renderScene(scene, castMap, { width: 960, height: 540 }).svg) };
  }, []);

  return (
    <AppShell active={null}>
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        {/* (a) Headline + working example */}
        <section className="flex flex-col items-center text-center">
          <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
            One character. Every scene. An entire video.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-neutral-600">
            Create consistent hand-drawn characters and turn your YouTube script into a complete illustrated
            storyboard.
          </p>

          {/* Live demo: click the character to wave */}
          <button
            type="button"
            onClick={waveNow}
            title="Click the character — he waves back"
            className="mt-8 block w-full max-w-sm cursor-pointer rounded-2xl border border-neutral-200 bg-[#f5f3ef] transition hover:border-neutral-400"
          >
            <span
              className="block [&_svg]:mx-auto [&_svg]:block [&_svg]:h-[340px] [&_svg]:w-auto"
              dangerouslySetInnerHTML={{ __html: demoSvg }}
            />
            <span className="block pb-4 text-xs text-neutral-500">
              {paused
                ? "He waved back 👋 — click again anytime"
                : "Live demo — stills that change every 2.2s, just like the videos this studio makes · click him to wave"}
            </span>
          </button>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/creator"
              className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
            >
              Create your first character →
            </a>
            <a
              href="/story"
              className="rounded-md border border-neutral-300 px-5 py-2.5 text-sm font-medium hover:bg-neutral-100"
            >
              See how a script becomes a video →
            </a>
          </div>
          <p className="mt-6 max-w-xl text-sm text-neutral-500">
            Inside: character creator, cast library, scene editor, script-to-video storyboard, cut-aways and
            thumbnails — all free, all in your browser.
          </p>
        </section>

        {/* (b) Before / after: script → storyboard */}
        <section className="mt-16">
          <h2 className="text-center text-2xl font-bold tracking-tight">From script to storyboard</h2>
          <p className="mt-2 text-center text-neutral-600">
            Paste a script. Every line becomes a shot — this is what three lines look like.
          </p>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-neutral-200 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Your script</h3>
              <div className="mt-3 space-y-3">
                {SAMPLE_SCRIPT.split("\n").map((line, i) => (
                  <p key={i} className="text-base leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
              <p className="mt-4 text-sm text-neutral-500">
                {beforeAfter.board.lineCount} lines → {beforeAfter.board.shots.length} shots ·{" "}
                {formatDuration(beforeAfter.board.totalSec)} of narration
              </p>
            </div>
            <div className="space-y-4">
              {beforeAfter.stills.map(({ shot, svg }) => (
                <figure key={shot.id} className="overflow-hidden rounded-xl border border-neutral-200">
                  <span
                    className="block [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                  <figcaption className="border-t border-neutral-100 px-4 py-2 text-sm text-neutral-600">
                    “{shot.text}” · {shot.durationSec.toFixed(1)}s
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
          <p className="mt-6 text-center text-sm text-neutral-500">
            Vyond and Animaker already have reusable characters — our edge is the combination: editable structured
            characters + scene composition + automatic shot generation, with you in control, not an AI generator.
          </p>
        </section>

        {/* (c) 3-step workflow */}
        <section className="mt-16">
          <h2 className="text-center text-2xl font-bold tracking-tight">How it works</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Step
              n="1"
              title="Create your character"
              body="Design a hand-drawn character — or upload your own cartoon picture and let the tool extract it."
              href="/creator"
              link="Open the Creator →"
            />
            <Step
              n="2"
              title="Paste your script"
              body="Every line becomes a shot; long lines split into two different shots. Reorder, retime, reshoot."
              href="/story"
              link="Try the storyboard →"
            />
            <Step
              n="3"
              title="Export your video"
              body="Add free in-browser narration, then export an MP4 where every shot lasts exactly as long as its voice."
              href="/story"
              link="See export →"
            />
          </div>
        </section>

        {/* (d) Consistency demo: one character, six poses */}
        <section className="mt-16">
          <h2 className="text-center text-2xl font-bold tracking-tight">One character, every pose</h2>
          <p className="mt-2 text-center text-neutral-600">
            The same character — same face, same outfit, same style — in six different poses. The character is
            data, not a picture, so video #1 and video #100 look exactly the same.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {consistencySvgs.map(({ pose, svg }) => (
              <figure key={pose} className="overflow-hidden rounded-xl border border-neutral-200 bg-[#f5f3ef]">
                <span
                  className="block [&_svg]:mx-auto [&_svg]:block [&_svg]:h-48 [&_svg]:w-auto"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
                <figcaption className="border-t border-neutral-100 bg-white px-3 py-2 text-center text-sm capitalize text-neutral-600">
                  {pose}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* (e) Cut-away examples */}
        <section className="mt-16">
          <h2 className="text-center text-2xl font-bold tracking-tight">Cut-aways: the shot that explains</h2>
          <p className="mt-2 text-center text-neutral-600">
            Slice a house or an igloo open and show what is inside — the most valuable shot in explainer videos,
            built in.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {cutaways.map(({ cutaway, svg }) => (
              <figure key={cutaway} className="overflow-hidden rounded-xl border border-neutral-200">
                <span
                  className="block [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
                <figcaption className="border-t border-neutral-100 px-4 py-2 text-sm capitalize text-neutral-600">
                  {cutaway} cut-away
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* (f) Family demo */}
        <section className="mt-16">
          <h2 className="text-center text-2xl font-bold tracking-tight">One character, a whole family</h2>
          <p className="mt-2 text-center text-neutral-600">
            {family.three.map((c) => c.name).join(", ")} — starter characters from the cast, standing in the same
            scene. Turn any character into a female, child or elder variant with the same style.
          </p>
          <figure className="mt-6 overflow-hidden rounded-xl border border-neutral-200">
            <span
              className="block [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: family.svg }}
            />
          </figure>
          <p className="mt-4 text-center">
            <a href="/cast" className="text-sm font-medium text-neutral-900 underline hover:text-neutral-600">
              Browse the cast →
            </a>
          </p>
        </section>

        {/* (g) Final CTA */}
        <section className="mt-16 rounded-2xl border border-neutral-200 bg-neutral-50 px-6 py-10 text-center">
          <h2 className="text-2xl font-bold tracking-tight">Start your first video today</h2>
          <p className="mt-2 text-neutral-600">
            One character. Every scene. An entire video — made by you, free, in your browser.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/creator"
              className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
            >
              Create your first character →
            </a>
            <a
              href="/story"
              className="rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-neutral-100"
            >
              See how a script becomes a video →
            </a>
          </div>
        </section>

        <p className="mt-10 text-center text-xs leading-relaxed text-neutral-400">
          Free to use. Characters render in your browser — nothing is uploaded, no account, no paid APIs. Import,
          voice and MP4 export all run on your device.
        </p>
      </div>
    </AppShell>
  );
}

function Step({ n, title, body, href, link }: { n: string; title: string; body: string; href: string; link: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-5">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white">
        {n}
      </span>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-neutral-600">{body}</p>
      <a href={href} className="mt-3 inline-block text-sm font-medium text-neutral-900 underline hover:text-neutral-600">
        {link}
      </a>
    </div>
  );
}
