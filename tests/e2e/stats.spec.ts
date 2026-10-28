// M7: the live stats in the adjust panel. A Web Worker measures spins per
// ¥1000 while editing; moving the two start nails outward raises the start
// rate over the board as loaded (M7's acceptance), and putting them back
// shows the loaded board's numbers again straight away.

import { expect, test, type Page } from '@playwright/test';
import { fitBoard } from '../../src/render/board';
import { REEL_BAND_PX } from '../../src/render/reel';

/** The classic board's size and its two start nails (boards/classic.json nails[0], nails[1]). */
const BOARD_W_M = 0.5;
const BOARD_H_M = 0.53;
const START_NAILS = [
  { x: 0.2428, y: 0.178 },
  { x: 0.2573, y: 0.178 },
] as const;

const stats = (page: Page) => page.locator('#adjust-stats');
const numbers = (page: Page) =>
  stats(page).evaluate((el: HTMLElement) => ({
    balls: Number(el.dataset['balls']),
    spins: Number(el.dataset['spins']),
    baselineBalls: Number(el.dataset['baselineBalls']),
    baselineSpins: Number(el.dataset['baselineSpins']),
  }));

async function clickBoard(page: Page, x: number, y: number): Promise<void> {
  const size = page.viewportSize();
  if (!size) throw new Error('no viewport');
  const bv = fitBoard(size.width, size.height, BOARD_W_M, BOARD_H_M, undefined, REEL_BAND_PX);
  await page.mouse.click(bv.ox + x * bv.scale, bv.oy - y * bv.scale);
}

test('moving the start nails outward raises the start rate in the live stats', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?seed=54');
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
  // The handle to the classic board's best power, 0.2: fifteen 0.02 steps down from 0.5.
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('#handle')).toHaveAttribute('data-power', '0.200');

  await page.keyboard.press('e');
  await expect(stats(page)).toBeVisible();
  await expect(page.locator('#stats-title')).toHaveText('Spins per ¥1000 at 20% power');
  await expect(stats(page)).toHaveAttribute('data-power', '0.200');
  // The loaded board measures on its own first.
  await expect(page.locator('#stats-current')).toContainText('Board as loaded:');
  await expect
    .poll(async () => (await numbers(page)).balls, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1000);
  await expect(page.locator('#stats-baseline')).toBeHidden();

  // Both start nails 1 mm outward.
  await clickBoard(page, START_NAILS[0].x, START_NAILS[0].y);
  await expect(page.locator('#adjust-panel')).toHaveAttribute('data-selected', '0');
  await page.keyboard.press('Shift+ArrowLeft');
  await clickBoard(page, START_NAILS[1].x, START_NAILS[1].y);
  await expect(page.locator('#adjust-panel')).toHaveAttribute('data-selected', '1');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('#adjust-panel')).toHaveAttribute('data-moved', '2');
  await expect(page.locator('#stats-current')).toContainText('This board:');
  await expect(page.locator('#stats-baseline')).toContainText('As loaded:');

  // 2000 balls on each: 28.88 against 21.88 headless (tests/game/livestats.test.ts).
  await expect
    .poll(async () => Math.min((await numbers(page)).balls, (await numbers(page)).baselineBalls), {
      timeout: 60_000,
    })
    .toBeGreaterThanOrEqual(2000);
  const after = await numbers(page);
  expect(after.spins).toBeGreaterThan(after.baselineSpins);
  await expect(page.locator('#stats-change')).toHaveText(/^Change: \+\d+\.\d$/);

  // Both back: the loaded board's numbers, from where it had got to.
  await page.getByRole('button', { name: 'Reset nail' }).click();
  await clickBoard(page, START_NAILS[0].x, START_NAILS[0].y);
  await page.getByRole('button', { name: 'Reset nail' }).click();
  await expect(page.locator('#adjust-panel')).toHaveAttribute('data-moved', '0');
  await expect(page.locator('#stats-current')).toContainText('Board as loaded:');
  await expect(page.locator('#stats-baseline')).toBeHidden();
  const back = await numbers(page);
  expect(back.balls).toBeGreaterThanOrEqual(after.baselineBalls);
  await expect(page.locator('#stats-error')).toBeHidden();
});
