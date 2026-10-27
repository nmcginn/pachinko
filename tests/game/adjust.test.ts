import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BEND_HEIGHT_M,
  BEND_STEP_DEG,
  MAX_LEAN_STEPS,
  NAIL_STEP_M,
  createAdjust,
  leanSelected,
  leanShiftM,
  movedNails,
  nudgeSelected,
  resetSelected,
  selectNailAt,
  selectedLean,
  selectedOffset,
  setEditing,
  setMode,
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
    expect(adjust.mode).toBe('nudge');
    expect(adjust.selected).toBeNull();
    expect(adjust.offsets.size).toBe(0);
    expect(adjust.leans.size).toBe(0);
    expect(selectedLean(adjust)).toBeNull();
    expect(movedNails(adjust)).toEqual([]);
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
    expect(table.board.nails[RIGHT]).toEqual({ x: 0.2574, y: 0.178 });
    expectInSync(table);
    expect(selectedOffset(adjust)).toEqual({ dx: 1, dy: 0 });
    // Up and left, a few at once.
    expect(nudgeSelected(adjust, table, -3, 2)).toBe(true);
    // To the nanometre: the decimals they look like, not 0.2573 − 0.0002 in floating point.
    expect(table.board.nails[RIGHT]).toEqual({ x: 0.2571, y: 0.1782 });
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
    // The start nails are 14.5 mm apart, centre to centre, so they'd touch
    // after 12.5 mm. Exactly touching is a floating-point coin toss; 0.1 mm
    // short of it is clear, and 0.1 mm past it overlaps.
    const gapSteps = Math.round((0.2573 - 0.2428 - 2 * NAIL_RADIUS_M) / NAIL_STEP_M) - 1;
    expect(nudgeSelected(adjust, table, gapSteps, 0)).toBe(true);
    const board = table.board;
    expect(nudgeSelected(adjust, table, 2, 0)).toBe(false);
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

/** Where a nail `steps` of lean from `homeM` sits, to the nanometre, as adjust.ts places it. */
const leant = (homeM: number, nudges: number, steps: number) =>
  Math.round(
    (homeM + nudges * NAIL_STEP_M + BEND_HEIGHT_M * Math.tan((steps * Math.PI) / 360)) * 1e9,
  ) / 1e9;

