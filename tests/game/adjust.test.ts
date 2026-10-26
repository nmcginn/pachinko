import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NAIL_STEP_M,
  createAdjust,
  nudgeSelected,
  resetSelected,
  selectNailAt,
  selectedOffset,
  setEditing,
} from '../../src/game/adjust';
import { addTally, createTally, runBatch, summarize } from '../../src/game/montecarlo';
import { type Table, createTable, stepTable } from '../../src/game/table';
import { parseBoard } from '../../src/sim/board';
import { BALL_RADIUS_M, NAIL_RADIUS_M, SIM_STEP_S, addBall } from '../../src/sim/world';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
/** The classic board's best handle power (PHYSICS.md tuning log, the handle remap). */
const BEST_POWER = 0.2;
/** The two nails just above the start pocket (命釘), left and right, at y 0.178. */
const LEFT = 0;
const RIGHT = 1;
const steps = (simS: number) => Math.round(simS / SIM_STEP_S);

/** Board and world agree on every nail. */
function expectInSync(table: Table): void {
  expect(table.world.circles.map((c) => ({ x: c.x, y: c.y }))).toEqual(table.board.nails);
}

function selected(table: Table, index: number) {
  const adjust = createAdjust(table);
  const nail = table.board.nails[index];
  if (!nail) throw new Error(`no nail ${index}`);
  expect(selectNailAt(adjust, table, nail.x, nail.y, 0.001)).toBe(index);
  return adjust;
}

