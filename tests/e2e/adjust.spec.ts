// M7: nail adjustment in the browser. Edit mode pauses play, a click
// selects a nail, the arrow keys and the panel's buttons nudge it 0.1 mm
// or, in bend mode, lean it 0.5°, and a move into another nail is refused
// with the reason.

import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { clickBoard } from './boardview';

/** The classic board's two start nails (boards/classic.json nails[0], nails[1]). */
const START_NAILS = [
  { x: 0.2428, y: 0.178 },
  { x: 0.2573, y: 0.178 },
] as const;

const panel = (page: Page) => page.locator('#adjust-panel');
const counts = (page: Page) =>
  page.locator('#balls').evaluate((el: HTMLElement) => ({
    launched: Number(el.dataset['launched']),
    inPlay: Number(el.dataset['inPlay']),
    starts: Number(el.dataset['starts']),
    tulips: Number(el.dataset['tulips']),
  }));

test.beforeEach(async ({ page }) => {
  await page.goto('/?seed=54');
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
});

test('E opens the panel; a click selects a nail; arrows and buttons nudge it 0.1 mm', async ({
  page,
}) => {
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('#adjust')).toHaveText('Adjust nails');
  await page.keyboard.press('e');
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('#adjust')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#adjust-selection')).toHaveText('Tap a nail, or use Select (S)');

  const right = START_NAILS[1];
  await clickBoard(page, right.x + 0.0005, right.y);
  await expect(panel(page)).toHaveAttribute('data-selected', '1');
  await expect(page.locator('#adjust-selection')).toHaveText(
    'Nail 1 at 257.3, 178.0 mm, not moved',
  );

  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(panel(page)).toHaveAttribute('data-offset', '3,0');
  await expect(page.locator('#adjust-selection')).toHaveText(
    'Nail 1 at 257.6, 178.0 mm, nudged +0.3, 0.0 mm',
  );
  await page.keyboard.press('Shift+ArrowUp');
  await expect(panel(page)).toHaveAttribute('data-offset', '3,10');

  await page.getByRole('button', { name: 'Nudge left 0.1 mm' }).click();
  await page.getByRole('button', { name: 'Nudge down 0.1 mm' }).click();
  await expect(panel(page)).toHaveAttribute('data-offset', '2,9');
  await expect(panel(page)).toHaveAttribute('data-moved', '1');

  await page.getByRole('button', { name: 'Reset nail' }).click();
  await expect(panel(page)).toHaveAttribute('data-offset', '0,0');
  await expect(panel(page)).toHaveAttribute('data-moved', '0');

  // The arrows nudged the nail, not the handle.
  await expect(page.locator('#handle')).toHaveAttribute('data-power', '0.500');
  await page.getByRole('button', { name: 'Done adjusting' }).click();
  await expect(panel(page)).toBeHidden();
});