describe('bending a nail', () => {
  it('leans 0.5° a step about the root, moving the nail 5.5 mm × tan θ (PLAN.md M7)', () => {
    expect(BEND_STEP_DEG).toBe(0.5);
    expect(BEND_HEIGHT_M).toBe(BALL_RADIUS_M);
    expect(BEND_HEIGHT_M).toBe(0.0055);
    expect(leanShiftM(0)).toBe(0);
    // About 0.1 mm per degree (the maintainer's answer, PLAN.md "Resolved").
    expect(leanShiftM(2)).toBeCloseTo(0.0055 * Math.tan(Math.PI / 180), 15);
    expect(leanShiftM(2)).toBeCloseTo(0.000096, 6);
    expect(leanShiftM(-3)).toBe(-leanShiftM(3));
    // The limit: 15°, 1.47 mm.
    expect(MAX_LEAN_STEPS * BEND_STEP_DEG).toBe(15);
    expect(leanShiftM(MAX_LEAN_STEPS)).toBeCloseTo(0.001474, 6);
  });

  it('switching mode clears a refusal, and the mode outlasts leaving edit mode', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    nudgeSelected(adjust, table, 1, 0);
    expect(adjust.problem).not.toBeNull();
    setMode(adjust, 'bend');
    expect(adjust.mode).toBe('bend');
    expect(adjust.problem).toBeNull();
    setEditing(adjust, true);
    setEditing(adjust, false);
    expect(adjust.mode).toBe('bend');
    setMode(adjust, 'nudge');
    expect(adjust.mode).toBe('nudge');
  });

  it('a lean moves the nail on the board and in the world together, and only that nail', () => {
    const table = createTable(classic);
    const adjust = selected(table, RIGHT);
    const before = table.board;
    expect(leanSelected(adjust, table, 1, 0)).toBe(true);
    expect(table.board).not.toBe(before);
    expect(table.board.nails[RIGHT]).toEqual({ x: leant(0.2573, 0, 1), y: 0.178 });
    // 0.048 mm right: one step's shift, to the nanometre.
    expect(table.board.nails[RIGHT]?.x).toBe(0.257347998);
    expect(selectedLean(adjust)).toEqual({ lx: 1, ly: 0 });
    // A lean isn't a nudge.
    expect(selectedOffset(adjust)).toEqual({ dx: 0, dy: 0 });
    expect(adjust.offsets.size).toBe(0);
    expectInSync(table);
    // Two steps left and three down: now leaning 0.5° left and 1.5° down.
    expect(leanSelected(adjust, table, -2, -3)).toBe(true);
    expect(selectedLean(adjust)).toEqual({ lx: -1, ly: -3 });
    expect(table.board.nails[RIGHT]).toEqual({ x: leant(0.2573, 0, -1), y: leant(0.178, 0, -3) });
    expectInSync(table);
    table.board.nails.forEach((n, i) => {
      if (i !== RIGHT) expect(n).toEqual(classic.nails[i]);
    });
    expect(movedNails(adjust)).toEqual([RIGHT]);
  });

  it('a lean adds to a nudge, and either can be undone without disturbing the other', () => {
    const table = createTable(classic);
    const adjust = selected(table, LEFT);
    expect(nudgeSelected(adjust, table, -7, 2)).toBe(true);
    expect(leanSelected(adjust, table, -4, 1)).toBe(true);
    expect(table.board.nails[LEFT]).toEqual({
      x: leant(0.2428, -7, -4),
      y: leant(0.178, 2, 1),
    });
    expect(selectedOffset(adjust)).toEqual({ dx: -7, dy: 2 });
    expect(selectedLean(adjust)).toEqual({ lx: -4, ly: 1 });
    // Straighten it: back to the nudged spot exactly, as if it had never leant.
    expect(leanSelected(adjust, table, 4, -1)).toBe(true);
    expect(table.board.nails[LEFT]).toEqual({ x: 0.2421, y: 0.1782 });
    expect(adjust.leans.has(LEFT)).toBe(false);
    expect(movedNails(adjust)).toEqual([LEFT]);
    expectInSync(table);
  });

  it('leaning back and forth returns the nail exactly, with no drift', () => {
    const table = createTable(classic);
    const adjust = selected(table, LEFT);
    for (let i = 0; i < 29; i++) leanSelected(adjust, table, -1, 1);
    expect(adjust.leans.get(LEFT)).toEqual({ lx: -29, ly: 29 });
    for (let i = 0; i < 29; i++) leanSelected(adjust, table, 1, -1);
    expect(table.board.nails[LEFT]).toEqual(classic.nails[LEFT]);
    expect(adjust.leans.has(LEFT)).toBe(false);
    expect(movedNails(adjust)).toEqual([]);
    expectInSync(table);
  });

  it('leans at most MAX_LEAN_STEPS each way on each axis, and refuses past it', () => {
    const table = createTable(classic);
    const adjust = selected(table, LEFT);
    expect(leanSelected(adjust, table, -MAX_LEAN_STEPS, MAX_LEAN_STEPS)).toBe(true);
    const board = table.board;
    expect(leanSelected(adjust, table, -1, 0)).toBe(false);
    expect(adjust.problem).toBe('Nails lean at most 15° each way');
    expect(leanSelected(adjust, table, 0, 1)).toBe(false);
    expect(table.board).toBe(board);
    expect(selectedLean(adjust)).toEqual({ lx: -MAX_LEAN_STEPS, ly: MAX_LEAN_STEPS });
    // Back from the limit is fine, and clears the refusal.
    expect(leanSelected(adjust, table, 1, 0)).toBe(true);
    expect(adjust.problem).toBeNull();
    // Far past it in one go: refused too, not wrapped round through 90°.
    expect(leanSelected(adjust, table, 400, 0)).toBe(false);
    expect(leanSelected(adjust, table, 0, -400)).toBe(false);
    expect(selectedLean(adjust)).toEqual({ lx: 1 - MAX_LEAN_STEPS, ly: MAX_LEAN_STEPS });
    expectInSync(table);
  });

  it('refuses to lean with nothing selected, or by part of a step', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    expect(leanSelected(adjust, table, 1, 0)).toBe(false);
    expect(adjust.problem).toBe('Select a nail first');
    const a2 = selected(table, LEFT);
    expect(leanSelected(a2, table, 0, 0.5)).toBe(false);
    expect(a2.problem).toBe('Bends are whole steps, got (0, 0.5)');
    expect(leanSelected(a2, table, Infinity, 0)).toBe(false);
    expect(table.board).toBe(classic);
    expect(a2.leans.size).toBe(0);
  });

  it('refuses a lean into another nail, with the reason, and changes nothing', () => {
    const table = createTable(classic);
    const adjust = selected(table, LEFT);
    // Nudge the left start nail 12 mm toward the right one, 0.5 mm clear of
    // it; leaning on toward it closes the gap by 0.048 mm a step.
    expect(nudgeSelected(adjust, table, 120, 0)).toBe(true);
    let leans = 0;
    while (leanSelected(adjust, table, 1, 0)) leans++;
    // tan⁻¹(0.5 / 5.5) is 5.2°: ten steps go, the eleventh touches.
    expect(leans).toBe(10);
    expect(adjust.problem).toMatch(
      /^Nail 0 can't go there: \(.*\) overlaps nails\[1\] at \(0.2573, 0.178\)$/,
    );
    expect(selectedLean(adjust)).toEqual({ lx: 10, ly: 0 });
    expect(table.board.nails[LEFT]).toEqual({ x: leant(0.2428, 120, 10), y: 0.178 });
    expectInSync(table);
  });

  it('refuses a lean into a ball in play, and the ball stays where it was', () => {
    const table = createTable(classic);
    const adjust = selected(table, RIGHT);
    const at = { x: 0.2573 + BALL_RADIUS_M + NAIL_RADIUS_M + 0.00003, y: 0.178 };
    const ball = addBall(table.world, at);
    // 0.03 mm clear: one step (0.048 mm) right is into it.
    expect(leanSelected(adjust, table, 1, 0)).toBe(false);
    expect(adjust.problem).toBe("Nail 1 can't go there: a ball in play is in the way");
    expect(table.board).toBe(classic);
    expect(ball).toMatchObject(at);
    expect(leanSelected(adjust, table, -1, 0)).toBe(true);
    expectInSync(table);
  });

  it('reset straightens and un-nudges the selected nail', () => {
    const table = createTable(classic);
    const adjust = selected(table, LEFT);
    leanSelected(adjust, table, -3, 0);
    const right = classic.nails[RIGHT];
    if (!right) throw new Error('no right nail');
    selectNailAt(adjust, table, right.x, right.y, 0.001);
    nudgeSelected(adjust, table, 2, 0);
    leanSelected(adjust, table, 0, 5);
    expect(movedNails(adjust)).toEqual([LEFT, RIGHT]);
    expect(resetSelected(adjust, table)).toBe(true);
    expect(table.board.nails[RIGHT]).toEqual(classic.nails[RIGHT]);
    expect(adjust.offsets.size).toBe(0);
    expect([...adjust.leans]).toEqual([[LEFT, { lx: -3, ly: 0 }]]);
    expect(movedNails(adjust)).toEqual([LEFT]);
    expectInSync(table);
  });

  it('two tables with the same seed and the same bends play the same game', () => {
    const play = () => {
      const table = createTable(classic, { seed: 5 });
      const adjust = selected(table, RIGHT);
      leanSelected(adjust, table, 7, -2);
      table.fire.power = BEST_POWER;
      table.fire.held = true;
      for (let i = 0; i < steps(8); i++) stepTable(table);
      return { economy: { ...table.economy }, balls: table.world.balls.map((b) => [b.x, b.y]) };
    };
    expect(play()).toEqual(play());
  });

  it('bending the two start nails 15° outward raises the start rate (M7 acceptance, headless)', () => {
    const table = createTable(classic);
    const left = selected(table, LEFT);
    for (let i = 0; i < MAX_LEAN_STEPS; i++) expect(leanSelected(left, table, -1, 0)).toBe(true);
    const right = selected(table, RIGHT);
    for (let i = 0; i < MAX_LEAN_STEPS; i++) expect(leanSelected(right, table, 1, 0)).toBe(true);
    // Each moved 1.47 mm outward.
    expect(table.board.nails[LEFT]?.x).toBeCloseTo(0.2428 - 0.001474, 6);
    expect(table.board.nails[RIGHT]?.x).toBeCloseTo(0.2573 + 0.001474, 6);
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
    // Seeded, so exact: 21.88 and 33.25 spins per ¥1000, ± 1.6 and 1.9.
    expect(after.spinsPer1000Yen - before.spinsPer1000Yen).toBeGreaterThan(
      2 * Math.hypot(before.spinsPer1000YenSe, after.spinsPer1000YenSe),
    );
  }, 30_000);
});