describe('nail adjustment', () => {
  it('starts out of edit mode, with nothing selected or moved', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    expect(adjust.editing).toBe(false);
    expect(adjust.selected).toBeNull();
    expect(adjust.offsets.size).toBe(0);
    expect(adjust.problem).toBeNull();
    expect(adjust.original).toEqual(classic.nails);
    expect(selectedOffset(adjust)).toBeNull();
    setEditing(adjust, true);
    expect(adjust.editing).toBe(true);
    setEditing(adjust, false);
    expect(adjust.editing).toBe(false);
  });

  it('nudges are 0.1 mm (PLAN.md M7)', () => {
    expect(NAIL_STEP_M).toBe(0.0001);
  });

  it('selects the nearest nail within reach, or none', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    const left = classic.nails[LEFT];
    const right = classic.nails[RIGHT];
    if (!left || !right) throw new Error('classic board has no start nails');
    // A point a third of the way from the left nail to the right one.
    const x = left.x + (right.x - left.x) / 3;
    expect(selectNailAt(adjust, table, x, left.y, 0.01)).toBe(LEFT);
    expect(selectNailAt(adjust, table, right.x + 0.001, right.y, 0.01)).toBe(RIGHT);
    // Out of reach: nothing, even with a nail selected before.
    expect(selectNailAt(adjust, table, x, left.y, 0.001)).toBeNull();
    expect(adjust.selected).toBeNull();
    // Off the board.
    expect(selectNailAt(adjust, table, -1, -1, 0.01)).toBeNull();
    // Exactly at the reach counts.
    const below = left.y - 0.002;
    expect(selectNailAt(adjust, table, left.x, below, left.y - below)).toBe(LEFT);
  });

  it('a nudge moves the nail on the board and in the world together', () => {
    const table = createTable(classic);
    const adjust = selected(table, RIGHT);
    const before = table.board;
    expect(nudgeSelected(adjust, table, 1, 0)).toBe(true);
    expect(table.board).not.toBe(before);
    expect(before.nails[RIGHT]).toEqual({ x: 0.2573, y: 0.178 });
    expect(table.board.nails[RIGHT]).toEqual({ x: 0.2573 + NAIL_STEP_M, y: 0.178 });
    expectInSync(table);
    expect(selectedOffset(adjust)).toEqual({ dx: 1, dy: 0 });
    // Up and left, a few at once.
    expect(nudgeSelected(adjust, table, -3, 2)).toBe(true);
    expect(table.board.nails[RIGHT]).toEqual({
      x: 0.2573 - 2 * NAIL_STEP_M,
      y: 0.178 + 2 * NAIL_STEP_M,
    });
    expect(selectedOffset(adjust)).toEqual({ dx: -2, dy: 2 });
    expectInSync(table);
    // Only that nail moved.
    table.board.nails.forEach((n, i) => {
      if (i !== RIGHT) expect(n).toEqual(classic.nails[i]);
    });
  });

  it('nudging back and forth returns the nail exactly, with no drift', () => {
    const table = createTable(classic);
    const adjust = selected(table, LEFT);
    for (let i = 0; i < 37; i++) nudgeSelected(adjust, table, -1, 1);
    expect(adjust.offsets.get(LEFT)).toEqual({ dx: -37, dy: 37 });
    for (let i = 0; i < 37; i++) nudgeSelected(adjust, table, 1, -1);
    expect(table.board.nails[LEFT]).toEqual(classic.nails[LEFT]);
    expect(adjust.offsets.has(LEFT)).toBe(false);
    expect(selectedOffset(adjust)).toEqual({ dx: 0, dy: 0 });
    expectInSync(table);
  });

  it('remembers each moved nail, and reset puts the selected one back', () => {
    const table = createTable(classic);
    const adjust = selected(table, LEFT);
    nudgeSelected(adjust, table, -5, 0);
    const right = classic.nails[RIGHT];
    if (!right) throw new Error('no right nail');
    selectNailAt(adjust, table, right.x, right.y, 0.001);
    nudgeSelected(adjust, table, 5, 0);
    expect([...adjust.offsets]).toEqual([
      [LEFT, { dx: -5, dy: 0 }],
      [RIGHT, { dx: 5, dy: 0 }],
    ]);
    expect(resetSelected(adjust, table)).toBe(true);
    expect(table.board.nails[RIGHT]).toEqual(classic.nails[RIGHT]);
    expect([...adjust.offsets.keys()]).toEqual([LEFT]);
    expectInSync(table);
  });

  it('refuses to nudge or reset with nothing selected, or by part of a step', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    expect(nudgeSelected(adjust, table, 1, 0)).toBe(false);
    expect(adjust.problem).toBe('Select a nail first');
    expect(resetSelected(adjust, table)).toBe(false);
    expect(table.board).toBe(classic);
    const a2 = selected(table, LEFT);
    expect(nudgeSelected(a2, table, 0.5, 0)).toBe(false);
    expect(a2.problem).toBe('Nudges are whole steps, got (0.5, 0)');
    expect(nudgeSelected(a2, table, NaN, 0)).toBe(false);
    expect(table.board).toBe(classic);
  });

  it('refuses a nudge into another nail, says why, changes nothing, then takes a good one', () => {
    const table = createTable(classic);
    const adjust = selected(table, LEFT);
    // The start nails are 14.5 mm apart, centre to centre; they touch at 2 mm.
    const gapSteps = Math.round((0.2573 - 0.2428 - 2 * NAIL_RADIUS_M) / NAIL_STEP_M);
    expect(nudgeSelected(adjust, table, gapSteps, 0)).toBe(true);
    const board = table.board;
    expect(nudgeSelected(adjust, table, 1, 0)).toBe(false);
    expect(adjust.problem).toMatch(
      /^Nail 0 can't go there: \(.*\) overlaps nails\[1\] at \(0.2573, 0.178\)$/,
    );
    expect(table.board).toBe(board);
    expect(selectedOffset(adjust)).toEqual({ dx: gapSteps, dy: 0 });
    expectInSync(table);
    expect(nudgeSelected(adjust, table, -1, 0)).toBe(true);
    expect(adjust.problem).toBeNull();
  });

  it('refuses a nudge into a ball in play, and the ball stays where it was', () => {
    const table = createTable(classic);
    const adjust = selected(table, RIGHT);
    // A ball resting against the right start nail's right side, 0.05 mm clear.
    const ball = addBall(table.world, {
      x: 0.2573 + BALL_RADIUS_M + NAIL_RADIUS_M + 0.00005,
      y: 0.178,
    });
    expect(nudgeSelected(adjust, table, 1, 0)).toBe(false);
    expect(adjust.problem).toBe("Nail 1 can't go there: a ball in play is in the way");
    expect(table.board).toBe(classic);
    expect(ball).toMatchObject({ x: 0.2573 + BALL_RADIUS_M + NAIL_RADIUS_M + 0.00005, y: 0.178 });
    // Away from it is fine.
    expect(nudgeSelected(adjust, table, -1, 0)).toBe(true);
    expectInSync(table);
  });

  it('two tables with the same seed and the same nudges play the same game', () => {
    const play = () => {
      const table = createTable(classic, { seed: 5 });
      const adjust = selected(table, LEFT);
      nudgeSelected(adjust, table, -4, 1);
      table.fire.power = BEST_POWER;
      table.fire.held = true;
      for (let i = 0; i < steps(8); i++) stepTable(table);
      return { economy: { ...table.economy }, balls: table.world.balls.map((b) => [b.x, b.y]) };
    };
    expect(play()).toEqual(play());
  });

  it('moving the two start nails 1 mm outward raises the start rate (M7 acceptance, headless)', () => {
    const table = createTable(classic);
    const left = selected(table, LEFT);
    for (let i = 0; i < 10; i++) expect(nudgeSelected(left, table, -1, 0)).toBe(true);
    const right = selected(table, RIGHT);
    for (let i = 0; i < 10; i++) expect(nudgeSelected(right, table, 1, 0)).toBe(true);
    const spins = (board: Table['board']) => {
      let tally = createTally();
      for (let k = 0; k < 2; k++) {
        tally = addTally(
          tally,
          runBatch(board, { power: BEST_POWER, seed: 1, first: k * 1000, count: 1000 }),
        );
      }
      return summarize(tally);
    };
    const before = spins(classic);
    const after = spins(table.board);
    // Seeded, so exact: 21.88 and 28.88 spins per ¥1000, each ± 1.6–1.8.
    expect(after.spinsPer1000Yen - before.spinsPer1000Yen).toBeGreaterThan(
      2 * Math.hypot(before.spinsPer1000YenSe, after.spinsPer1000YenSe),
    );
  }, 30_000);
});
