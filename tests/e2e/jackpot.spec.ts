// M4: the reel and a full jackpot in the browser.
//
// A jackpot takes over five minutes of game time (5 s spin, then ten rounds
// of up to 30 s each, 2 s apart), so these tests install Playwright's fake
// clock and fast-forward it. The frame loop runs on requestAnimationFrame
// timestamps, which the fake clock drives, so the game runs exactly as it
// would in real time, only faster.

import { expect, test, type Page } from '@playwright/test';

interface ReelState {
  phase: string;
  round: number;
  entries: number;
  holds: number;
  spins: number;
  jackpots: number;
  roundsPlayed: number;
  digits: string;
}

const reel = (page: Page): Promise<ReelState> =>
  page.locator('#reel').evaluate((el: HTMLElement) => ({
    phase: el.dataset['phase'] ?? '',
    round: Number(el.dataset['round']),
    entries: Number(el.dataset['entries']),
    holds: Number(el.dataset['holds']),
    spins: Number(el.dataset['spins']),
    jackpots: Number(el.dataset['jackpots']),
    roundsPlayed: Number(el.dataset['roundsPlayed']),
    digits: el.dataset['digits'] ?? '',
  }));

/** The counter's numbers, read together so a payout can't land between two reads. */
const counts = (page: Page) =>
  page.locator('#balls').evaluate((el: HTMLElement) => ({
    balls: Number(el.dataset['balls']),
    starts: Number(el.dataset['starts']),
    attacker: Number(el.dataset['attacker']),
    fouls: Number(el.dataset['fouls']),
    launched: Number(el.dataset['launched']),
  }));

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.goto('/?seed=58');
  await page.clock.runFor(200);
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
});

test('the reel panel starts idle, showing 000 and no holds', async ({ page }) => {
  await expect(page.locator('#reel')).toBeVisible();
  expect(await reel(page)).toMatchObject({ phase: 'idle', digits: '000', holds: 0, spins: 0 });
  await expect(page.locator('.reel-digit')).toHaveText(['0', '0', '0']);
  await expect(page.locator('.reel-hold.lit')).toHaveCount(0);
});

test('M4 acceptance: the forced-jackpot key plays a full 10-round sequence', async ({ page }) => {
  test.setTimeout(240_000);
  // Fire at power 0, the classic board's best for the middle of the field,
  // so the attacker takes balls and some rounds can fill by count.
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.down('Space');
  await page.keyboard.press('KeyJ');

  const opened: number[] = [];
  const closed: number[] = [];
  let wasOpen = false;
  let jackpotDigits = '';
  let state = await reel(page);
  // Far more than a jackpot needs: 5 s + 10 × (2 s + 30 s), plus any held spin ahead of it.
  for (let s = 0; s < 400 && state.roundsPlayed < 10; s++) {
    await page.clock.runFor(1000);
    state = await reel(page);
    const open = state.phase === 'round';
    if (state.jackpots === 1 && !jackpotDigits) jackpotDigits = state.digits;
    if (open && !wasOpen) opened.push(state.round);
    if (!open && wasOpen) closed.push(state.roundsPlayed);
    wasOpen = open;
  }
  await page.keyboard.up('Space');

  expect(state.jackpots).toBe(1);
  expect(state.roundsPlayed).toBe(10);
  // Each round opened once, in order, and closed again.
  expect(opened).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(closed).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(state.phase).not.toBe('round');
  // The reel stopped on three of a kind. (Spins held during the rounds may be spinning now.)
  expect(jackpotDigits).toMatch(/^(\d)\1\1$/);

  // Every ball is accounted for: each attacker entry paid 15, each start 3, fouls came back.
  const c = await counts(page);
  expect(c.attacker).toBeGreaterThan(10);
  expect(c.balls).toBe(250 - c.launched + 3 * c.starts + 15 * c.attacker + c.fouls);
});

test('start-pocket entries spin the reel, and held spins light the hold lamps', async ({
  page,
}) => {
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.down('Space');
  // Seed 58 at power 0: start-pocket entries at 1.6 s and 3.7 s of sim time,
  // the second while the first still spins. (Seed 8 did this until balls
  // collided, M5: a collision now sends its second entry down the out-hole.)
  await expect
    .poll(async () => {
      await page.clock.runFor(250);
      return (await counts(page)).starts;
    })
    .toBeGreaterThan(0);
  // The first entry starts spinning at once, so its digits blur until the reels stop.
  await expect.poll(async () => (await reel(page)).phase).toBe('spinning');
  await expect(page.locator('.reel-digit.spinning')).not.toHaveCount(0);
  // Keep firing until a second entry arrives while the first still spins: it is held.
  await expect
    .poll(async () => {
      await page.clock.runFor(250);
      return (await reel(page)).holds;
    })
    .toBeGreaterThan(0);
  const held = (await reel(page)).holds;
  await expect(page.locator('.reel-hold.lit')).toHaveCount(held);
  await page.keyboard.up('Space');
  // Every held spin plays out, 5 s each, and the reel comes to rest.
  await expect
    .poll(
      async () => {
        await page.clock.runFor(1000);
        return (await reel(page)).phase;
      },
      { timeout: 30_000 },
    )
    .toBe('idle');
  const state = await reel(page);
  expect(state.spins).toBeGreaterThan(held);
  expect(state.digits).toMatch(/^\d{3}$/);
  await expect(page.locator('.reel-hold.lit')).toHaveCount(0);
  await expect(page.locator('.reel-digit')).toHaveText(state.digits.split(''));
});
