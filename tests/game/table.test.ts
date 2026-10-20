import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATTACKER_PAYOUT, START_POCKET_PAYOUT, TULIP_PAYOUT } from '../../src/game/economy';
import { FIRE_INTERVAL_STEPS } from '../../src/game/fire';
import { ROUNDS, attackerOpen, forceJackpot } from '../../src/game/machine';
import { type Table, createTable, stepTable } from '../../src/game/table';
import { tulipOpen } from '../../src/game/tulip';
import { parseBoard } from '../../src/sim/board';
import { SIM_STEP_S, addBall } from '../../src/sim/world';
import { tulipMouth, underLeftOpenWing } from '../fixtures/tulips';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
/** The classic board's best handle power (PHYSICS.md tuning log, the handle remap). */
const BEST_POWER = 0.2;
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
    const { start, out, foul, tulip } = table.economy.entries;
    // Each start-pocket or tulip entry paid 3 more, which were launched in turn.
    expect(table.economy).toMatchObject({ balls: 0, launched: 3 + 3 * (start + tulip) });
    expect(start + out + tulip).toBe(table.economy.launched);
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

  it('holds a shot while a ball sits at the launch point, then fires', () => {
    // Balls collide (M5), so a ball can't appear on top of another. In play
    // a foul clears the launch point well within the 0.6 s between shots;
    // here a ball is put there by hand.
    const table = createTable(classic);
    const { x, y } = classic.launcher;
    addBall(table.world, { x, y });
    table.fire.held = true;
    stepTable(table);
    expect(table.economy.launched).toBe(0);
    let waited = 1;
    while (table.economy.launched === 0 && waited < 1000) {
      stepTable(table);
      waited += 1;
    }
    expect(table.economy.launched).toBe(1);
    expect(table.economy.balls).toBe(249);
    expect(waited).toBeGreaterThan(1);
  });

  it('does nothing with zero balls but advance the world', () => {
    const table = createTable(classic, { startingBalls: 0 });
    table.fire.held = true;
    for (let i = 0; i < 2 * FIRE_INTERVAL_STEPS; i++) stepTable(table);
    expect(table.world.balls).toEqual([]);
    expect(table.world.steps).toBe(2 * FIRE_INTERVAL_STEPS);
  });

  it('pays 3 balls into the tray for each start-pocket entry', () => {
    // At the best power about one shot in twelve enters.
    const table = createTable(classic, { seed: 1 });
    table.fire.power = BEST_POWER;
    table.fire.held = true;
    for (let i = 0; i < steps(60); i++) stepTable(table);
    const { economy } = table;
    const { start, out, tulip } = economy.entries;
    expect(start).toBeGreaterThan(0);
    expect(economy.paidOut).toBe(3 * start + TULIP_PAYOUT * tulip);
    // Every ball is in the tray, in play, or gone down a pocket; payouts add to the tray.
    expect(economy.balls + table.world.balls.length).toBe(
      250 - start - out - tulip + economy.paidOut,
    );
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

  // Over two minutes of sim time, stepped one by one: about 3 s locally,
  // longer on a shared CI runner, so more than vitest's 5 s default.
  it(
    'plays a forced jackpot through 10 rounds, the attacker opening only for each round',
    {
      timeout: 30_000,
    },
    () => {
      const table = createTable(classic, { seed: 5, jackpotProbability: 0 });
      const { machine, world, economy } = table;
      table.fire.power = BEST_POWER;
      table.fire.held = true;
      const gate = world.gates[0];
      expect(gate?.id).toBe('attacker');
      forceJackpot(machine);
      let opened = 0;
      let wasOpen = false;
      const roundEnds: number[] = [];
      for (let i = 0; i < steps(400) && !(machine.roundsPlayed === ROUNDS); i++) {
        stepTable(table);
        // The world's gate follows the machine on every step.
        expect(gate?.open).toBe(attackerOpen(machine));
        if (gate?.open && !wasOpen) opened += 1;
        if (wasOpen && !gate?.open) roundEnds.push(world.timeS);
        wasOpen = gate?.open ?? false;
      }
      expect(machine.roundsPlayed).toBe(ROUNDS);
      expect(opened).toBe(ROUNDS);
      expect(roundEnds).toHaveLength(ROUNDS);
      // Over; any spins held during the rounds play now.
      expect(machine.phase.kind).not.toBe('jackpot');
      expect(machine.jackpots).toBe(1);
      // Firing at the auto-fire rate, the attacker took balls, and each paid 15.
      const { start, out, attacker, tulip } = economy.entries;
      expect(attacker).toBeGreaterThan(ROUNDS * 5);
      expect(economy.paidOut).toBe(
        START_POCKET_PAYOUT * start + ATTACKER_PAYOUT * attacker + TULIP_PAYOUT * tulip,
      );
      expect(economy.balls + world.balls.length).toBe(
        250 - start - out - attacker - tulip + economy.paidOut,
      );
    },
  );

  it('keeps the attacker shut outside a jackpot', () => {
    const table = createTable(classic, { seed: 1, jackpotProbability: 0 });
    table.fire.power = BEST_POWER;
    table.fire.held = true;
    for (let i = 0; i < steps(60); i++) stepTable(table);
    expect(table.economy.entries.start).toBeGreaterThan(0);
    expect(table.economy.entries.attacker).toBe(0);
    expect(table.world.gates[0]?.open).toBe(false);
    expect(table.machine.spins).toBeGreaterThan(0);
  });

  it('draws the lottery from its own stream: jackpot odds never shift launch speeds', () => {
    const run = (jackpotProbability: number) => {
      const table = createTable(classic, { seed: 1, jackpotProbability });
      table.fire.power = BEST_POWER;
      table.fire.held = true;
      const speeds: number[] = [];
      for (let i = 0; i < steps(60); i++) {
        const before = table.world.nextBallId;
        stepTable(table);
        const ball = table.world.balls.find((b) => b.id === before);
        if (ball) speeds.push(Math.hypot(ball.vx, ball.vy));
      }
      return { speeds, machine: table.machine };
    };
    const never = run(0);
    const always = run(1);
    expect(never.speeds).toHaveLength(100);
    expect(always.speeds).toEqual(never.speeds);
    expect(never.machine.jackpots).toBe(0);
    expect(always.machine.jackpots).toBeGreaterThan(0);
  });

  describe('tulips', () => {
    const TULIPS = ['tulip-left', 'tulip-right'];
    const openCount = (table: Table) => TULIPS.filter((id) => tulipOpen(table.world, id)).length;

    /** Drop a ball straight into a tulip's mouth and step until a tulip takes it. Returns the steps taken. */
    function dropIntoTulip(table: Table, id: string): number {
      const before = table.economy.entries.tulip;
      const mouth = tulipMouth(classic, id);
      addBall(table.world, { x: mouth.xM, y: mouth.yM + 0.02 });
      for (let i = 1; i <= steps(1); i++) {
        stepTable(table);
        if (table.economy.entries.tulip > before) return i;
      }
      throw new Error(`${id} never took the ball`);
    }

    it('each opens on an entry, closes on the next, and pays each', () => {
      for (const id of TULIPS) {
        const table = createTable(classic, { startingBalls: 0 });
        expect(tulipOpen(table.world, id)).toBe(false);
        dropIntoTulip(table, id);
        expect(tulipOpen(table.world, id)).toBe(true);
        expect(openCount(table)).toBe(1);
        expect(table.economy).toMatchObject({ balls: TULIP_PAYOUT, paidOut: TULIP_PAYOUT });
        dropIntoTulip(table, id);
        expect(tulipOpen(table.world, id)).toBe(false);
        dropIntoTulip(table, id);
        expect(tulipOpen(table.world, id)).toBe(true);
        expect(table.economy.entries.tulip).toBe(3);
        expect(table.economy.paidOut).toBe(3 * TULIP_PAYOUT);
        // Stays open with nothing entering: no timer.
        for (let i = 0; i < steps(5); i++) stepTable(table);
        expect(tulipOpen(table.world, id)).toBe(true);
      }
    });

    it('records a ball the opening wings sweep in as an entry, which closes it again', () => {
      const id = 'tulip-left';
      const mouth = tulipMouth(classic, id);
      // How many steps the drop takes, from a dry run: the same every time.
      const dropSteps = dropIntoTulip(createTable(classic, { startingBalls: 0 }), id);
      const table = createTable(classic, { startingBalls: 0 });
      addBall(table.world, { x: mouth.xM, y: mouth.yM + 0.02 });
      for (let i = 1; i < dropSteps; i++) stepTable(table);
      expect(table.economy.entries.tulip).toBe(0);
      // A ball where the left open wing is about to appear (clear of the closed one).
      addBall(table.world, underLeftOpenWing(mouth));
      stepTable(table);
      expect(table.economy.entries.tulip).toBe(2);
      expect(table.economy.paidOut).toBe(2 * TULIP_PAYOUT);
      expect(tulipOpen(table.world, id)).toBe(false);
      expect(table.world.balls).toEqual([]);
    });

    it('take entries in normal play at the best power, and every ball is accounted for', () => {
      const table = createTable(classic, { seed: 3, jackpotProbability: 0 });
      table.fire.power = BEST_POWER;
      table.fire.held = true;
      let toggles = 0;
      let wasOpen = TULIPS.map(() => false);
      for (let i = 0; i < steps(120); i++) {
        stepTable(table);
        const open = TULIPS.map((id) => tulipOpen(table.world, id));
        toggles += open.filter((o, k) => o !== wasOpen[k]).length;
        wasOpen = open;
      }
      const { economy } = table;
      const { start, out, foul, tulip } = economy.entries;
      expect(tulip).toBeGreaterThan(0);
      // Every entry toggles one tulip; two into one tulip in one step would show as none.
      expect(toggles).toBeLessThanOrEqual(tulip);
      expect(toggles % 2).toBe(tulip % 2);
      expect(openCount(table) % 2).toBe(tulip % 2);
      expect(economy.paidOut).toBe(START_POCKET_PAYOUT * start + TULIP_PAYOUT * tulip);
      // Fouls go back to the tray.
      expect(economy.balls + table.world.balls.length).toBe(
        250 - start - out - tulip + economy.paidOut,
      );
      expect(foul).toBe(0);
    });

    it('play out identically twice', () => {
      const run = () => {
        const table = createTable(classic, { seed: 3 });
        table.fire.power = BEST_POWER;
        table.fire.held = true;
        const out: number[] = [];
        for (let i = 0; i < steps(40); i++) {
          stepTable(table);
          out.push(openCount(table));
          for (const b of table.world.balls) out.push(b.id, b.x, b.y);
        }
        return { out, economy: table.economy };
      };
      const a = run();
      expect(a.economy.entries.tulip).toBeGreaterThanOrEqual(2);
      expect(run()).toEqual(a);
    });
  });
});
