import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIRE_INTERVAL_STEPS } from '../../src/game/fire';
import { createTable, stepTable } from '../../src/game/table';
import { parseBoard } from '../../src/sim/board';
import { SIM_STEP_S } from '../../src/sim/world';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
const steps = (simS: number) => Math.round(simS / SIM_STEP_S);

describe('table', () => {
  it('holding fire for 3 s launches 5 balls and takes them from the tray', () => {
    const table = createTable(classic);
    table.fire.held = true;
    for (let i = 0; i < steps(3); i++) stepTable(table);
    // Shots at 0, 0.6, 1.2, 1.8 and 2.4 s.
    expect(table.economy.launched).toBe(5);
    expect(table.economy.balls).toBe(245);
    expect(table.world.balls.length).toBeGreaterThan(0);
  });

  it('launches at the handle power at the time of the shot', () => {
    const table = createTable(classic);
    table.fire.power = 1;
    table.fire.held = true;
    stepTable(table);
    const fast = table.world.balls[0];
    const other = createTable(classic);
    other.fire.power = 0;
    other.fire.held = true;
    stepTable(other);
    const slow = other.world.balls[0];
    expect(Math.hypot(fast?.vx ?? 0, fast?.vy ?? 0)).toBeGreaterThan(
      Math.hypot(slow?.vx ?? 0, slow?.vy ?? 0),
    );
  });

  it('stops launching when the tray is empty, and every ball drains', () => {
    const table = createTable(classic, { startingBalls: 3 });
    table.fire.held = true;
    for (let i = 0; i < steps(30); i++) stepTable(table);
    expect(table.world.balls).toEqual([]);
    const { start, out, foul } = table.economy.entries;
    // Each start-pocket entry paid 3 more, which were launched in turn.
    expect(table.economy).toMatchObject({ balls: 0, launched: 3 + 3 * start });
    expect(start + out).toBe(table.economy.launched);
    expect(foul).toBe(0);
  });

  it('returns foul balls to the tray', () => {
    // The classic board with its power-0 speed lowered until every shot fouls.
    const data = JSON.parse(readFileSync('boards/classic.json', 'utf8'));
    data.launcher.minSpeedMps = 2;
    const table = createTable(parseBoard(data), { startingBalls: 3 });
    table.fire.power = 0;
    table.fire.held = true;
    for (let i = 0; i < steps(5); i++) stepTable(table);
    // Launched more than three: each foul came back and went out again.
    expect(table.economy.launched).toBeGreaterThan(3);
    expect(table.economy.entries.foul).toBe(table.economy.launched - table.world.balls.length);
    expect(table.economy.balls + table.world.balls.length).toBe(3);
  });

  it('does nothing with zero balls but advance the world', () => {
    const table = createTable(classic, { startingBalls: 0 });
    table.fire.held = true;
    for (let i = 0; i < 2 * FIRE_INTERVAL_STEPS; i++) stepTable(table);
    expect(table.world.balls).toEqual([]);
    expect(table.world.steps).toBe(2 * FIRE_INTERVAL_STEPS);
  });

  it('pays 3 balls into the tray for each start-pocket entry', () => {
    // Power 0 is the classic board's best: about one shot in twelve enters.
    const table = createTable(classic, { seed: 1 });
    table.fire.power = 0;
    table.fire.held = true;
    for (let i = 0; i < steps(60); i++) stepTable(table);
    const { economy } = table;
    expect(economy.entries.start).toBeGreaterThan(0);
    expect(economy.paidOut).toBe(3 * economy.entries.start);
    // Every ball is in the tray, in play, or gone down a pocket; payouts add to the tray.
    const { start, out } = economy.entries;
    expect(economy.balls + table.world.balls.length).toBe(250 - start - out + economy.paidOut);
  });

  it('varies launch speed shot to shot, from its seed', () => {
    const speeds = (seed: number) => {
      const table = createTable(classic, { seed });
      table.fire.held = true;
      const out: number[] = [];
      for (let i = 0; i < 3 * FIRE_INTERVAL_STEPS; i++) {
        const before = table.world.nextBallId;
        stepTable(table);
        const ball = table.world.balls.find((b) => b.id === before);
        if (ball) out.push(Math.hypot(ball.vx, ball.vy));
      }
      return out;
    };
    const a = speeds(1);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(speeds(1)).toEqual(a);
    expect(speeds(2)).not.toEqual(a);
  });

  it('plays out identically twice', () => {
    const run = () => {
      const table = createTable(classic, { seed: 42 });
      table.fire.held = true;
      table.fire.power = 0.62;
      const out: number[] = [];
      for (let i = 0; i < steps(4); i++) {
        stepTable(table);
        for (const b of table.world.balls) out.push(b.id, b.x, b.y);
      }
      return { out, economy: table.economy };
    };
    const a = run();
    const b = run();
    expect(b.out).toEqual(a.out);
    expect(b.economy).toEqual(a.economy);
  });
});
