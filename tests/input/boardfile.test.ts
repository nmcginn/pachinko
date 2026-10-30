import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAdjust, nudgeSelected, selectNailAt } from '../../src/game/adjust';
import { MAX_BOARD_FILE_CHARS, exportBoard } from '../../src/game/boardfile';
import { createTable } from '../../src/game/table';
import { bindBoardFile } from '../../src/input/boardfile';
import { parseBoard } from '../../src/sim/board';

const classicText = readFileSync('boards/classic.json', 'utf8');
const classic = parseBoard(JSON.parse(classicText));

/** A stand-in for the hidden file input: a picker that "opens" when clicked, and the file it chose. */
class FakeFileInput extends EventTarget {
  value = 'C:\\fakepath\\old.json';
  files: Blob[] | null = null;
  opened = 0;
  click(): void {
    this.opened += 1;
  }
  choose(file: Blob): void {
    this.files = [file];
    this.dispatchEvent(new Event('change'));
  }
}

function setup() {
  const table = createTable(classic, { seed: 1 });
  const adjust = createAdjust(table);
  adjust.editing = true;
  const els = {
    exportButton: new EventTarget(),
    importButton: new EventTarget(),
    file: new FakeFileInput(),
  };
  const downloads: { fileName: string; text: string }[] = [];
  const calls: string[] = [];
  const unbind = bindBoardFile(
    els,
    adjust,
    table,
    { download: (fileName, text) => downloads.push({ fileName, text }) },
    () => calls.push('changed'),
    () => calls.push('replaced'),
  );
  return { table, adjust, els, downloads, calls, unbind };
}

/** Let a File's text() promise and its handlers run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('bindBoardFile', () => {
  it('Export saves the board as it stands, named for it, and says so', () => {
    const { table, adjust, els, downloads, calls } = setup();
    selectNailAt(adjust, table, 0.2428, 0.178, 0.001);
    nudgeSelected(adjust, table, -10, 0);
    els.exportButton.dispatchEvent(new Event('click'));
    expect(downloads).toEqual([{ fileName: 'classic.json', text: exportBoard(table.board) }]);
    expect(JSON.parse(downloads[0]?.text ?? '').nails[0]).toEqual([0.2418, 0.178]);
    expect(adjust.notice).toBe('Exported classic.json, 1 nail moved');
    expect(calls).toEqual(['changed']);
  });

  it('Import opens the picker, cleared so the same file can be picked again', () => {
    const { els, calls } = setup();
    els.importButton.dispatchEvent(new Event('click'));
    expect(els.file.opened).toBe(1);
    expect(els.file.value).toBe('');
    expect(calls).toEqual([]);
  });

  it('a picked board file replaces the board, then reports the change', async () => {
    const { table, adjust, els, calls } = setup();
    const text = classicText.replace('[0.2428, 0.178]', '[0.2408, 0.178]');
    els.file.choose(new File([text], 'mine.json', { type: 'application/json' }));
    expect(calls).toEqual([]);
    await settle();
    expect(calls).toEqual(['replaced', 'changed']);
    expect(table.board.nails[0]).toEqual({ x: 0.2408, y: 0.178 });
    expect(adjust.original[0]).toEqual({ x: 0.2408, y: 0.178 });
    expect(adjust.notice).toMatch(/^Imported "classic"/);
  });

  it('a bad file is refused with its problem, and the board stays', async () => {
    const { table, adjust, els, calls } = setup();
    const board = table.board;
    els.file.choose(new File(['not a board'], 'x.json'));
    await settle();
    expect(calls).toEqual(['changed']);
    expect(table.board).toBe(board);
    expect(adjust.problem).toMatch(/^Can't import that board: file: not JSON/);
  });

  it('a file over the limit is refused without being read', () => {
    const { table, adjust, els, calls } = setup();
    const board = table.board;
    const big = new File(['x'.repeat(MAX_BOARD_FILE_CHARS + 1)], 'big.json');
    // Reading it would fail the test: the refusal has to come first.
    Object.defineProperty(big, 'text', {
      value: () => Promise.reject(new Error('read a file over the limit')),
    });
    els.file.choose(big);
    expect(calls).toEqual(['changed']);
    expect(adjust.problem).toBe(
      "Can't import that board: file: 1,000,001 bytes is more than a board file's 1,000,000",
    );
    expect(table.board).toBe(board);
  });

  it('a file that cannot be read is refused, saying why', async () => {
    const { adjust, els, calls } = setup();
    const broken = new File(['{}'], 'gone.json');
    Object.defineProperty(broken, 'text', {
      value: () => Promise.reject(new Error('file was moved')),
    });
    els.file.choose(broken);
    await settle();
    expect(calls).toEqual(['changed']);
    expect(adjust.problem).toBe("Can't import that board: file: couldn't read it (file was moved)");
  });

  it('a change with no file does nothing', () => {
    const { els, calls } = setup();
    els.file.files = [];
    els.file.dispatchEvent(new Event('change'));
    els.file.files = null;
    els.file.dispatchEvent(new Event('change'));
    expect(calls).toEqual([]);
  });

  it('unbinding stops the buttons, and drops a file still being read', async () => {
    const { table, els, downloads, calls, unbind } = setup();
    const board = table.board;
    els.file.choose(new File([classicText], 'classic.json'));
    unbind();
    await settle();
    els.exportButton.dispatchEvent(new Event('click'));
    els.importButton.dispatchEvent(new Event('click'));
    els.file.choose(new File([classicText], 'classic.json'));
    await settle();
    expect(table.board).toBe(board);
    expect(downloads).toEqual([]);
    expect(els.file.opened).toBe(0);
    expect(calls).toEqual([]);
  });
});
