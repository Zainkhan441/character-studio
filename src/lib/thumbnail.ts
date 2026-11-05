/**
 * Thumbnail maker (M3).
 *
 * The reference format's thumbnails (style guide §7): one big
 * character + 2–3 words in big yellow letters. A thumbnail made
 * from the same cast + renderer matches the video art, which is
 * the click-trust the genre runs on.
 *
 * Pure string work: renderScene() draws the scene, then the title
 * is injected as a <text> group before </svg> — big yellow fill,
 * dark outline (paint-order stroke), hand font. Deterministic and
 * unit-tested; the page rasterizes the SVG to PNG for download.
 */
import { defaultScene, renderScene, type BackgroundId, type Variant } from "./scene";
import type { Character } from "./character";
import type { FaceName, PoseName } from "./character";

export const THUMBNAIL_WIDTH = 1280;
export const THUMBNAIL_HEIGHT = 720;
export const THUMBNAIL_YELLOW = "#ffd500";

export interface ThumbnailVariant {
  id: string;
  name: string;
  /** Title font size in px (at 1280×720). */
  textSize: number;
  /** Title anchor point. */
  textX: number;
  textY: number;
  align: "start" | "middle";
  /** Second line (sub-title) size, 0 = no sub-line. */
  subSize: number;
}

export const THUMBNAIL_VARIANTS: ThumbnailVariant[] = [
  {
    id: "bottom-left",
    name: "Bottom left — big title",
    textSize: 150,
    textX: 60,
    textY: 640,
    align: "start",
    subSize: 0,
  },
  {
    id: "top-center",
    name: "Top centre — title + sub",
    textSize: 120,
    textX: 640,
    textY: 170,
    align: "middle",
    subSize: 54,
  },
  {
    id: "bottom-center",
    name: "Bottom centre — title + sub",
    textSize: 130,
    textX: 640,
    textY: 620,
    align: "middle",
    subSize: 48,
  },
];

export interface ThumbnailOpts {
  character: Character | null;
  pose: PoseName;
  expression: FaceName;
  background: BackgroundId;
  variant: Variant;
  title: string;
  sub?: string;
  variantId: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Split a long title into at most two lines at a word boundary. */
export function splitTitle(title: string, maxChars = 12): string[] {
  const t = title.trim().toUpperCase();
  if (t.length <= maxChars) return [t];
  const words = t.split(/\s+/);
  const first: string[] = [];
  let len = 0;
  for (const w of words) {
    if (first.length > 0 && len + 1 + w.length > maxChars) break;
    first.push(w);
    len += (first.length > 1 ? 1 : 0) + w.length;
  }
  const rest = words.slice(first.length).join(" ");
  if (first.length === 0 || rest.length === 0) return [t];
  return [first.join(" "), rest];
}

/** Render a 1280×720 thumbnail SVG. Pure — unit-tested. */
export function renderThumbnailSvg(opts: ThumbnailOpts): string {
  const variant = THUMBNAIL_VARIANTS.find((v) => v.id === opts.variantId) ?? THUMBNAIL_VARIANTS[0];
  const scene = defaultScene();
  scene.background = opts.background;
  scene.variant = opts.variant;
  scene.camera = "wide";
  scene.watermark = false;
  scene.nameLabels = false;
  scene.textCard = null;
  scene.placements = opts.character
    ? [
        {
          id: "thumb-char",
          characterId: opts.character.id,
          x: -2.5,
          scale: 1.15,
          flip: false,
          pose: opts.pose,
          expression: opts.expression,
        },
      ]
    : [];
  const characters = new Map<string, Character>();
  if (opts.character) characters.set(opts.character.id, opts.character);
  const { svg } = renderScene(scene, characters, { width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT });

  const lines = splitTitle(opts.title || "UNTITLED");
  const lineHeight = variant.textSize * 1.05;
  const startY = variant.textY - (lines.length - 1) * lineHeight;
  const titleText = lines
    .map(
      (line, i) =>
        `<text x="${variant.textX}" y="${Math.round(startY + i * lineHeight)}" text-anchor="${variant.align}" font-family="'Patrick Hand', 'Kalam', 'Comic Sans MS', cursive" font-size="${variant.textSize}" font-weight="bold" fill="${THUMBNAIL_YELLOW}" stroke="#211c19" stroke-width="${Math.round(variant.textSize * 0.16)}" paint-order="stroke" stroke-linejoin="round">${escapeXml(line)}</text>`,
    )
    .join("");
  const subText =
    opts.sub && variant.subSize > 0
      ? `<text x="${variant.textX}" y="${Math.round(variant.textY + variant.subSize + 14)}" text-anchor="${variant.align}" font-family="'Patrick Hand', 'Kalam', 'Comic Sans MS', cursive" font-size="${variant.subSize}" font-weight="bold" fill="#ffffff" stroke="#211c19" stroke-width="${Math.round(variant.subSize * 0.16)}" paint-order="stroke" stroke-linejoin="round">${escapeXml(opts.sub.toUpperCase())}</text>`
      : "";
  const overlay = `<g>${titleText}${subText}</g>`;
  return svg.replace("</svg>", `${overlay}</svg>`);
}
