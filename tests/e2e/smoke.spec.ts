import { expect, test, type Page } from '@playwright/test';

/** Collect console errors and uncaught exceptions for the life of the page. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function simSteps(page: Page): Promise<number> {
  return Number(await page.locator('#debug').getAttribute('data-sim-steps'));
}

test('loads with no console errors and a full-viewport canvas', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  const canvas = page.locator('canvas#board');
  await expect(canvas).toBeVisible();

  const viewport = page.viewportSize();
  const box = await canvas.boundingBox();
  expect(box?.width).toBe(viewport?.width);
  expect(box?.height).toBe(viewport?.height);

  // Let a few overlay windows pass so any late error shows up.
  await expect(page.locator('#debug')).toContainText(/FPS \d+/);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('debug overlay shows FPS and sim steps per frame', async ({ page }) => {
  await page.goto('/');
  const debug = page.locator('#debug');
  await expect(debug).toContainText(/FPS \d+/);
  await expect(debug).toContainText(/steps\/frame \d+\.\d/);

  // The fixed-step loop is running: sim steps keep advancing.
  const before = await simSteps(page);
  await expect.poll(() => simSteps(page)).toBeGreaterThan(before);
});

test.describe('at devicePixelRatio 2', () => {
  test.use({ deviceScaleFactor: 2 });

  test('canvas backing store is 2x its CSS size and the context is scaled to match', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#debug')).toContainText(/FPS \d+/);
    const m = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('canvas#board');
      if (!c) throw new Error('no canvas');
      const t = c.getContext('2d')?.getTransform();
      return {
        dpr: window.devicePixelRatio,
        cssW: c.clientWidth,
        cssH: c.clientHeight,
        w: c.width,
        h: c.height,
        sx: t?.a,
        sy: t?.d,
      };
    });
    expect(m.dpr).toBe(2);
    expect(m.w).toBe(m.cssW * 2);
    expect(m.h).toBe(m.cssH * 2);
    expect(m.sx).toBe(2);
    expect(m.sy).toBe(2);
  });

  test('backing store follows a viewport resize', async ({ page }) => {
    await page.goto('/');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.querySelector('canvas')?.width)).toBe(780);
    await expect
      .poll(() => page.evaluate(() => document.querySelector('canvas')?.height))
      .toBe(1688);
  });
});

test('loop pauses while the tab is hidden and resumes when visible', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => simSteps(page)).toBeGreaterThan(0);

  // Headless Chromium has no real tab switching, so fake the visibility state
  // and fire the event the page listens for.
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (h ? 'hidden' : 'visible'),
      });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);

  await setHidden(true);
  const paused = await simSteps(page);
  await page.waitForTimeout(500);
  expect(await simSteps(page)).toBe(paused);

  await setHidden(false);
  await expect.poll(() => simSteps(page)).toBeGreaterThan(paused);
  // No catch-up burst: the first resumed frames step by frame time, not by the
  // 500 ms spent hidden (1000 steps at 1/2000 s).
  const resumedSteps = Number(await page.locator('#debug').getAttribute('data-steps-per-frame'));
  expect(resumedSteps).toBeLessThan(1000);
});
