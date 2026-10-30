// M7's import, on the table and the adjustments: the board, world and all
// are replaced, balls in play go back to the tray, the edits start again
// from the imported board, and a bad file changes nothing.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NAIL_STEP_M,
  createAdjust,
  importBoard,
  importProblem,
  movedNails,
  noteExported,
  nudgeSelected,
  refuseImport,
  resetSelected,
  selectNailAt,
  setEditing,
  setMode,
} from '../../src/game/adjust';
import { exportBoard } from '../../src/game/boardfile';
import { returnBalls } from '../../src/game/economy';
import { attackerOpen, forceJackpot } from '../../src/game/machine';
import { type Table, createTable, replaceBoard, stepTable } from '../../src/game/table';
import { type Board, parseBoard } from '../../src/sim/board';

const classicText = readFileSync('boards/classic.json', 'utf8');
const classic = parseBoard(JSON.parse(classicText));

/** The classic board with its first start nail 1 mm left, as a board file. */
function editedText(): string {
  const table = createTable(classic);
  const adjust = createAdjust(table);
  selectNailAt(adjust, table, 0.2428, 0.178, 0.001);
  expect(nudgeSelected(adjust, table, -10, 0)).toBe(true);
  return exportBoard(table.board);
}

/** A board with nothing in common with the classic one: two nails in a bowl. */
const tiny: Board = parseBoard({
  name: 'tiny',
  widthM: 0.2,
  heightM: 0.2,
  nails: [
    [0.1, 0.1],
    [0.12, 0.1],
  ],
  rails: [
    {
      id: 'bowl',
      points: [
        [0.01, 0.19],
        [0.01, 0.05],
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

const circlesAt = (table: Table) => table.world.circles.map((c) => ({ x: c.x, y: c.y }));

/**
 * Fire `n` shots from the tray, a step after the last one launches. Shots
 * go 0.6 s apart, so the earliest may have finished by then: returns how
 * many are in play, at least the last.
 */
function inPlay(table: Table, n: number): number {
  table.fire.held = true;
  while (table.economy.launched < n) stepTable(table);
  table.fire.held = false;
  stepTable(table);
  expect(table.world.balls.length).toBeGreaterThan(0);
  return table.world.balls.length;
}

describe('importBoard', () => {
  it('replaces the board and world, and starts the edits afresh from the imported board', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    setEditing(adjust, true);
    setMode(adjust, 'bend');
    selectNailAt(adjust, table, 0.2573, 0.178, 0.001);
    resetSelected(adjust, table);
    const world = table.world;

    expect(importBoard(adjust, table, editedText())).toBe(true);
    expect(table.world).not.toBe(world);
    expect(table.board.nails[0]).toEqual({ x: 0.2418, y: 0.178 });
    expect(circlesAt(table)).toEqual(table.board.nails);
    // The imported board is the board as loaded: nothing moved, nothing selected.
    expect(adjust.original).toEqual(table.board.nails);
    expect(movedNails(adjust)).toEqual([]);
    expect(adjust.selected).toBeNull();
    expect(adjust.editing).toBe(true);
    expect(adjust.mode).toBe('bend');
    expect(adjust.problem).toBeNull();
    expect(adjust.notice).toBe(`Imported "classic", ${classic.nails.length} nails`);
  });

  it('counts later nudges from where the import put the nail, and resets to it', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    importBoard(adjust, table, editedText());
    selectNailAt(adjust, table, 0.2418, 0.178, 0.001);
    expect(adjust.selected).toBe(0);
    expect(nudgeSelected(adjust, table, 1, 0)).toBe(true);
    expect(adjust.offsets.get(0)).toEqual({ dx: 1, dy: 0 });
    expect(table.board.nails[0]?.x).toBeCloseTo(0.2418 + NAIL_STEP_M, 12);
    expect(adjust.notice).toBeNull();
    expect(resetSelected(adjust, table)).toBe(true);
    expect(table.board.nails[0]).toEqual({ x: 0.2418, y: 0.178 });
    expect(movedNails(adjust)).toEqual([]);
  });

  it('takes a board of a different shape: fewer nails, other pockets, no attacker or tulips', () => {
    const table = createTable(classic, { seed: 2 });
    const adjust = createAdjust(table);
    expect(importBoard(adjust, table, exportBoard(tiny))).toBe(true);
    expect(table.board).toEqual(tiny);
    expect(table.world.circles).toHaveLength(2);
    expect(table.world.gates).toEqual([]);
    expect(adjust.original).toEqual(tiny.nails);
    expect(adjust.notice).toBe('Imported "tiny", 2 nails');
    // It plays: a weak shot launches from the new board's launcher, and
    // leaves the world (this little bowl doesn't always catch it).
    table.fire.power = 0;
    table.fire.held = true;
    stepTable(table);
    table.fire.held = false;
    expect(table.world.balls).toHaveLength(1);
    expect(table.world.balls[0]?.x).toBe(0.05);
    expect(table.world.balls[0]?.y).toBeCloseTo(0.15, 2);
    for (let i = 0; i < 20_000 && table.world.balls.length > 0; i++) stepTable(table);
    expect(table.world.balls).toHaveLength(0);
    expect(table.economy.launched).toBe(1);
  });

  it('puts the balls in play back in the tray, as if never launched', () => {
    const table = createTable(classic, { seed: 1 });
    const adjust = createAdjust(table);
    const n = inPlay(table, 3);
    expect(n).toBeGreaterThan(1);
    const { balls, launched } = table.economy;
    expect(importBoard(adjust, table, classicText)).toBe(true);
    expect(table.world.balls).toEqual([]);
    expect(table.economy.balls).toBe(balls + n);
    expect(table.economy.launched).toBe(launched - n);
    expect(adjust.notice).toBe(
      `Imported "classic", ${classic.nails.length} nails; ${n} balls in play back to the tray`,
    );
  });

  it("drops keepInPlay's free balls without paying for them", () => {
    const table = createTable(classic, { seed: 1, keepInPlay: 5 });
    const adjust = createAdjust(table);
    for (let i = 0; i < 5000; i++) stepTable(table);
    expect(table.freeBalls.size).toBeGreaterThan(0);
    expect(importBoard(adjust, table, classicText)).toBe(true);
    expect(table.freeBalls.size).toBe(0);
    expect(table.economy.balls).toBe(250);
    expect(table.economy.launched).toBe(0);
    expect(adjust.notice).toBe(`Imported "classic", ${classic.nails.length} nails`);
  });

  it('carries a jackpot on: the new attacker opens on the next step if a round is on', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    expect(forceJackpot(table.machine)).toBe(true);
    while (!attackerOpen(table.machine)) stepTable(table);
    stepTable(table);
    const gate = () => table.world.gates.find((g) => g.id === 'attacker');
    expect(gate()?.open).toBe(true);
    const machine = table.machine;
    expect(importBoard(adjust, table, classicText)).toBe(true);
    expect(table.machine).toBe(machine);
    expect(gate()?.open).toBe(false);
    stepTable(table);
    expect(gate()?.open).toBe(true);
  });

  it('refuses a bad file with its first problem, and changes nothing', () => {
    const table = createTable(classic, { seed: 1 });
    const adjust = createAdjust(table);
    const n = inPlay(table, 2);
    selectNailAt(adjust, table, 0.2428, 0.178, 0.001);
    nudgeSelected(adjust, table, -3, 0);
    const before = {
      board: table.board,
      world: table.world,
      balls: table.economy.balls,
      original: adjust.original,
      offsets: new Map(adjust.offsets),
    };
    noteExported(adjust, 'classic.json');

    expect(importBoard(adjust, table, '{"name": "x"')).toBe(false);
    expect(adjust.problem).toMatch(/^Can't import that board: file: not JSON \(/);
    expect(adjust.notice).toBeNull();

    const data = JSON.parse(classicText) as Record<string, unknown>;
    data['widthM'] = -1;
    data['launcher'] = 'here';
    expect(importBoard(adjust, table, JSON.stringify(data))).toBe(false);
    expect(adjust.problem).toBe("Can't import that board: widthM: must be > 0 (and 1 more)");

    expect(table.board).toBe(before.board);
    expect(table.world).toBe(before.world);
    expect(table.world.balls).toHaveLength(n);
    expect(table.economy.balls).toBe(before.balls);
    expect(adjust.original).toBe(before.original);
    expect(adjust.offsets).toEqual(before.offsets);
    expect(adjust.selected).toBe(0);
  });

  it('is undone by the next good import, which clears the refusal', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    importBoard(adjust, table, 'nope');
    expect(adjust.problem).not.toBeNull();
    expect(importBoard(adjust, table, classicText)).toBe(true);
    expect(adjust.problem).toBeNull();
  });
});

describe('import and export messages', () => {
  it('importProblem gives the first issue and counts the rest', () => {
    expect(importProblem(['a'])).toBe("Can't import that board: a");
    expect(importProblem(['a', 'b', 'c'])).toBe("Can't import that board: a (and 2 more)");
    expect(importProblem([])).toBe("Can't import that board: unknown problem");
  });

  it('refuseImport sets the problem and clears a notice', () => {
    const adjust = createAdjust(createTable(classic));
    noteExported(adjust, 'classic.json');
    refuseImport(adjust, 'file: too big');
    expect(adjust.problem).toBe("Can't import that board: file: too big");
    expect(adjust.notice).toBeNull();
  });

  it('noteExported names the file and counts the moved nails; the next action clears it', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    noteExported(adjust, 'classic.json');
    expect(adjust.notice).toBe('Exported classic.json, 0 nails moved');
    selectNailAt(adjust, table, 0.2428, 0.178, 0.001);
    expect(adjust.notice).toBeNull();
    nudgeSelected(adjust, table, 1, 0);
    noteExported(adjust, 'classic.json');
    expect(adjust.notice).toBe('Exported classic.json, 1 nail moved');
    expect(adjust.problem).toBeNull();
    setMode(adjust, 'bend');
    expect(adjust.notice).toBeNull();
    noteExported(adjust, 'classic.json');
    // A refused move clears it too.
    nudgeSelected(adjust, table, 0.5, 0);
    expect(adjust.notice).toBeNull();
    expect(adjust.problem).not.toBeNull();
  });
});

describe('replaceBoard and returnBalls', () => {
  it('replaceBoard returns how many tray balls went back', () => {
    const table = createTable(classic, { seed: 1 });
    const n = inPlay(table, 2);
    const { balls } = table.economy;
    expect(replaceBoard(table, classic)).toBe(n);
    expect(replaceBoard(table, classic)).toBe(0);
    expect(table.economy.balls).toBe(balls + n);
  });

  it('returnBalls refuses more than were launched, or a part ball', () => {
    const table = createTable(classic, { seed: 1 });
    table.fire.held = true;
    stepTable(table);
    expect(table.economy.launched).toBe(1);
    expect(() => returnBalls(table.economy, 2)).toThrow(RangeError);
    expect(() => returnBalls(table.economy, -1)).toThrow(RangeError);
    expect(() => returnBalls(table.economy, 0.5)).toThrow(RangeError);
    returnBalls(table.economy, 1);
    expect(table.economy).toMatchObject({ balls: 250, launched: 0 });
  });
});
