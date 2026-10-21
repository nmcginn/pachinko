// M6: no audio until the first user interaction, sound while playing, and
// the mute toggle. An init script wraps the page's AudioContext and counts
// what it makes, since a headless browser has no speakers to listen to.

import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __audio: { contexts: number; started: number; states: string[] };
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const audio = { contexts: 0, started: 0, states: [] as string[] };
    window.__audio = audio;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        audio.contexts += 1;
        audio.states.push(this.state);
      }
    };
    // Oscillators start through the base class; buffer sources (the rattle's noise) have their own start.
    for (const proto of [AudioScheduledSourceNode.prototype, AudioBufferSourceNode.prototype]) {
      const start = proto.start as (this: AudioScheduledSourceNode, ...args: unknown[]) => void;
      proto.start = function (this: AudioScheduledSourceNode, ...args: unknown[]) {
        audio.started += 1;
        start.apply(this, args);
      };
    }
  });
});

const audio = (page: Page) => page.evaluate(() => ({ ...window.__audio }));

test('M6 acceptance: no audio until the first interaction', async ({ page }) => {
  // Seed 54: the first shot at power 0.2 enters the start pocket.
  await page.goto('/?seed=54');
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
  // The game runs untouched for a while: no context may exist yet, and
  // nothing has started.
  await page.waitForTimeout(1500);
  expect(await audio(page)).toEqual({ contexts: 0, started: 0, states: [] });

  // The first key press unlocks: one context, made inside the gesture, so
  // the browser lets it run from the start.
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await audio(page)).contexts).toBe(1);
  expect((await audio(page)).states).toEqual(['running']);
  // Down to power 0.2 (from 0.5, one step already taken), then fire.
  for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.down('Space');
  // Rattles from the field, then the start pocket's chime and the reel.
  await expect
    .poll(async () => (await audio(page)).started, { timeout: 10_000 })
    .toBeGreaterThan(20);
  await page.keyboard.up('Space');
  // Only ever one context.
  expect((await audio(page)).contexts).toBe(1);
});

test('a click also unlocks, and muting stops new sound', async ({ page }) => {
  await page.goto('/');
  const mute = page.locator('#mute');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await expect(mute).toHaveText('Sound on');
  // Press the handle: the press unlocks and fires.
  const box = await page.locator('#handle').boundingBox();
  if (!box) throw new Error('no handle');
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await expect
    .poll(async () => (await audio(page)).started, { timeout: 10_000 })
    .toBeGreaterThan(5);
  expect((await audio(page)).contexts).toBe(1);

  // Mute with the M key while still firing: new voices stop.
  await page.keyboard.press('KeyM');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect(mute).toHaveText('Sound off');
  // A frame already drained may still start its voices; settle, then count.
  await page.waitForTimeout(200);
  const muted = (await audio(page)).started;
  await page.waitForTimeout(2000);
  expect((await audio(page)).started).toBe(muted);
  await page.mouse.up();

  // The button unmutes; the choice survives a reload.
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('KeyM');
  await page.reload();
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mute')).toHaveText('Sound off');
});

test('space on the focused mute button fires rather than toggling', async ({ page }) => {
  await page.goto('/');
  const mute = page.locator('#mute');
  await mute.focus();
  await page.keyboard.down('Space');
  await expect(page.locator('#handle')).toHaveClass(/held/);
  await page.keyboard.up('Space');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
});
