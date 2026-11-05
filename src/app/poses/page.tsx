/**
 * Pose matrix — /poses
 *
 * A visual regression page: all 21 poses rendered from the same
 * default character, so a broken pose angle is visible at a glance.
 * The numeric guard lives in src/lib/pose-matrix.test.ts (no arm may
 * cross the face, cheer elbows clear of the head, IK round-trips).
 * Server-rendered — the renderer is pure and deterministic.
 */
import { POSE_NAMES, defaultCharacter } from "@/lib/character";
import { renderCharacterSvg } from "@/lib/renderer";

/**
 * Card frame, measured in the browser 2026-11-05 over all 21 poses:
 * union of the rendered bounds + 0.35 margin = "-3.79 -5.77 6.50 6.38"
 * (the lie pose drives the width, standing poses drive the height).
 * A single shared frame keeps the matrix uniform. The frame is in
 * SVG user space — the renderer shifts the character by -ground
 * (≈-1.98 for standing poses), so a frame written in character-local
 * space clips every head (seen in QA before this fix).
 */
const CARD_VIEWBOX = "-3.8 -5.8 6.5 6.4";

export default function PosesPage() {
  const cards = POSE_NAMES.map((pose) => {
    let svg = "";
    try {
      svg = renderCharacterSvg({ ...defaultCharacter(), pose }, { viewBox: CARD_VIEWBOX, background: "#f5f3ef" });
    } catch (err) {
      svg = "";
    }
    return { pose, svg };
  });

  return (
    <main className="flex min-h-screen flex-col bg-white text-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <a href="/" className="text-lg font-bold tracking-tight">
            Character Studio
          </a>
          <span className="hidden rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 sm:inline">Pose matrix</span>
        </div>
        <a href="/creator" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700">
          Open Creator
        </a>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">All {POSE_NAMES.length} poses</h1>
        <p className="mt-1 text-sm text-neutral-600">
          The same default character in every pose. If a limb ever crosses the face again, it shows up here
          first — and the pose-matrix tests fail the build before it ships.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map(({ pose, svg }) => (
            <figure key={pose} className="overflow-hidden rounded-xl border border-neutral-200">
              <div className="bg-[#f5f3ef] [&_svg]:mx-auto [&_svg]:block [&_svg]:h-56 [&_svg]:w-auto" dangerouslySetInnerHTML={{ __html: svg }} />
              <figcaption className="border-t border-neutral-200 px-3 py-2 text-center text-sm capitalize">{pose}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </main>
  );
}
