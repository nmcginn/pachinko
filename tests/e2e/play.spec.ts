// M2: the launch handle and ball counter in the browser.

import { expect, test, type Page } from '@playwright/test';

const balls = async (page: Page) => Number(await page.locator('#balls').getAttribute('data-balls'));
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
  const left = await balls(page);
  expect(250 - left).toBeGreaterThanOrEqual(3);
  expect(250 - left).toBeLessThanOrEqual(6);
  await expect(page.locator('#balls')).toHaveText(`Balls ${left}`);
});

test('releasing fire stops launching, and launched balls drain out of play', async ({ page }) => {
  await page.keyboard.down('Space');
  await expect.poll(() => inPlay(page)).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  const left = await balls(page);
  // Every ball leaves through a pocket within a few seconds and is removed.
  await expect.poll(() => inPlay(page), { timeout: 15_000 }).toBe(0);
  expect(await balls(page)).toBe(left);
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
  // Released: the count stops dropping (wait out one auto-fire interval).
  const left = await balls(page);
  await page.waitForTimeout(1500);
  expect(await balls(page)).toBe(left);
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
