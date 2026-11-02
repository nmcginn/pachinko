// M6: haptics on a phone. An init script swaps navigator.vibrate for a
// recorder (headless Chromium has no motor), and the phone tests emulate a
// touch screen, which is what the vibration toggle and the buzzes need.
// The toggle lives in the settings panel (M8), which pauses play while open.

import { devices, expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __vibrations: number[][];
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const calls: number[][] = [];
    window.__vibrations = calls;
    Navigator.prototype.vibrate = function (pattern: number | Iterable<number>) {
      calls.push(typeof pattern === 'number' ? [pattern] : [...pattern]);
      return true;
    };
  });
});

const vibrations = (page: Page) => page.evaluate(() => window.__vibrations.map((p) => p.join(',')));

/** From the starting 0.5 down to 0.2, the classic board's best power, then hold fire. */
async function fireAtBestPower(page: Page): Promise<void> {
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('#handle')).toHaveAttribute('data-power', '0.200');
  await page.keyboard.down('Space');
}

test.describe('on a phone', () => {
  // Everything of the device but its browser type, which a describe block can't set.
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['Pixel 7'];
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

  test('buzzes for the start pocket and the reel, never before the first interaction', async ({
    page,
  }) => {
    // Seed 54: the first shot at power 0.2 enters the start pocket.
    await page.goto('/?seed=54');
    await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');

    // Untouched for a while: nothing buzzes.
    await page.waitForTimeout(1500);
    expect(await vibrations(page)).toEqual([]);

    // The toggle is in the settings, on.
    await page.locator('#settings').tap();
    const toggle = page.locator('#vibration');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('Vibration on');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#settings-done').tap();
    // Opening the panel buzzes for nothing.
    expect(await vibrations(page)).toEqual([]);

    await fireAtBestPower(page);
    // The start entry's pulse (20 ms), then a tap for each reel as it stops (10 ms).
    await expect.poll(() => vibrations(page), { timeout: 10_000 }).toContain('20');
    await expect.poll(() => vibrations(page), { timeout: 10_000 }).toContain('10');
    await page.keyboard.up('Space');
    for (const p of await vibrations(page)) expect(['10', '15', '20']).toContain(p);
  });

  test('the toggle switches it off, and the choice survives a reload', async ({ page }) => {
    await page.goto('/?seed=54');
    await page.locator('#settings').tap();
    const toggle = page.locator('#vibration');
    await expect(toggle).toBeVisible();
    // A tap on the button switches it off at once.
    await toggle.tap();
    await expect(toggle).toHaveText('Vibration off');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // Turning off stops any pattern in progress, which is a vibrate(0).
    expect(await vibrations(page)).toEqual(['0']);
    await page.locator('#settings-done').tap();

    await fireAtBestPower(page);
    // Long enough for the start entry and the whole spin.
    await expect(page.locator('#reel')).toHaveAttribute('data-spins', '1', { timeout: 15_000 });
    await page.keyboard.up('Space');
    expect(await vibrations(page)).toEqual(['0']);

    await page.reload();
    await page.locator('#settings').tap();
    await expect(page.locator('#vibration')).toHaveText('Vibration off');
    // The V key turns it back on.
    await page.keyboard.press('KeyV');
    await expect(page.locator('#vibration')).toHaveText('Vibration on');
  });
});

test('on a desktop: no toggle and no buzzing', async ({ page }) => {
  await page.goto('/?seed=54');
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
  // Not in the settings either.
  await page.locator('#settings').click();
  await expect(page.locator('#settings-panel')).toBeVisible();
  await expect(page.locator('#vibration')).toBeHidden();
  await expect(page.locator('#setting-vibration')).toBeHidden();
  await page.locator('#settings-done').click();
  await fireAtBestPower(page);
  await expect(page.locator('#reel')).toHaveAttribute('data-spins', '1', { timeout: 15_000 });
  await page.keyboard.up('Space');
  // V does nothing either.
  await page.keyboard.press('KeyV');
  await expect(page.locator('#vibration')).toBeHidden();
  expect(await vibrations(page)).toEqual([]);
});
