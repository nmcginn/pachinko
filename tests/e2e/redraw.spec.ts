// M8 (Lighthouse): the canvas is drawn only when what it shows changes, or
// while balls or glints move on it (render/redraw.ts). An idle board isn't
// rastered again every frame, but nothing that changes is ever left stale.
//
// Board draws are counted by wrapping fillRect before the page loads:
// drawBoard starts every draw by filling the whole canvas from (0, 0).

import { expect, test, type Page } from '@playwright/test';
import { boardView, clickBoard } from './boardview';

/** The classic board's right start nail (boards/classic.json nails[1]). */
const START_NAIL = { x: 0.2573, y: 0.178 } as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { boardDraws: number };
    w.boardDraws = 0;
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
      if (this.canvas.id === 'board' && x === 0 && y === 0) w.boardDraws += 1;
      fillRect.call(this, x, y, width, height);
    };
  });
});

/** Board draws over the next `frames` animation frames. */
const drawsOver = (page: Page, frames: number): Promise<number> =>
  page.evaluate(async (n) => {
    const w = window as unknown as { boardDraws: number };
    const before = w.boardDraws;
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
    return w.boardDraws - before;
  }, frames);

/** Pure white pixels on the canvas: only a ball's specular highlight is (visuals.spec.ts). */
const whitePixels = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const board = document.querySelector<HTMLCanvasElement>('canvas#board');
    const ctx = board?.getContext('2d');
    if (!board || !ctx) throw new Error('no canvas');
    const { data } = ctx.getImageData(0, 0, board.width, board.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4)
      if ((data[i] ?? 0) >= 254 && (data[i + 1] ?? 0) >= 254 && (data[i + 2] ?? 0) >= 254) n++;
    return n;
  });

/** The canvas pixel at the board point (x, y) in metres, as [r, g, b]. */
const pixelAt = (page: Page, x: number, y: number): Promise<number[]> =>
  page.evaluate(
    ({ x, y }) => {
      const board = document.querySelector<HTMLCanvasElement>('canvas#board');
      const ctx = board?.getContext('2d');
      const [scale, ox, oy] = (board?.dataset['boardView'] ?? '').split(',').map(Number);
      if (!board || !ctx || !scale || ox === undefined || oy === undefined)
        throw new Error('no board view');
      const ratio = board.width / board.clientWidth;
      const d = ctx.getImageData(
        Math.round((ox + x * scale) * ratio),
        Math.round((oy - y * scale) * ratio),
        1,
        1,
      ).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
    },
    { x, y },
  );

test('an idle board is drawn once, then left alone', async ({ page }) => {
  await page.goto('/?seed=54');
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
  await boardView(page);
  expect(await drawsOver(page, 30)).toBe(0);
  // It is on screen all the same: the playfield's green between the nails.
  expect(await pixelAt(page, 0.15, 0.3)).toEqual([0x1f, 0x3a, 0x2c]);
});

test('balls in play are drawn every frame, and the board settles once they are gone', async ({
  page,
}) => {
  await page.goto('/?seed=54');
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
  await page.keyboard.down('Space');
  await expect
    .poll(async () => Number(await page.locator('#balls').getAttribute('data-in-play')))
    .toBeGreaterThan(0);
  await page.keyboard.up('Space');
  // Every frame with a ball in it is a draw (allow one frame for the last
  // ball to leave mid-count).
  const frames = 20;
  expect(await drawsOver(page, frames)).toBeGreaterThanOrEqual(frames - 1);

  await expect
    .poll(async () => Number(await page.locator('#balls').getAttribute('data-in-play')), {
      timeout: 15_000,
    })
    .toBe(0);
  // Glints fade in 0.15 s; after that nothing moves, so nothing is drawn.
  await expect.poll(() => drawsOver(page, 30), { timeout: 5_000 }).toBe(0);
  // And the frame that erased the last ball was drawn: no highlight is left behind.
  expect(await whitePixels(page)).toBe(0);
  await expect(page.locator('canvas#board')).toHaveAttribute('data-glints', '0');
});

test('a resize redraws the board where it now fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const before = await boardView(page);
  expect(await drawsOver(page, 10)).toBe(0);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await boardView(page)).scale).not.toBe(before.scale);
  expect(await drawsOver(page, 10)).toBe(0);
  expect(await pixelAt(page, 0.15, 0.3)).toEqual([0x1f, 0x3a, 0x2c]);
});

test('edit mode, selecting and nudging a nail each redraw', async ({ page }) => {
  await page.goto('/?seed=54');
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
  await boardView(page);
  const draws = () => page.evaluate(() => (window as unknown as { boardDraws: number }).boardDraws);

  let n = await draws();
  await page.keyboard.press('e');
  await expect.poll(draws).toBeGreaterThan(n);
  await boardView(page);
  expect(await drawsOver(page, 10)).toBe(0);

  n = await draws();
  await clickBoard(page, START_NAIL.x + 0.0005, START_NAIL.y);
  await expect(page.locator('#adjust-panel')).toHaveAttribute('data-selected', '1');
  await expect.poll(draws).toBeGreaterThan(n);
  // The selection ring is drawn: edit blue (#6fd3ff) somewhere round the nail.
  const ringBlue = await page.evaluate(() => {
    const board = document.querySelector<HTMLCanvasElement>('canvas#board');
    const ctx = board?.getContext('2d');
    if (!board || !ctx) throw new Error('no canvas');
    const { data } = ctx.getImageData(0, 0, board.width, board.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4)
      if (
        Math.abs((data[i] ?? 0) - 0x6f) < 8 &&
        Math.abs((data[i + 1] ?? 0) - 0xd3) < 8 &&
        Math.abs((data[i + 2] ?? 0) - 0xff) < 8
      )
        n++;
    return n;
  });
  expect(ringBlue).toBeGreaterThan(0);

  n = await draws();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#adjust-panel')).toHaveAttribute('data-offset', '1,0');
  await expect.poll(draws).toBeGreaterThan(n);
  expect(await drawsOver(page, 10)).toBe(0);
});
