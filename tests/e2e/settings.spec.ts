// M8: the settings. Jackpot odds, starting balls and volume, remembered
// across reloads; New game; play paused while the panel is open; and the
// form fields keeping their keys from the launch handle.

import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __started: number;
  }
}

const balls = (page: Page) => page.locator('#balls');
const panel = (page: Page) => page.locator('#settings-panel');
const openSettings = async (page: Page) => {
  await page.locator('#settings').click();
  await expect(panel(page)).toBeVisible();
};
const closeSettings = async (page: Page) => {
  await page.locator('#settings-done').click();
  await expect(panel(page)).toBeHidden();
};
const ballCount = async (page: Page) => Number(await balls(page).getAttribute('data-balls'));

test('the defaults: 1 in 99, 250 balls, full volume', async ({ page }) => {
  await page.goto('/?seed=54');
  await expect(balls(page)).toHaveAttribute('data-balls', '250');
  await expect(page.locator('#settings')).toHaveAttribute('aria-expanded', 'false');
  await openSettings(page);
  await expect(page.locator('#settings')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#setting-odds')).toHaveValue('99');
  await expect(page.locator('#setting-balls')).toHaveValue('250');
  await expect(page.locator('#setting-volume')).toHaveValue('100');
  await expect(page.locator('#setting-volume-value')).toHaveText('100%');
  await expect(page.locator('#setting-odds option')).toHaveText([
    '1 in 99',
    '1 in 199',
    '1 in 319',
  ]);
  await expect(page.locator('#setting-balls option')).toHaveText([
    '125 balls (¥500)',
    '250 balls (¥1,000)',
    '500 balls (¥2,000)',
    '1,250 balls (¥5,000)',
  ]);
  await expect(page.locator('#settings-note')).toBeHidden();
  // Escape closes it too.
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
});

test('starting balls apply from a new game, and every setting survives a reload', async ({
  page,
}) => {
  await page.goto('/?seed=54');
  await openSettings(page);
  await page.locator('#setting-balls').selectOption('500');
  await expect(page.locator('#settings-note')).toHaveText(
    'New games start with 500 balls (¥2,000).',
  );
  // Not mid-game: the tray is as it was.
  await expect(balls(page)).toHaveAttribute('data-balls', '250');
  await page.locator('#setting-odds').selectOption('319');
  await page.locator('#setting-volume').fill('40');
  await expect(page.locator('#setting-volume-value')).toHaveText('40%');
  await expect(panel(page)).toHaveAttribute('data-volume', '0.4');

  // Nothing launched yet, so one press starts the new game.
  await page.locator('#new-game').click();
  await expect(balls(page)).toHaveAttribute('data-balls', '500');
  await expect(page.locator('#settings-note')).toBeHidden();

  await page.reload();
  await expect(balls(page)).toHaveAttribute('data-balls', '500');
  await openSettings(page);
  await expect(page.locator('#setting-odds')).toHaveValue('319');
  await expect(page.locator('#setting-balls')).toHaveValue('500');
  await expect(page.locator('#setting-volume')).toHaveValue('40');
  await expect(panel(page)).toHaveAttribute('data-odds', '319');
});

test('play pauses while the settings are open, and a new game mid-game takes two presses', async ({
  page,
}) => {
  await page.goto('/?seed=54');
  await page.keyboard.down('Space');
  await expect.poll(() => ballCount(page), { timeout: 10_000 }).toBeLessThan(247);
  await openSettings(page);
  await expect(page.locator('#handle')).toBeHidden();
  await expect(page.locator('#mute')).toBeHidden();
  await expect(page.locator('#adjust')).toBeHidden();
  const paused = await ballCount(page);
  // Space is still held, but nothing fires: 2 s would launch three more.
  await page.waitForTimeout(2000);
  expect(await ballCount(page)).toBe(paused);

  await page.locator('#setting-balls').selectOption('125');
  await page.locator('#new-game').click();
  await expect(page.locator('#new-game')).toHaveText('Start over: press again');
  await expect(page.locator('#new-game')).toHaveAttribute('data-confirm', 'true');
  await expect(page.locator('#settings-note')).toHaveText(
    `This game's ${paused} balls go; the new one starts with 125.`,
  );
  expect(await ballCount(page)).toBe(paused);
  await page.locator('#new-game').click();
  await expect(balls(page)).toHaveAttribute('data-balls', '125');
  await expect(page.locator('#new-game')).toHaveText('New game');
  await expect(page.locator('#reel')).toHaveAttribute('data-spins', '0');

  // Closed again, play goes on in the new game: space is still held.
  await closeSettings(page);
  await expect(page.locator('#handle')).toBeVisible();
  await expect.poll(() => ballCount(page), { timeout: 10_000 }).toBeLessThan(125);
  await page.keyboard.up('Space');
});

test('arrow keys in a setting change the setting, not the handle', async ({ page }) => {
  await page.goto('/?seed=54');
  await expect(page.locator('#handle')).toHaveAttribute('data-power', '0.500');
  await openSettings(page);
  const volume = page.locator('#setting-volume');
  await volume.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(volume).toHaveValue('80');
  await expect(page.locator('#setting-volume-value')).toHaveText('80%');
  await page.locator('#setting-odds').focus();
  await page.keyboard.press('ArrowDown');
  await closeSettings(page);
  await expect(page.locator('#handle')).toHaveAttribute('data-power', '0.500');
  // Outside a form field the arrows turn the handle as before.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#handle')).toHaveAttribute('data-power', '0.480');
});

test('entering edit mode closes the settings, and their button hides while editing', async ({
  page,
}) => {
  await page.goto('/?seed=54');
  await openSettings(page);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#adjust-panel')).toBeVisible();
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('#settings')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#adjust-panel')).toBeHidden();
  await expect(page.locator('#settings')).toBeVisible();
  await expect(panel(page)).toBeHidden();
});

test.describe('volume', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__started = 0;
      for (const proto of [AudioScheduledSourceNode.prototype, AudioBufferSourceNode.prototype]) {
        const start = proto.start as (this: AudioScheduledSourceNode, ...args: unknown[]) => void;
        proto.start = function (this: AudioScheduledSourceNode, ...args: unknown[]) {
          window.__started += 1;
          start.apply(this, args);
        };
      }
    });
  });

  test('at 0 the game is silent; turned up, it sounds again', async ({ page }) => {
    const started = () => page.evaluate(() => window.__started);
    await page.goto('/?seed=54');
    await openSettings(page);
    await page.locator('#setting-volume').fill('0');
    await expect(page.locator('#setting-volume-value')).toHaveText('0%');
    await closeSettings(page);
    // The sound toggle still says on: volume and mute are separate.
    await expect(page.locator('#mute')).toHaveText('Sound on');
    await page.keyboard.down('Space');
    await expect.poll(() => ballCount(page), { timeout: 10_000 }).toBeLessThan(246);
    expect(await started()).toBe(0);
    await page.keyboard.up('Space');

    await openSettings(page);
    await page.locator('#setting-volume').fill('50');
    await closeSettings(page);
    await page.keyboard.down('Space');
    await expect.poll(started, { timeout: 10_000 }).toBeGreaterThan(5);
    await page.keyboard.up('Space');
  });
});
