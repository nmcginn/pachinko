// Responsive layout (M8): where the board goes once the page's controls are
// placed. The controls (reel, ball count, buttons, handle, the adjust panel
// and live stats while editing) sit at the screen's edges, laid out by CSS
// (style.css, #ui); this finds the largest board that fits in the space they
// leave, so no control ever covers the board, whatever the screen's shape.
// Pure: rectangles in, a rectangle out. main.ts measures the controls.

/** An axis-aligned rectangle in CSS pixels: left, top, right, bottom. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function rectWidth(r: Rect): number {
  return Math.max(0, r.right - r.left);
}

export function rectHeight(r: Rect): number {
  return Math.max(0, r.bottom - r.top);
}

/** Whether two rectangles share some area (touching edges don't count). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Pixels per metre for a `widthM` × `heightM` board in `area`, keeping
 * `marginPx` clear all round. Never negative.
 */
export function scaleIn(area: Rect, widthM: number, heightM: number, marginPx: number): number {
  return Math.max(
    0,
    Math.min(
      (rectWidth(area) - 2 * marginPx) / widthM,
      (rectHeight(area) - 2 * marginPx) / heightM,
    ),
  );
}

/**
 * Most obstacles freeArea will consider. A page has about ten; past this
 * the search could get slow, so the rest are ignored (and may overlap).
 */
export const MAX_OBSTACLES = 16;

/**
 * The part of `viewport` to fit the board in: the rectangle, clear of every
 * obstacle, in which a `widthM` × `heightM` board (with `marginPx` round it)
 * is largest. Each obstacle in the way is cleared by moving one side of the
 * area past it (the top down to its bottom, the left across to its right,
 * and so on); the search tries every choice and keeps the best.
 *
 * Ties (a width-limited board fits as large either way) go to the larger
 * area, so the board centres in the biggest gap; then to the first found.
 * Obstacles outside the viewport, or of no size, are ignored.
 */
export function freeArea(
  viewport: Rect,
  obstacles: readonly Rect[],
  widthM: number,
  heightM: number,
  marginPx: number,
): Rect {
  const blocks = obstacles
    .filter((o) => rectWidth(o) > 0 && rectHeight(o) > 0 && overlaps(o, viewport))
    .slice(0, MAX_OBSTACLES);
  let best = viewport;
  let bestScale = -1;
  let bestArea = -1;

  const search = (area: Rect): void => {
    const scale = scaleIn(area, widthM, heightM, marginPx);
    // Shrinking an area never grows the board, so a branch already no
    // better than the best can't win (on area either, which only shrinks too).
    const size = rectWidth(area) * rectHeight(area);
    if (scale < bestScale || (scale === bestScale && size <= bestArea)) return;
    const hit = blocks.find((o) => overlaps(o, area));
    if (!hit) {
      best = area;
      bestScale = scale;
      bestArea = size;
      return;
    }
    search({ ...area, top: hit.bottom });
    search({ ...area, bottom: hit.top });
    search({ ...area, left: hit.right });
    search({ ...area, right: hit.left });
  };
  search(viewport);
  return best;
}
