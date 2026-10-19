// M2: the launch handle and ball counter in the browser.

import { expect, test, type Page } from '@playwright/test';

const balls = async (page: Page) => Number(await page.locator('#balls').getAttribute('data-balls'));
/** The counter's numbers, read together so a payout can't land between two reads. */
const counts = (page: Page) =>
  page.locator('#balls').evaluate((el: HTMLElement) => ({
    balls: Number(el.dataset['balls']),
    starts: Number(el.dataset['starts']),
    launched: Number(el.dataset['launched']),
  }));
const inPlay = async (page: Page) =>
  Number(await page.locator('#balls').getAttribute('data-in-play'));
const power = async (page: Page) =>
  Number(await page.locator('#handle').getAttribute('data-power'));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
});

test('M2 acceptance: holding fire for 3 s makes the ball counter drop', async ({ page }) => {
  await expect(page.locator('#balls')).toHaveText('Balls 250');
  await page.keyboard.down('Space');
  await page.waitForTimeout(3000);
  await page.keyboard.up('Space');
  // 100 a minute is one every 0.6 s, first one at once: 5 or 6 in 3 s of
  // sim time. A stalled frame drops time, so allow fewer, never more.
  const { balls: left, launched, starts } = await counts(page);
  expect(launched).toBeGreaterThanOrEqual(3);
  expect(launched).toBeLessThanOrEqual(6);
  // One ball per shot, and 3 back for any that already reached the start pocket.
  expect(left).toBe(250 - launched + 3 * starts);
  expect(left).toBeLessThan(250);
  await expect(page.locator('#balls')).toHaveText(`Balls ${left}`);
});

test('releasing fire stops launching, and launched balls drain out of play', async ({ page }) => {
  await page.keyboard.down('Space');
  await expect.poll(() => inPlay(page)).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  const before = await counts(page);
  // Every ball leaves through a pocket within a few seconds and is removed.
  await expect.poll(() => inPlay(page), { timeout: 15_000 }).toBe(0);
  // Nothing more was launched; only start-pocket payouts (3 each) came back.
  const after = await counts(page);
  expect(after.launched).toBe(before.launched);
  expect(after.balls).toBe(before.balls + 3 * (after.starts - before.starts));
});

test('arrow keys adjust the handle power', async ({ page }) => {
  expect(await power(page)).toBeCloseTo(0.5, 3);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
  await expect.poll(() => power(page)).toBeCloseTo(0.6, 3);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => power(page)).toBeCloseTo(0.58, 3);
  await expect(page.locator('#handle-power')).toHaveText('58%');
});

test('pressing and turning the dial sets power and fires while held', async ({ page }) => {
  const box = await page.locator('#handle').boundingBox();
  if (!box) throw new Error('no handle');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = box.width * 0.4;

  // Press at 3 o'clock: 90° clockwise from up is power (90 + 135) / 270.
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  await expect.poll(() => power(page)).toBeCloseTo(225 / 270, 2);
  await expect(page.locator('#handle')).toHaveClass(/held/);
  await expect.poll(() => balls(page)).toBeLessThan(250);

  // Turn to 12 o'clock while held: power 0.5.
  await page.mouse.move(cx, cy - r, { steps: 5 });
  await expect.poll(() => power(page)).toBeCloseTo(0.5, 2);

  await page.mouse.up();
  await expect(page.locator('#handle')).not.toHaveClass(/held/);
  // Released: launching stops (wait out one auto-fire interval).
  const { launched } = await counts(page);
  await page.waitForTimeout(1500);
  expect((await counts(page)).launched).toBe(launched);
});

test('letting go of the dial does not cancel a held space bar', async ({ page }) => {
  const box = await page.locator('#handle').boundingBox();
  if (!box) throw new Error('no handle');
  await page.keyboard.down('Space');
  await page.mouse.click(box.x + box.width / 2, box.y + 10);
  await expect(page.locator('#handle')).toHaveClass(/held/);
  const before = await balls(page);
  await expect.poll(() => balls(page), { timeout: 3000 }).toBeLessThan(before);
  await page.keyboard.up('Space');
  await expect(page.locator('#handle')).not.toHaveClass(/held/);
});

test('M3: a start-pocket entry pays 3 balls into the tray', async ({ page }) => {
  // Seed 8 at power 0: the 3rd shot enters the start pocket (each shot's
  // speed comes from the seed alone, and balls don't interact until M5, so
  // frame timing can't change which one).
  await page.goto('/?seed=8');
  // Well past the bottom of the range, so power clamps to exactly 0.
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(() => power(page)).toBe(0);
  await page.keyboard.down('Space');
  await expect.poll(async () => (await counts(page)).starts, { timeout: 10_000 }).toBe(1);
  await page.keyboard.up('Space');
  const { balls: left, launched, starts } = await counts(page);
  expect(launched).toBeGreaterThanOrEqual(3);
  expect(left).toBe(250 - launched + 3 * starts);
});
