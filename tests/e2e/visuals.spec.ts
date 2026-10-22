// M6 visuals: the balls' specular highlight, nail glints, and the jackpot's
// screen flash and reel celebration, which respects reduced motion.
//
// The jackpot tests install Playwright's fake clock and step it in short
// slices, as jackpot.spec.ts does, so the flash's 0.3 s pulses can't be
// stepped over.

import { expect, test, type Page } from '@playwright/test';

/** Pixels on the board canvas that are pure white: only the balls' specular highlights are. */
const whitePixels = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const board = document.querySelector<HTMLCanvasElement>('canvas#board');
    if (!board) throw new Error('no canvas');
    const copy = document.createElement('canvas');
    copy.width = board.width;
    copy.height = board.height;
    const ctx = copy.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(board, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) >= 254 && (data[i + 1] ?? 0) >= 254 && (data[i + 2] ?? 0) >= 254) n++;
    }
    return n;
  });

/** Set the handle to 0.2, the classic board's best power: to the bottom, then 10 key steps up. */
async function bestPower(page: Page): Promise<void> {
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
  await expect(page.locator('#handle')).toHaveAttribute('data-power', '0.200');
}

test('balls in flight carry a specular highlight, and struck nails glint', async ({ page }) => {
  await page.goto('/?seed=54');
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
  // Nothing on an empty board is pure white, and no nail glints.
  expect(await whitePixels(page)).toBe(0);
  await expect(page.locator('canvas#board')).toHaveAttribute('data-glints', '0');

  await bestPower(page);
  await page.keyboard.down('Space');
  // Balls in the field: their highlights show.
  await expect.poll(() => whitePixels(page), { timeout: 10_000 }).toBeGreaterThan(0);
  // Balls bounce down the nail field: nails glint as they're struck.
  await expect
    .poll(async () => Number(await page.locator('canvas#board').getAttribute('data-glints')), {
      timeout: 10_000,
      intervals: [16],
    })
    .toBeGreaterThan(0);
  await page.keyboard.up('Space');
});

interface Celebration {
  steps: number;
  celebrating: string;
  flash: number;
  phase: string;
}

const celebration = (page: Page): Promise<Celebration> =>
  page.evaluate(() => ({
    steps: Number(document.querySelector<HTMLElement>('#debug')?.dataset['simSteps']),
    celebrating: document.querySelector<HTMLElement>('#reel')?.dataset['celebrating'] ?? '',
    flash: Number(document.querySelector<HTMLElement>('#flash')?.dataset['level']),
    phase: document.querySelector<HTMLElement>('#reel')?.dataset['phase'] ?? '',
  }));

/** Force a jackpot and step through it in 25 ms slices until round 1 opens; every slice's state. */
async function playJackpotIntro(page: Page): Promise<Celebration[]> {
  await page.keyboard.press('KeyJ');
  const trace: Celebration[] = [];
  // The 5 s spin, then 2 s before round 1, and some slack.
  for (let t = 0; t < 9000; t += 25) {
    await page.clock.runFor(25);
    const state = await celebration(page);
    trace.push(state);
    if (state.phase === 'round') break;
  }
  return trace;
}

test.describe('the jackpot celebration', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test('flashes the screen and celebrates on the reel until round 1 opens', async ({ page }) => {
    await page.goto('/?seed=1');
    await page.clock.runFor(200);
    await expect(page.locator('#flash')).toHaveAttribute('data-level', '0');
    await expect(page.locator('#reel')).toHaveAttribute('data-celebrating', 'false');

    const trace = await playJackpotIntro(page);
    const during = trace.filter((s) => s.celebrating === 'true');
    // 2 s of sim time (ROUND_INTERVAL_S at 2000 steps a second), give or take a slice.
    const first = during[0];
    const last = during.at(-1);
    expect(first && last && last.steps - first.steps).toBeGreaterThan(3800);
    expect(first && last && last.steps - first.steps).toBeLessThanOrEqual(4000);
    expect(during.every((s) => s.phase === 'interval')).toBe(true);
    // The flash goes bright early in it, then dark again well before round 1.
    expect(Math.max(...during.map((s) => s.flash))).toBeGreaterThan(0.3);
    expect(during.slice(-20).every((s) => s.flash === 0)).toBe(true);
    // No flash outside the celebration.
    expect(trace.filter((s) => s.celebrating !== 'true').every((s) => s.flash === 0)).toBe(true);
    // Once the round opens the celebration is over.
    expect(trace.at(-1)).toMatchObject({ phase: 'round', celebrating: 'false', flash: 0 });
    await expect(page.locator('#reel')).not.toHaveClass(/celebrate/);
  });

  test('never flashes under prefers-reduced-motion, and the reel celebrates still', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?seed=1');
    await page.clock.runFor(200);
    await page.keyboard.press('KeyJ');
    await page.clock.runFor(5100);
    await expect(page.locator('#reel')).toHaveClass(/celebrate/);
    const still = await page
      .locator('#reel .reel-digit')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(still).toBe('none');

    // Play the rest of the intro: no flash at any point.
    const trace = await playJackpotIntro(page);
    expect(trace.every((s) => s.flash === 0)).toBe(true);
  });
});
