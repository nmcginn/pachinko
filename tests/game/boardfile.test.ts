import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createAdjust,
  importBoard,
  leanSelected,
  nudgeSelected,
  selectNailAt,
} from '../../src/game/adjust';
import {
  MAX_BOARD_FILE_CHARS,
  boardFileName,
  exportBoard,
  readBoard,
} from '../../src/game/boardfile';
import { type Table, createTable } from '../../src/game/table';
import { type Board, BoardError, boardData, parseBoard } from '../../src/sim/board';

const classicText = readFileSync('boards/classic.json', 'utf8');
const classic = parseBoard(JSON.parse(classicText));

/** Issues readBoard reports for some text, or [] if it reads. */
function issues(text: string): readonly string[] {
  try {
    readBoard(text);
    return [];
  } catch (e) {
    if (e instanceof BoardError) return e.issues;
    throw e;
  }
}

/** A small valid board, with numbers JSON writes in exponent form. */
function tiny(): Board {
  return parseBoard({
    name: 'tiny',
    widthM: 0.2,
    heightM: 0.2,
    nails: [
      [0.1, 0.1],
      [0.12, 0.1000001],
    ],
    rails: [
      {
        id: 'bowl',
        points: [
          [0.01, 0.19],
          [1e-7, 0.05],
          [0.09, 0.02],
        ],
      },
    ],
    pockets: [
      {
        id: 'out',
        kind: 'out',
        polygon: [
          [0.09, 0.02],
          [0.11, 0.02],
          [0.11, 0.001],
          [0.09, 0.001],
        ],
      },
    ],
    launcher: { x: 0.05, y: 0.15, angleDeg: 90, minSpeedMps: 1 },
  });
}

/** Nudge and bend the classic board: the start nails 1 mm outward, and nail 30 leant 1.5° right and 0.5° down. */
function edited(): Table {
  const table = createTable(classic);
  const adjust = createAdjust(table);
  const select = (i: number) => {
    const n = table.board.nails[i];
    if (!n) throw new Error(`no nail ${i}`);
    expect(selectNailAt(adjust, table, n.x, n.y, 0.001)).toBe(i);
  };
  select(0);
  expect(nudgeSelected(adjust, table, -10, 0)).toBe(true);
  select(1);
  expect(nudgeSelected(adjust, table, 10, 0)).toBe(true);
  select(30);
  expect(leanSelected(adjust, table, 3, -1)).toBe(true);
  return table;
}

describe('exportBoard', () => {
  it('writes the unedited classic board byte for byte as boards/classic.json', () => {
    expect(exportBoard(classic)).toBe(classicText);
  });

  it('reads back as the same board: the classic one, an edited one, and one with tiny numbers', () => {
    for (const board of [classic, edited().board, tiny()]) {
      expect(readBoard(exportBoard(board))).toEqual(board);
      expect(parseBoard(boardData(board))).toEqual(board);
    }
  });

  it('is a fixed point: exporting what it read gives the same text', () => {
    const text = exportBoard(edited().board);
    expect(exportBoard(readBoard(text))).toBe(text);
  });

  it('writes each point on one line, ends with a newline, and keeps the launcher angle as given', () => {
    const text = exportBoard(tiny());
    expect(text).toContain('[0.12, 0.1000001]');
    expect(text).toContain('[1e-7, 0.05]');
    expect(text).toContain(
      '"launcher": { "x": 0.05, "y": 0.15, "angleDeg": 90, "minSpeedMps": 1 }',
    );
    expect(text.endsWith('}\n')).toBe(true);
    expect(classic.launcher.angleDeg).toBe(142);
  });

  it('writes the moved nails where they are now, and every other nail where it loaded', () => {
    const board = edited().board;
    const data = JSON.parse(exportBoard(board)) as { nails: [number, number][] };
    expect(data.nails[0]).toEqual([0.2418, 0.178]);
    expect(data.nails[1]).toEqual([0.2583, 0.178]);
    // A bend is its position only (PLAN.md, the maintainer's decision).
    expect(data.nails[30]).toEqual([board.nails[30]?.x, board.nails[30]?.y]);
    expect(data.nails[30]).not.toEqual([classic.nails[30]?.x, classic.nails[30]?.y]);
    const unchanged = data.nails.filter((_, i) => i !== 0 && i !== 1 && i !== 30);
    expect(unchanged).toEqual(
      classic.nails.filter((_, i) => i !== 0 && i !== 1 && i !== 30).map((n) => [n.x, n.y]),
    );
  });
});

describe('boardFileName', () => {
  it("is the board's name with .json", () => {
    expect(boardFileName(classic)).toBe('classic.json');
  });

  it('keeps to letters, digits, dashes and underscores, and falls back to "board"', () => {
    const named = (name: string) => boardFileName({ ...classic, name });
    expect(named('My board / v2')).toBe('My-board-v2.json');
    expect(named('../../etc')).toBe('etc.json');
    expect(named('台')).toBe('board.json');
    expect(named('x'.repeat(200))).toBe(`${'x'.repeat(64)}.json`);
  });
});

describe('readBoard', () => {
  it('refuses text that is not JSON, saying so', () => {
    expect(issues('')).toEqual([expect.stringMatching(/^file: not JSON \(/)]);
    expect(issues('{"name": ')).toEqual([expect.stringMatching(/^file: not JSON \(/)]);
  });

  it('refuses JSON that is not a board, with every problem parseBoard finds', () => {
    expect(issues('[]')).toEqual(['board: must be an object']);
    const data = JSON.parse(classicText) as { nails: [number, number][]; widthM: unknown };
    data.nails[1] = [0.2428, 0.178];
    data.widthM = 'wide';
    const found = issues(JSON.stringify(data));
    expect(found).toContain('widthM: must be a finite number');
    expect(found).toContain('nails[1]: (0.2428, 0.178) overlaps nails[0] at (0.2428, 0.178)');
  });

  it('refuses a file over MAX_BOARD_FILE_CHARS before parsing it', () => {
    const text = ' '.repeat(MAX_BOARD_FILE_CHARS - classicText.length) + classicText;
    expect(readBoard(text)).toEqual(classic);
    expect(issues(` ${text}`)).toEqual([
      "file: 1,000,001 characters is more than a board file's 1,000,000",
    ]);
  });
});

describe('edits round-trip through export and import (M7 acceptance)', () => {
  it('a fresh table that imports the export plays the edited board, nail for nail', () => {
    const before = edited();
    const text = exportBoard(before.board);

    const after = createTable(classic);
    const adjust = createAdjust(after);
    expect(importBoard(adjust, after, text)).toBe(true);
    expect(after.board).toEqual(before.board);
    expect(after.world.circles.map((c) => ({ x: c.x, y: c.y }))).toEqual(before.board.nails);
    expect(after.world.circles.map((c) => ({ x: c.x, y: c.y }))).toEqual(
      before.world.circles.map((c) => ({ x: c.x, y: c.y })),
    );
    expect(exportBoard(after.board)).toBe(text);
  });
});
