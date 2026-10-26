// M7: nail adjustment in the browser. Edit mode pauses play, a click
// selects a nail, the arrow keys and the panel's buttons nudge it 0.1 mm,
// and a move into another nail is refused with the reason.

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

const panel = (page: Page) => page.locator('#adjust-panel');
const counts = (page: Page) =>
  page.locator('#balls').evaluate((el: HTMLElement) => ({
    launched: Number(el.dataset['launched']),
    inPlay: Number(el.dataset['inPlay']),
    starts: Number(el.dataset['starts']),
    tulips: Number(el.dataset['tulips']),
  }));

/** Click on the board at (x, y) in metres, through the same fit the page draws with. */
async function clickBoard(page: Page, x: number, y: number): Promise<void> {
  const size = page.viewportSize();
  if (!size) throw new Error('no viewport');
  const bv = fitBoard(size.width, size.height, BOARD_W_M, BOARD_H_M, undefined, REEL_BAND_PX);
  await page.mouse.click(bv.ox + x * bv.scale, bv.oy - y * bv.scale);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?seed=54');
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
});

test('E opens the panel; a click selects a nail; arrows and buttons nudge it 0.1 mm', async ({
  page,
}) => {
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('#adjust')).toHaveText('Adjust nails');
  await page.keyboard.press('e');
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('#adjust')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#adjust-selection')).toHaveText('Click or tap a nail to select it');

  const right = START_NAILS[1];
  await clickBoard(page, right.x + 0.0005, right.y);
  await expect(panel(page)).toHaveAttribute('data-selected', '1');
  await expect(page.locator('#adjust-selection')).toHaveText(
    'Nail 1 at 257.3, 178.0 mm, not moved',
  );

  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(panel(page)).toHaveAttribute('data-offset', '3,0');
  await expect(page.locator('#adjust-selection')).toHaveText(
    'Nail 1 at 257.6, 178.0 mm, moved +0.3, 0.0 mm',
  );
  await page.keyboard.press('Shift+ArrowUp');
  await expect(panel(page)).toHaveAttribute('data-offset', '3,10');

  await page.getByRole('button', { name: 'Nudge left 0.1 mm' }).click();
  await page.getByRole('button', { name: 'Nudge down 0.1 mm' }).click();
  await expect(panel(page)).toHaveAttribute('data-offset', '2,9');
  await expect(panel(page)).toHaveAttribute('data-moved', '1');

  await page.getByRole('button', { name: 'Reset nail' }).click();
  await expect(panel(page)).toHaveAttribute('data-offset', '0,0');
  await expect(panel(page)).toHaveAttribute('data-moved', '0');

  // The arrows nudged the nail, not the handle.
  await expect(page.locator('#handle')).toHaveAttribute('data-power', '0.500');
  await page.getByRole('button', { name: 'Done adjusting' }).click();
  await expect(panel(page)).toBeHidden();
});

test('a nudge into the next nail is refused, with the reason', async ({ page }) => {
  await page.keyboard.press('e');
  const left = START_NAILS[0];
  await clickBoard(page, left.x, left.y);
  await expect(panel(page)).toHaveAttribute('data-selected', '0');
  // 12.5 mm of gap to the right start nail: 12 mm goes, the 13th mm doesn't.
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect(panel(page)).toHaveAttribute('data-offset', '120,0');
  await expect(page.locator('#adjust-problem')).toBeHidden();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('#adjust-problem')).toContainText(
    "Nail 0 can't go there: (0.2558, 0.178) overlaps nails[1] at (0.2573, 0.178)",
  );
  await expect(panel(page)).toHaveAttribute('data-offset', '120,0');
  // The next good move clears it.
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#adjust-problem')).toBeHidden();
  await expect(panel(page)).toHaveAttribute('data-offset', '119,0');
});

test('play pauses while adjusting: balls wait, the handle does nothing, and play resumes after', async ({
  page,
}) => {
  // One ball up the lane, then straight into edit mode.
  await page.keyboard.down('Space');
  await expect.poll(async () => (await counts(page)).launched).toBe(1);
  await page.keyboard.up('Space');
  await page.keyboard.press('e');
  await expect(panel(page)).toBeVisible();
  const paused = await counts(page);
  // A ball is in flight for a few seconds; paused, it stays put for longer.
  await page.waitForTimeout(1000);
  await page.keyboard.down('Space');
  await page.waitForTimeout(3000);
  await page.keyboard.up('Space');
  expect(await counts(page)).toEqual(paused);
  await expect(page.locator('#handle')).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  // The waiting balls carry on and leave; then the handle fires again.
  await expect.poll(async () => (await counts(page)).inPlay, { timeout: 15_000 }).toBe(0);
  await page.keyboard.down('Space');
  await expect.poll(async () => (await counts(page)).launched).toBeGreaterThan(paused.launched);
  await page.keyboard.up('Space');
});
