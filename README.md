# Character Studio

Character-consistent animation studio for faceless YouTube channels.
A character is data, not a picture.

## Status

- M0a — repo + deploy live.
- M0b — parametric character model + SVG renderer ported from the
  Python + SVG reference engine (`engine-ref/engine/ink.py`), with a
  live Character Creator at `/creator`. All 21 poses, 13 expressions,
  13 hair styles, 18 outfits, 8 hats, 14 held props.

## Stack (versions verified 2026-11-05, research-first)

| Dependency | Version | Note |
|---|---|---|
| next | 14.2.35 | App Router, React 18 |
| typescript | 5.x (strict, no `any`) | `strict: true` in tsconfig |
| tailwindcss | 3.4.1 | |
| zod | 4.6.7 | Latest stable Oct 12 2026. Note: in Zod v4, `.default()` values are NOT re-parsed — nested object defaults must use `.prefault({})` (see `src/lib/character.ts`). |
| vitest | 5.0.5 | Latest stable Sep 3 2026; 5.0.5 fixes CVE-2026-112948. Requires Node ≥ 22.12. |
| vite | 6.4.0 | Vitest 5 peer dependency |

Install note: plain `npm install vitest@5.0.5` fails on npm 10.9.4 with
`Cannot read properties of null (reading 'edgesOut')` (arborist peer-set
bug). Workaround used: install `vite@6.4.0` first, then
`npm install --legacy-peer-deps vitest@5.0.5`.

Free tiers only — Vercel free, Supabase free (later). No paid APIs.
Rendering client-side. No auth/billing in the MVP.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000, creator at /creator
npm test         # vitest run — 67 tests, must pass
npm run build    # production build, must pass
```

## Renderer

`src/lib/renderer.ts` is a faithful TypeScript port of `ink.py`:
`POSES` + `limb()` forward kinematics, `hair_svg`, `face_svg`,
`hat_svg`, `fur_svg` / `cavedress_svg` / `top_svg` / `hips_svg`,
`prop_svg`, `character()` z-order assembly, and the `hand` filter
(`feTurbulence` baseFrequency 0.025 + `feDisplacementMap` — the whole
hand-drawn look) plus the grain overlay.

Determinism: the only randomness is a seeded RNG (`src/lib/rng.ts`,
mulberry32). Same character + same seed = byte-identical SVG. The
numbers differ from the Python engine (it uses Mersenne Twister), but
determinism holds inside this renderer — that is the property the
product depends on.

Filter units: ink.py renders scenes in pixel space (1 unit = 98 px at
1080p, wobble = 1.8 px). This standalone SVG renders in character-unit
space (720 px / 9 viewBox units = 80 px/unit), so the filter values
are converted: hand turbulence 0.025/px → 2.0/unit, displacement
scale 1.8 px × wobble / 80 = 0.0225 × wobble, grain 0.9/px → 72/unit.
Using the pixel values directly in unit space warps the drawing ~265×
too strongly (found by visual check 2026-11-05; regression-tested).

Framing: the default viewBox `-4.5 -9.5 9 10.5` fits the character in
normal poses, but a long held prop in a raised-hand pose (cheer +
spear tip reaches −11.9 units) or a lying character with a prop
extends beyond it. The creator page auto-fits the viewBox with
`getBBox()` after every render — expanding only, never shrinking
below the default frame — so nothing ever clips.

## Creator

`/creator` — live preview (light/dark toggle, render time shown live
against the &lt;16 ms budget) + side controls for pose, expression,
hair, outfit, hat, prop, wobble and face options. Autosaves to
localStorage (validated with the Zod schema on load; corrupt data
falls back to the default character with a warning).
