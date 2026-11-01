// M8's New game (settings): the table starts again on the board as it
// stands, with the chosen starting balls and odds.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAdjust, nudgeSelected, selectNailAt } from '../../src/game/adjust';
import { createEconomy } from '../../src/game/economy';
import { attackerOpen, forceJackpot } from '../../src/game/machine';
import { type Table, createTable, newGame, stepTable } from '../../src/game/table';
import { tulipOpen } from '../../src/game/tulip';
import { parseBoard } from '../../src/sim/board';
import { SIM_STEP_S } from '../../src/sim/world';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
const BEST_POWER = 0.2;
const steps = (simS: number) => Math.round(simS / SIM_STEP_S);
const run = (table: Table, simS: number) => {
  for (let i = 0; i < steps(simS); i++) stepTable(table);
};

/** A table well into a game: balls in flight, entries, spins. */
function midGame(seed = 3): Table {
  const table = createTable(classic, { seed, jackpotProbability: 0 });
  table.fire.power = BEST_POWER;
  table.fire.held = true;
  run(table, 20);
  return table;
}

describe('new game', () => {
  it('clears the balls in play, refills the tray and resets the machine', () => {
    const table = midGame();
    expect(table.economy.launched).toBeGreaterThan(20);
    expect(table.economy.entries.start).toBeGreaterThan(0);
    expect(table.world.balls.length).toBeGreaterThan(0);
    const { economy, machine, fire } = table;
    const oldWorld = table.world;

    newGame(table, { startingBalls: 500 });

    expect(table.world).not.toBe(oldWorld);
    expect(table.world.balls).toEqual([]);
    expect(table.world.timeS).toBe(0);
    // The same economy, machine and handle: the page holds them.
    expect(table.economy).toBe(economy);
    expect(table.machine).toBe(machine);
    expect(table.fire).toBe(fire);
    expect(table.economy).toEqual(createEconomy(500));
    expect(machine).toMatchObject({
      phase: { kind: 'idle' },
      holds: [],
      forced: false,
      shown: [0, 0, 0],
      spins: 0,
      jackpots: 0,
      overflow: 0,
      roundsPlayed: 0,
      jackpotProbability: 0,
    });
    // The handle keeps its power and is still held: play carries on.
    expect(fire).toMatchObject({ power: BEST_POWER, held: true });
    run(table, 3);
    expect(table.economy.launched).toBe(5);
  });

  it('defaults to 250 balls and the odds already set', () => {
    const table = midGame();
    newGame(table);
    expect(table.economy.balls).toBe(250);
    expect(table.machine.jackpotProbability).toBe(0);
  });

  it('sets new odds', () => {
    const table = midGame();
    newGame(table, { jackpotProbability: 1 / 319 });
    expect(table.machine.jackpotProbability).toBe(1 / 319);
  });

  it('starts with no balls when asked for none: nothing launches', () => {
    const table = midGame();
    newGame(table, { startingBalls: 0 });
    run(table, 2);
    expect(table.economy).toEqual(createEconomy(0));
    expect(table.world.balls).toEqual([]);
  });

  it('ends a jackpot: the attacker shuts and the tulips close', () => {
    const table = createTable(classic, { seed: 5, jackpotProbability: 0 });
    table.fire.power = BEST_POWER;
    table.fire.held = true;
    forceJackpot(table.machine);
    let i = 0;
    while (!attackerOpen(table.machine) && i++ < steps(30)) stepTable(table);
    expect(table.world.gates[0]?.open).toBe(true);
    newGame(table);
    expect(table.machine.phase.kind).toBe('idle');
    expect(table.world.gates.every((g) => !g.open)).toBe(true);
    for (const id of ['tulip-left', 'tulip-right']) expect(tulipOpen(table.world, id)).toBe(false);
    stepTable(table);
    expect(table.world.gates[0]?.open).toBe(false);
  });

  it('keeps the board as adjusted: the new world has the moved nail', () => {
    const table = createTable(classic, { seed: 1 });
    const adjust = createAdjust(table);
    const n0 = classic.nails[0];
    if (!n0) throw new Error('no nail 0');
    expect(selectNailAt(adjust, table, n0.x, n0.y, 0.001)).toBe(0);
    expect(nudgeSelected(adjust, table, -3, 0)).toBe(true);
    const moved = table.board;
    newGame(table);
    expect(table.board).toBe(moved);
    const circle = table.world.circles[0];
    expect(circle?.x).toBeCloseTo(n0.x - 0.0003, 12);
    expect(circle?.y).toBe(n0.y);
  });

  it('takes free balls (?inplay) away with the rest', () => {
    const table = createTable(classic, { seed: 2, keepInPlay: 5 });
    run(table, 3);
    expect(table.freeBalls.size).toBeGreaterThan(0);
    newGame(table);
    expect(table.freeBalls.size).toBe(0);
    expect(table.world.balls).toEqual([]);
    // keepInPlay carries on in the new game.
    run(table, 3);
    expect(table.world.balls.length).toBeGreaterThan(0);
  });

  it('refuses bad options before changing anything', () => {
    const table = midGame();
    const world = table.world;
    const economy = structuredClone(table.economy);
    const phase = table.machine.phase;
    for (const options of [
      { startingBalls: -1 },
      { startingBalls: 2.5 },
      { jackpotProbability: 2 },
      { startingBalls: 100, jackpotProbability: NaN },
    ]) {
      expect(() => newGame(table, options)).toThrow(RangeError);
      expect(table.world).toBe(world);
      expect(table.economy).toEqual(economy);
      expect(table.machine.phase).toBe(phase);
      expect(table.machine.jackpotProbability).toBe(0);
    }
  });

  it('is deterministic: the same seed and inputs, restart included, give the same game', () => {
    const play = () => {
      const table = midGame(7);
      newGame(table, { startingBalls: 125, jackpotProbability: 1 / 99 });
      run(table, 20);
      return {
        economy: structuredClone(table.economy),
        spins: table.machine.spins,
        holds: structuredClone(table.machine.holds),
        balls: table.world.balls.map((b) => [b.x, b.y, b.vx, b.vy]),
      };
    };
    const a = play();
    expect(a.economy.launched).toBeGreaterThan(20);
    expect(play()).toEqual(a);
  });
});
