// M8: one-handed play on a phone, as far as an emulated phone can show it.
// The handle is driven by real touch events from one finger (CDP
// Input.dispatchTouchEvent, which goes through the browser's gesture
// handling the way a thumb does, unlike page.mouse or a synthetic
// PointerEvent): press, turn to the best power, hold, slide off the handle,
// lift. Whether it is comfortable in a hand is for a person on a real phone
// (PLAN.md, "Open questions for the maintainer").

import { devices, expect, test, type CDPSession, type Page } from '@playwright/test';
import { powerToDialAngleDeg } from '../../src/input/launcher';

const launched = async (page: Page) =>
  Number(await page.locator('#balls').getAttribute('data-launched'));
const power = async (page: Page) =>
  Number(await page.locator('#handle').getAttribute('data-power'));

/** One finger, id 1, on the touch screen. */
function finger(cdp: CDPSession) {
  const at = (type: 'touchStart' | 'touchMove', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x, y, id: 1 }] });
  return {
    down: (x: number, y: number) => at('touchStart', x, y),
    move: (x: number, y: number) => at('touchMove', x, y),
    up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    cancel: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }),
  };
}

/** A point `r` px from the handle's centre, `deg` clockwise from up. */
async function onDial(page: Page) {
  const box = await page.locator('#handle').boundingBox();
  if (!box) throw new Error('no handle');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return (deg: number, r = box.width * 0.4) => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;
  };
}

/** Records whether the page ever scrolled or zoomed, and any context menu let through. */
async function watchPage(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __moved: string[] };
    w.__moved = [];
    window.addEventListener('scroll', () => w.__moved.push('scroll'));
    window.visualViewport?.addEventListener('resize', () => w.__moved.push('zoom'));
    window.addEventListener('contextmenu', (e) => {
      if (!e.defaultPrevented) w.__moved.push('contextmenu');
    });
  });
}
const pageMoves = (page: Page) =>
  page.evaluate(() => ({
    events: (window as unknown as { __moved: string[] }).__moved,
    scrollY: window.scrollY,
    scale: window.visualViewport?.scale ?? 1,
  }));

const PHONES = [
  { name: 'Pixel 7', device: devices['Pixel 7'] },
  { name: 'iPhone SE', device: devices['iPhone SE'] },
] as const;

for (const { name, device } of PHONES) {
  test.describe(`one-handed on a ${name}`, () => {
    // Everything of the device but its browser type, which a describe block can't set.
    const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = device;
    test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

    test.beforeEach(async ({ page }) => {
      // Seed 1: no start or tulip entry for a hold of 1 to 4 s (play.spec.ts).
      await page.goto('/?seed=1');
      await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
      await watchPage(page);
    });

    test('one finger presses the handle, turns it to the best power, fires, slides off and lifts', async ({
      page,
    }) => {
      const at = await onDial(page);
      const thumb = finger(await page.context().newCDPSession(page));

      // Press at 12 o'clock: power 0.5, and the handle holds fire.
      await thumb.down(...at(0));
      await expect(page.locator('#handle')).toHaveClass(/held/);
      await expect.poll(() => power(page)).toBeCloseTo(0.5, 2);

      // Turn back to the classic board's best power, 0.2, without lifting.
      const best = powerToDialAngleDeg(0.2);
      for (let i = 1; i <= 9; i++) await thumb.move(...at((best * i) / 9));
      await expect.poll(() => power(page)).toBeCloseTo(0.2, 2);
      await expect(page.locator('#handle-power')).toHaveText('20%');

      // Held still: it keeps firing (100 a minute) and the counter drops.
      await expect.poll(() => launched(page), { timeout: 5000 }).toBeGreaterThanOrEqual(3);
      await expect.poll(() => page.locator('#balls').getAttribute('data-balls')).not.toBe('250');

      // The thumb slides off the handle, out over the board, on the same
      // line from its centre: still held, and the power stays where it was.
      for (let r = 80; r <= 240; r += 40) await thumb.move(...at(best, r));
      await expect(page.locator('#handle')).toHaveClass(/held/);
      expect(await power(page)).toBeCloseTo(0.2, 2);
      const offHandle = await launched(page);
      await expect.poll(() => launched(page), { timeout: 3000 }).toBeGreaterThan(offHandle);

      // Lifted off the board, not the handle: it lets go, and firing stops.
      await thumb.up();
      await expect(page.locator('#handle')).not.toHaveClass(/held/);
      const lifted = await launched(page);
      await page.waitForTimeout(1500);
      expect(await launched(page)).toBe(lifted);

      // Through all of it the page stayed put: no scroll, no zoom, no menu.
      expect(await pageMoves(page)).toEqual({ events: [], scrollY: 0, scale: 1 });
    });

    test('a cancelled touch lets go of the handle', async ({ page }) => {
      const at = await onDial(page);
      const thumb = finger(await page.context().newCDPSession(page));
      await thumb.down(...at(0));
      await expect(page.locator('#handle')).toHaveClass(/held/);
      await thumb.cancel();
      await expect(page.locator('#handle')).not.toHaveClass(/held/);
    });

    test('a long press on the handle opens no context menu', async ({ page }) => {
      // Android's browsers send contextmenu for a long press; emulation
      // doesn't, so send the event the handle would get.
      const opened = await page
        .locator('#handle')
        .evaluate((el) =>
          el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
        );
      expect(opened).toBe(false);
      expect((await pageMoves(page)).events).toEqual([]);
    });
  });
}
