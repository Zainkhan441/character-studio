"use client";

/**
 * Cast library — /cast
 *
 * The 5 starter characters plus anything saved from the Creator.
 * Each card renders its character live (the renderer is ~0.1ms, so
 * a grid of SVGs is cheap) and opens in the Creator in one click.
 * Family variants can be made right here — each one is added to the
 * cast. Stored in localStorage, Zod-validated on load; corrupt
 * entries are dropped and reported, never a crash.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadCast, removeFromCast, saveCast, starterCast, upsertCast, type CastLoadResult } from "@/lib/cast";
import type { Character } from "@/lib/character";
import { makeFamilyVariant, type FamilyKind } from "@/lib/family";
import { measureCharacterViewBox } from "@/lib/fit-viewbox";
import { renderCharacterSvg } from "@/lib/renderer";

const CARD_VIEWBOX = "-4.5 -9.5 9 10.5";

function cardSvg(c: Character): string {
  try {
    return renderCharacterSvg(c, { viewBox: CARD_VIEWBOX, background: "#f5f3ef" });
  } catch {
    return "";
  }
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
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const result: CastLoadResult = loadCast();
    setCast(result.cast);
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
  };

  const makeVariant = (base: Character, kind: FamilyKind) => {
    const v = makeFamilyVariant(base, kind);
    persist(upsertCast(cast, v));
    setNotice(`${v.name} added to your cast.`);
  };

  const remove = (id: string, name: string) => {
    persist(removeFromCast(cast, id));
    setNotice(`${name} removed from the cast.`);
  };

  const resetCast = () => {
    const fresh = starterCast();
    persist(fresh);
    setNotice("Cast reset to the 5 starters.");
  };

  const svgs = useMemo(() => new Map(cast.map((c) => [c.id, cardSvg(c)])), [cast]);

  if (!loaded) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100">
        <p className="text-sm text-neutral-600">Loading your cast…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-white text-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <a href="/" className="text-lg font-bold tracking-tight">
            Character Studio
          </a>
          <span className="hidden rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 sm:inline">Cast</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetCast}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            Reset to starters
          </button>
          <a href="/import" className="rounded-md border border-neutral-900 bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-100">
            ＋ Add your own character
          </a>
          <a href="/creator" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700">
            + New character
          </a>
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

      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Your cast</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {cast.length} character{cast.length === 1 ? "" : "s"}. Each one is data — the same character renders
          identically in every pose, outfit and scene. Got your own cartoon?{" "}
          <a href="/import" className="font-medium text-neutral-900 underline">Add your own character →</a>
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cast.map((c) => (
            <article key={c.id} className="overflow-hidden rounded-xl border border-neutral-200">
              <CastCardArt svg={svgs.get(c.id) ?? ""} />
              <div className="border-t border-neutral-200 p-4">
                <h2 className="text-base font-semibold">{c.name}</h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {c.outfit.outfit} · {c.hair.style} hair · {c.pose}
                </p>
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
                    onClick={() => remove(c.id, c.name)}
                    className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs text-red-700 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        <p className="mt-8 text-xs leading-relaxed text-neutral-400">
          Cast members are stored in this browser for now (localStorage). Cloud sync with accounts comes later —
          no auth or billing in this milestone.
        </p>
      </div>
    </main>
  );
}
