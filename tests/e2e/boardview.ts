// Where the page draws the board, for clicking on nails. The board moves
// with the layout (M8: it is fitted round the controls, and shrinks when
// the adjust panel opens), so read it from the page rather than work it out.

import type { Page } from '@playwright/test';

export interface PageBoardView {
  readonly scale: number;
  readonly ox: number;
  readonly oy: number;
}

/**
 * The board's mapping to CSS pixels (px = ox + x·scale, py = oy − y·scale),
 * from canvas[data-board-view], after a few frames so a layout change in
 * flight (edit mode opening, a resize) has been drawn.
 */
export async function boardView(page: Page): Promise<PageBoardView> {
  const raw = await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    return document.querySelector<HTMLCanvasElement>('canvas#board')?.dataset['boardView'];
  });
  const [scale, ox, oy] = (raw ?? '').split(',').map(Number);
  if (scale === undefined || ox === undefined || oy === undefined || !(scale > 0))
    throw new Error(`no board view on the canvas: ${raw}`);
  return { scale, ox, oy };
}

/** Click on the board at (x, y) in metres, where the page draws it now. */
export async function clickBoard(page: Page, x: number, y: number): Promise<void> {
  const bv = await boardView(page);
  await page.mouse.click(bv.ox + x * bv.scale, bv.oy - y * bv.scale);
}
