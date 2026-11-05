/**
 * Fit a viewBox around the rendered character inside a container.
 *
 * Measures the inner character group — the direct child of the
 * hand-filter group — via getBoundingClientRect + the SVG's inverse
 * screen CTM, so the result is in SVG user space whatever the
 * current viewBox is, and whatever ground offset the renderer used
 * (the character group is translated by -ground, which varies by
 * pose — hardcoding a frame in character-local space clips heads).
 *
 * Do NOT measure with getBBox() on the filtered outer group: when a
 * background is set, the background rect inside that group spans
 * the whole frame, so getBBox() returns the full viewBox and the
 * "fit" does nothing. (Found by QA 2026-11-05: the creator preview
 * stayed at ~50% height until the measurement moved to the inner
 * group.)
 *
 * Returns the fitted viewBox string, or null when nothing
 * measurable is laid out yet (caller keeps the previous frame).
 */
export function measureCharacterViewBox(
  container: HTMLElement,
  opts: { minWidth?: number; minHeight?: number; margin?: number } = {},
): string | null {
  const { minWidth = 3.2, minHeight = 5.4, margin = 0.35 } = opts;
  const svg = container.querySelector("svg");
  const g = container.querySelector("g[filter] > g");
  if (!svg || !g || !(g instanceof SVGGraphicsElement)) return null;
  const r = g.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const inv = ctm.inverse();
  const p1 = new DOMPoint(r.left, r.top).matrixTransform(inv);
  const p2 = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
  let x = p1.x - margin;
  let y = p1.y - margin;
  let w = p2.x - p1.x + margin * 2;
  let h = p2.y - p1.y + margin * 2;
  if (w < minWidth) {
    const cx = x + w / 2;
    x = cx - minWidth / 2;
    w = minWidth;
  }
  if (h < minHeight) {
    const cy = y + h / 2;
    y = cy - minHeight / 2;
    h = minHeight;
  }
  const f = (n: number): string => n.toFixed(2);
  return `${f(x)} ${f(y)} ${f(w)} ${f(h)}`;
}
