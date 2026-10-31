// M7: export and import. Edits round-trip through a board file (M7's
// acceptance): the start nails moved and exported, the page reloaded, the
// file imported, and the board exports again byte for byte, and plays.

import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { clickBoard } from './boardview';

/** The classic board's two start nails (boards/classic.json nails[0], nails[1]). */
const START_NAILS = [
  { x: 0.2428, y: 0.178 },
  { x: 0.2573, y: 0.178 },
] as const;

const panel = (page: Page) => page.locator('#adjust-panel');

/** Click Export and return the saved file's name and text. */
async function exportBoard(page: Page): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export' }).click(),
  ]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: await readFile(path, 'utf8') };
}

/** Open the page in edit mode. */
async function open(page: Page): Promise<void> {
  await page.goto('/?seed=54');
  await expect(page.locator('#balls')).toHaveAttribute('data-balls', '250');
  await page.keyboard.press('e');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveAttribute('data-moved', '0');
}

test('edits round-trip through export and import', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);

  // Unedited, the board exports as boards/classic.json.
  const loaded = await exportBoard(page);
  expect(loaded.name).toBe('classic.json');
  expect(loaded.text).toBe(await readFile('boards/classic.json', 'utf8'));

  // Both start nails 1 mm outward, and the left one leant 1° down.
  await clickBoard(page, START_NAILS[0].x, START_NAILS[0].y);
  await expect(panel(page)).toHaveAttribute('data-selected', '0');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('b');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('b');
  await clickBoard(page, START_NAILS[1].x, START_NAILS[1].y);
  await expect(panel(page)).toHaveAttribute('data-selected', '1');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(panel(page)).toHaveAttribute('data-moved', '2');

  const edited = await exportBoard(page);
  await expect(page.locator('#adjust-selection')).toHaveText(
    'Exported classic.json, 2 nails moved',
  );
  const nails = (JSON.parse(edited.text) as { nails: [number, number][] }).nails;
  expect(nails[1]).toEqual([0.2583, 0.178]);
  expect(nails[0]?.[0]).toBe(0.2418);
  // 1° down: 5.5 mm × tan 1° = 0.096 mm, to the nanometre.
  expect(nails[0]?.[1]).toBeCloseTo(0.178 - 0.0055 * Math.tan(Math.PI / 180), 9);

  // A reload loses the edits; the import brings them back.
  await open(page);
  expect((await exportBoard(page)).text).toBe(loaded.text);
  await page.locator('#board-file').setInputFiles({
    name: edited.name,
    mimeType: 'application/json',
    buffer: Buffer.from(edited.text),
  });
  await expect(panel(page)).toHaveAttribute('data-notice', /^Imported "classic", \d+ nails$/);
  await expect(page.locator('#adjust-selection')).toHaveText(/^Imported "classic"/);
  // The imported board is the edits' new starting point: nothing counts as
  // moved. The live stats still compare it with the board the page loaded.
  await expect(panel(page)).toHaveAttribute('data-moved', '0');
  await expect(page.locator('#stats-current')).toContainText('This board');
  await expect(page.locator('#stats-baseline')).toContainText('As loaded');
  expect((await exportBoard(page)).text).toBe(edited.text);

  // A nail of the imported board selects where the file put it.
  await clickBoard(page, 0.2583, 0.178);
  await expect(panel(page)).toHaveAttribute('data-selected', '1');
  await expect(page.locator('#adjust-selection')).toHaveText(
    'Nail 1 at 258.3, 178.0 mm, not moved',
  );

  // And it plays: out of edit mode, held fire launches balls onto it.
  await page.keyboard.press('e');
  await expect(panel(page)).toBeHidden();
  await page.keyboard.down('Space');
  await expect
    .poll(() =>
      page.locator('#balls').evaluate((el: HTMLElement) => Number(el.dataset['launched'])),
    )
    .toBeGreaterThan(0);
  await page.keyboard.up('Space');
  expect(errors).toEqual([]);
});

test('a bad file is refused with the reason, and the board stays as it was', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await clickBoard(page, START_NAILS[0].x, START_NAILS[0].y);
  await page.keyboard.press('ArrowLeft');
  await expect(panel(page)).toHaveAttribute('data-moved', '1');

  const data = JSON.parse(await readFile('boards/classic.json', 'utf8')) as {
    nails: [number, number][];
  };
  data.nails[1] = [0.2435, 0.178];
  await page.locator('#board-file').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator('#adjust-problem')).toHaveText(
    "Can't import that board: nails[1]: (0.2435, 0.178) overlaps nails[0] at (0.2428, 0.178)",
  );
  await expect(panel(page)).toHaveAttribute('data-moved', '1');
  await expect(panel(page)).toHaveAttribute('data-selected', '0');

  await page.locator('#board-file').setInputFiles({
    name: 'photo.json',
    mimeType: 'application/json',
    buffer: Buffer.from('ÿØ not json'),
  });
  await expect(page.locator('#adjust-problem')).toHaveText(
    /^Can't import that board: file: not JSON \(/,
  );
  await expect(panel(page)).toHaveAttribute('data-moved', '1');
  expect(errors).toEqual([]);
});
