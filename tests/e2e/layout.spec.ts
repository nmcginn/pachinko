// M8: responsive layout, portrait first. At phone, landscape-phone and
// desktop sizes, in play and while adjusting nails, the board is fitted
// clear of every control, the launch handle sits under the right thumb in
// portrait, the buttons are big enough to tap, and the debug overlay stays
// out of the way unless asked for.

import { expect, test, type Page } from '@playwright/test';
import { boardView, clickBoard } from './boardview';

const BOARD_W_M = 0.5;
const BOARD_H_M = 0.53;
const START_NAIL = { x: 0.2428, y: 0.178 };

interface Box {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Every control showing over the canvas: #ui's children and their buttons, and the debug overlay. */
const controls = (page: Page): Promise<Box[]> =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>('#ui > *, #controls > *, #debug')];
    return els
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.id, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      })
      .filter((b) => b.right > b.left && b.bottom > b.top);
  });

async function boardBox(page: Page): Promise<Box> {
  const bv = await boardView(page);
  return {
    id: 'board',
    left: bv.ox,
    top: bv.oy - BOARD_H_M * bv.scale,
    right: bv.ox + BOARD_W_M * bv.scale,
    bottom: bv.oy,
  };
}

const overlap = (a: Box, b: Box) =>
  a.left < b.right - 0.5 &&
  b.left < a.right - 0.5 &&
  a.top < b.bottom - 0.5 &&
  b.top < a.bottom - 0.5;

/** The board is on screen, at least `minWidthPx` wide, and no control covers it. */
async function expectBoardClear(page: Page, minWidthPx: number): Promise<Box> {
  const board = await boardBox(page);
  const size = page.viewportSize();
  if (!size) throw new Error('no viewport');
  expect(board.left).toBeGreaterThanOrEqual(0);
  expect(board.top).toBeGreaterThanOrEqual(0);
  expect(board.right).toBeLessThanOrEqual(size.width);
  expect(board.bottom).toBeLessThanOrEqual(size.height);
  expect(board.right - board.left).toBeGreaterThanOrEqual(minWidthPx);
  const covering = (await controls(page)).filter((c) => overlap(c, board)).map((c) => c.id);
  expect(covering).toEqual([]);
  return board;
}

const SIZES = [
  // name, viewport, phone?, smallest board width in play, and while editing
  { name: 'phone 390×844', width: 390, height: 844, phone: true, play: 340, edit: 340 },
  { name: 'small phone 375×667', width: 375, height: 667, phone: true, play: 320, edit: 260 },
  { name: 'narrow phone 320×568', width: 320, height: 568, phone: true, play: 260, edit: 180 },
  { name: 'phone landscape 844×390', width: 844, height: 390, phone: true, play: 320, edit: 240 },
  { name: 'narrow window 900×700', width: 900, height: 700, phone: false, play: 560, edit: 380 },
  { name: 'desktop 1280×800', width: 1280, height: 800, phone: false, play: 700, edit: 640 },
] as const;

for (const s of SIZES) {
  test.describe(s.name, () => {
    test.use({
      viewport: { width: s.width, height: s.height },
      hasTouch: s.phone,
      isMobile: s.phone,
    });

    test('no control covers the board, in play or while adjusting nails', async ({ page }) => {
      await page.goto('/?seed=54');
      await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
      await expectBoardClear(page, s.play);

      // Tap targets: every button and the handle at least 44 px tall.
      for (const id of ['mute', 'adjust', 'handle']) {
        const box = await page.locator(`#${id}`).boundingBox();
        expect(box?.height, id).toBeGreaterThanOrEqual(44);
      }
      if (s.phone) await expect(page.locator('#vibration')).toBeVisible();

      if (s.height > s.width) {
        // One-handed: the handle at the bottom right, under the right thumb.
        const handle = await page.locator('#handle').boundingBox();
        if (!handle) throw new Error('no handle');
        expect(handle.x).toBeGreaterThan(s.width / 2);
        expect(handle.y + handle.height).toBeGreaterThan(s.height - 40);
      }

      await page.locator('#adjust').click();
      await expect(page.locator('#adjust-panel')).toBeVisible();
      await expect(page.locator('#adjust-stats')).toBeVisible();
      await expectBoardClear(page, s.edit);
      // Every control the panel needs is on screen.
      for (const id of ['adjust', 'nudge-left', 'nudge-reset', 'board-export', 'board-import']) {
        const box = await page.locator(`#${id}`).boundingBox();
        expect(box, id).not.toBeNull();
        if (!box) continue;
        expect(box.y, id).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, id).toBeLessThanOrEqual(s.height);
      }

      // A start nail, by the start pocket, can be picked where the board now is.
      await clickBoard(page, START_NAIL.x, START_NAIL.y);
      await expect(page.locator('#adjust-panel')).toHaveAttribute('data-selected', '0');

      // Done: the board goes back to its play-time size and spot.
      await page.locator('#adjust').click();
      await expect(page.locator('#adjust-panel')).toBeHidden();
      await expectBoardClear(page, s.play);
    });
  });
}

test('the board follows a rotation from portrait to landscape and back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=54');
  const portrait = await expectBoardClear(page, 340);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await boardBox(page)).bottom).toBeLessThanOrEqual(390);
  const landscape = await expectBoardClear(page, 320);
  expect(landscape.right - landscape.left).toBeLessThan(portrait.right - portrait.left);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await boardBox(page)).right - (await boardBox(page)).left)
    .toBeCloseTo(portrait.right - portrait.left, 3);
});

test.describe('debug overlay', () => {
  test('is hidden for players, and D shows it, fitting the board round it', async ({ page }) => {
    await page.goto('/?seed=54');
    const debug = page.locator('#debug');
    // Still updating while hidden.
    await expect(debug).toContainText(/FPS \d+/);
    await expect(debug).toBeHidden();
    await page.keyboard.press('d');
    await expect(debug).toBeVisible();
    await expectBoardClear(page, 600);
    await page.keyboard.press('d');
    await expect(debug).toBeHidden();
  });

  test('shows from the start with ?debug or ?inplay', async ({ page }) => {
    await page.goto('/?debug');
    await expect(page.locator('#debug')).toBeVisible();
    await page.goto('/?inplay=0');
    await expect(page.locator('#debug')).toBeVisible();
  });
});