test('bend mode: B or the Bend button, and the arrows lean the nail 0.5° a step', async ({
  page,
}) => {
  await page.keyboard.press('e');
  await expect(panel(page)).toHaveAttribute('data-mode', 'nudge');
  await expect(page.locator('#mode-nudge')).toHaveAttribute('aria-pressed', 'true');
  const left = START_NAILS[0];
  await clickBoard(page, left.x, left.y);
  await expect(panel(page)).toHaveAttribute('data-selected', '0');

  await page.keyboard.press('b');
  await expect(panel(page)).toHaveAttribute('data-mode', 'bend');
  await expect(page.locator('#mode-bend')).toHaveAttribute('aria-pressed', 'true');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await expect(panel(page)).toHaveAttribute('data-lean', '-3,0');
  // 1.5° is 0.144 mm: 242.8 becomes 242.656, shown as 242.7.
  await expect(page.locator('#adjust-selection')).toHaveText(
    'Nail 0 at 242.7, 178.0 mm, leaning 1.5° left',
  );
  await page.keyboard.press('Shift+ArrowUp');
  await expect(panel(page)).toHaveAttribute('data-lean', '-3,5');
  await page.getByRole('button', { name: 'Lean right 0.5°' }).click();
  await expect(panel(page)).toHaveAttribute('data-lean', '-2,5');
  await expect(page.locator('#adjust-selection')).toHaveText(
    'Nail 0 at 242.7, 178.2 mm, leaning 1.0° left, 2.5° up',
  );
  await expect(panel(page)).toHaveAttribute('data-offset', '0,0');
  await expect(panel(page)).toHaveAttribute('data-moved', '1');

  // Six big leans up reach the 15° limit; the seventh is refused.
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowUp');
  await expect(panel(page)).toHaveAttribute('data-lean', '-2,30');
  await expect(page.locator('#adjust-problem')).toBeHidden();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#adjust-problem')).toHaveText('Nails lean at most 15° each way');
  await expect(panel(page)).toHaveAttribute('data-lean', '-2,30');

  // Back to nudging with the button: the arrows nudge, and the lean stays.
  await page.getByRole('button', { name: 'Nudge', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-mode', 'nudge');
  await page.getByRole('button', { name: 'Nudge right 0.1 mm' }).click();
  await expect(panel(page)).toHaveAttribute('data-offset', '1,0');
  await expect(panel(page)).toHaveAttribute('data-lean', '-2,30');

  await page.getByRole('button', { name: 'Reset nail' }).click();
  await expect(panel(page)).toHaveAttribute('data-offset', '0,0');
  await expect(panel(page)).toHaveAttribute('data-lean', '0,0');
  await expect(panel(page)).toHaveAttribute('data-moved', '0');
  await expect(page.locator('#handle')).toHaveAttribute('data-power', '0.500');
});

test('a nudge into the next nail is refused, with the reason', async ({ page }) => {
  await page.keyboard.press('e');
  const left = START_NAILS[0];
  await clickBoard(page, left.x, left.y);
  await expect(panel(page)).toHaveAttribute('data-selected', '0');
  // 12.5 mm of gap to the right start nail: 12 mm goes, the 13th mm doesn't.
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect(panel(page)).toHaveAttribute('data-offset', '120,0');
  await expect(page.locator('#adjust-problem')).toBeHidden();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('#adjust-problem')).toContainText(
    "Nail 0 can't go there: (0.2558, 0.178) overlaps nails[1] at (0.2573, 0.178)",
  );
  await expect(panel(page)).toHaveAttribute('data-offset', '120,0');
  // The next good move clears it.
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#adjust-problem')).toBeHidden();
  await expect(panel(page)).toHaveAttribute('data-offset', '119,0');
});

test('play pauses while adjusting: balls wait, the handle does nothing, and play resumes after', async ({
  page,
}) => {
  // One ball up the lane, then straight into edit mode.
  await page.keyboard.down('Space');
  await expect.poll(async () => (await counts(page)).launched).toBe(1);
  await page.keyboard.up('Space');
  await page.keyboard.press('e');
  await expect(panel(page)).toBeVisible();
  const paused = await counts(page);
  // A ball is in flight for a few seconds; paused, it stays put for longer.
  await page.waitForTimeout(1000);
  await page.keyboard.down('Space');
  await page.waitForTimeout(3000);
  await page.keyboard.up('Space');
  expect(await counts(page)).toEqual(paused);
  await expect(page.locator('#handle')).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  // The waiting balls carry on and leave; then the handle fires again.
  await expect.poll(async () => (await counts(page)).inPlay, { timeout: 15_000 }).toBe(0);
  await page.keyboard.down('Space');
  await expect.poll(async () => (await counts(page)).launched).toBeGreaterThan(paused.launched);
  await page.keyboard.up('Space');
});

test('keyboard only (M8): Tab to Adjust nails, S, then the arrows walk the selection to a start nail; N nudges it', async ({
  page,
}) => {
  const classic = JSON.parse(await readFile('boards/classic.json', 'utf8')) as {
    nails: [number, number][];
  };
  // Tab to the button and press it, as someone without a pointer would.
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    if (await page.locator('#adjust').evaluate((el) => el === document.activeElement)) break;
  }
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('#adjust-selection')).toHaveText('Tap a nail, or use Select (S)');

  await page.keyboard.press('s');
  await expect(panel(page)).toHaveAttribute('data-mode', 'select');
  await expect(page.locator('#mode-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Select next nail down' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(panel(page)).not.toHaveAttribute('data-selected', '');

  // Down the field, then across, to one of the two start nails.
  const selected = async () => Number(await panel(page).getAttribute('data-selected'));
  for (let i = 0; i < 40; i++) {
    const at = await selected();
    if (at === 0 || at === 1) break;
    const [x, y] = classic.nails[at] as [number, number];
    await page.keyboard.press(y > 0.2 ? 'ArrowDown' : x < 0.25 ? 'ArrowRight' : 'ArrowLeft');
    await expect(panel(page)).not.toHaveAttribute('data-selected', String(at));
  }
  const start = await selected();
  expect([0, 1]).toContain(start);
  // Selecting moved nothing, and the handle stayed where it was.
  await expect(panel(page)).toHaveAttribute('data-moved', '0');
  await expect(page.locator('#handle')).toHaveAttribute('data-power', '0.500');
  // The two start nails are each other's neighbours across the pocket.
  await page.keyboard.press(start === 0 ? 'ArrowRight' : 'ArrowLeft');
  await expect(panel(page)).toHaveAttribute('data-selected', String(1 - start));
  await page.keyboard.press(start === 0 ? 'ArrowLeft' : 'ArrowRight');
  await expect(panel(page)).toHaveAttribute('data-selected', String(start));

  await page.keyboard.press('n');
  await expect(panel(page)).toHaveAttribute('data-mode', 'nudge');
  await page.keyboard.press(start === 0 ? 'ArrowLeft' : 'ArrowRight');
  await expect(panel(page)).toHaveAttribute('data-offset', start === 0 ? '-1,0' : '1,0');
  await expect(panel(page)).toHaveAttribute('data-moved', '1');
});

test('select mode on a touch screen: the panel arrows pick nails, and a nail with none further that way says so', async ({
  page,
}) => {
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-mode', 'select');
  await page.getByRole('button', { name: 'Select next nail left' }).click();
  await expect(panel(page)).not.toHaveAttribute('data-selected', '');
  // Left until the edge of the field.
  for (let i = 0; i < 30; i++) {
    if (await page.locator('#adjust-problem').isVisible()) break;
    await page.getByRole('button', { name: 'Select next nail left' }).click();
  }
  await expect(page.locator('#adjust-problem')).toHaveText('No nail further left');
  await expect(panel(page)).not.toHaveAttribute('data-selected', '');
  await page.getByRole('button', { name: 'Select next nail right' }).click();
  await expect(page.locator('#adjust-problem')).toBeHidden();
  await expect(panel(page)).toHaveAttribute('data-moved', '0');
});
