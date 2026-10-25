// M6 acceptance: frame time stays under 8 ms with 30 balls in play.
//
// `?inplay=30` keeps 30 free balls in play (TableOptions.keepInPlay), and
// the debug overlay reports each frame's work time, sim steps plus drawing,
// over its last 120 frames (render/frametime.ts). The handle goes to the top
// so the launch lane never backs up and the board stays full. A CI runner
// with software rendering is a harsher machine than a mid-range laptop, so
// a pass here is a conservative reading of the budget.

import { expect, test, type Page } from '@playwright/test';

/** M6's frame budget. */
const BUDGET_MS = 8;

// A laptop's high-density screen: four times the pixels to draw at DPR 1.
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

interface FrameTime {
  frames: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  minBalls: number;
  meanBalls: number;
}

const frameTime = (page: Page): Promise<FrameTime> =>
  page.locator('#debug').evaluate((el: HTMLElement) => ({
    frames: Number(el.dataset['frameFrames'] ?? 0),
    meanMs: Number(el.dataset['frameMeanMs'] ?? NaN),
    p95Ms: Number(el.dataset['frameP95Ms'] ?? NaN),
    maxMs: Number(el.dataset['frameMaxMs'] ?? NaN),
    minBalls: Number(el.dataset['frameMinBalls'] ?? 0),
    meanBalls: Number(el.dataset['frameMeanBalls'] ?? 0),
  }));

test('frame time stays under 8 ms with 30 balls in play', async ({ page }, testInfo) => {
  await page.goto('/?seed=1&inplay=30');
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowUp');
  await expect(page.locator('#handle')).toHaveAttribute('data-power', '1.000');

  // A full window of 120 frames with the board full the whole time.
  let reading: FrameTime | undefined;
  await expect
    .poll(
      async () => {
        reading = await frameTime(page);
        return reading.frames === 120 && reading.minBalls >= 29 && reading.meanBalls >= 29.5;
      },
      { timeout: 20_000, intervals: [250] },
    )
    .toBe(true);
  // The tray is the player's: free balls never touch it.
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');

  testInfo.annotations.push({ type: 'frame time', description: JSON.stringify(reading) });
  console.log('frame time with 30 balls in play:', reading);
  expect(reading?.p95Ms).toBeLessThan(BUDGET_MS);
  expect(reading?.meanMs).toBeLessThan(BUDGET_MS / 2);

  await page.screenshot({ path: testInfo.outputPath('thirty-balls.png') });
});

test('without ?inplay no ball moves until the handle fires', async ({ page }) => {
  await page.goto('/?seed=1');
  await expect.poll(async () => (await frameTime(page)).frames).toBeGreaterThan(30);
  expect((await frameTime(page)).meanBalls).toBe(0);
});
