// Sound cues (M6): what the table's steps should sound like. The WebAudio
// side is tests/audio/sound.test.ts.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Cue,
  MAX_PENDING_CUES,
  RATTLE_INTERVAL_STEPS,
  RATTLE_MIN_SPEED_MPS,
  collectCues,
  createCueTracker,
  drainCues,
} from '../../src/audio/cues';
import { SPIN_STEPS, forceJackpot } from '../../src/game/machine';
import { type Table, createTable, stepTable } from '../../src/game/table';
import { REEL_STOP_AT, STEPS_PER_SYMBOL } from '../../src/render/reel';
import { parseBoard } from '../../src/sim/board';
import { MAX_LAUNCH_SPEED_MPS, SIM_STEP_S } from '../../src/sim/world';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
const steps = (simS: number) => Math.round(simS / SIM_STEP_S);
/** The classic board's best power (PLAN.md Status). */
const BEST_POWER = 0.2;

interface Stamped {
  readonly step: number;
  readonly cue: Cue;
}

/** Step the table `n` times, collecting cues and draining every step. Cues are stamped with the step (1-based) that made them. */
function run(table: Table, n: number, tracker = createCueTracker(table)): Stamped[] {
  const out: Stamped[] = [];
  for (let i = 1; i <= n; i++) {
    stepTable(table);
    collectCues(tracker, table);
    for (const cue of drainCues(tracker)) out.push({ step: i, cue });
  }
  return out;
}

const ofKind = (cues: readonly Stamped[], kind: Cue['kind']) =>
  cues.filter((c) => c.cue.kind === kind);

describe('sound cues', () => {
  it('an idle table with no balls makes no sound', () => {
    expect(run(createTable(classic), steps(10))).toEqual([]);
  });

  it('holding fire with an empty tray makes no sound', () => {
    const table = createTable(classic, { startingBalls: 0 });
    table.fire.held = true;
    expect(run(table, steps(5))).toEqual([]);
  });

  it('a start entry chimes once, on its step, then its spin ticks and stops three reels', () => {
    // Seed 54 at the best power: the first shot enters the start pocket and
    // nothing else pays for 10 s (the e2e test's seed).
    const table = createTable(classic, { seed: 54 });
    table.fire.power = BEST_POWER;
    table.fire.held = true;
    const tracker = createCueTracker(table);
    let entryStep = 0;
    const cues: Stamped[] = [];
    for (let i = 1; i <= steps(8); i++) {
      stepTable(table);
      collectCues(tracker, table);
      if (!entryStep && table.economy.entries.start === 1) entryStep = i;
      for (const cue of drainCues(tracker)) cues.push({ step: i, cue });
    }
    expect(entryStep).toBeGreaterThan(0);
    expect(table.economy.entries.tulip + table.economy.entries.attacker).toBe(0);
    expect(ofKind(cues, 'chime')).toEqual([
      { step: entryStep, cue: { kind: 'chime', pocket: 'start' } },
    ]);
    // The entry's spin starts on the same step and runs SPIN_STEPS.
    expect(table.machine.spins).toBe(1);
    const stops = ofKind(cues, 'reel-stop').map((c) => c.step - entryStep);
    expect(stops).toEqual(
      REEL_STOP_AT.map((at) => Math.ceil(at * SPIN_STEPS)).sort((a, b) => a - b),
    );
    const ticks = ofKind(cues, 'reel-tick');
    expect(ticks.length).toBeGreaterThan(100);
    for (const t of ticks) {
      const into = t.step - entryStep;
      expect(into % STEPS_PER_SYMBOL).toBe(0);
      expect(into).toBeGreaterThan(0);
      expect(into).toBeLessThan(SPIN_STEPS);
    }
    expect(ofKind(cues, 'fanfare')).toEqual([]);
    // Balls in the field rattle.
    expect(ofKind(cues, 'rattle').length).toBeGreaterThan(20);
  });

  it('a forced jackpot plays a full spin of ticks, three stops, then the fanfare', () => {
    const table = createTable(classic);
    forceJackpot(table.machine);
    const cues = run(table, SPIN_STEPS + 100);
    // The spin starts on step 1, so elapsed steps lag the step count by one.
    const ticks = ofKind(cues, 'reel-tick');
    expect(ticks.length).toBe(Math.floor((SPIN_STEPS - 1) / STEPS_PER_SYMBOL));
    expect(ticks.every((t) => (t.step - 1) % STEPS_PER_SYMBOL === 0)).toBe(true);
    expect(ofKind(cues, 'reel-stop').map((c) => c.step)).toEqual([
      SPIN_STEPS / 2 + 1,
      (SPIN_STEPS * 3) / 4 + 1,
      SPIN_STEPS + 1,
    ]);
    const fanfare = ofKind(cues, 'fanfare');
    expect(fanfare.map((c) => c.step)).toEqual([SPIN_STEPS + 1]);
    // The last reel stops, then the fanfare, in that order on that step.
    const last = cues.filter((c) => c.step === SPIN_STEPS + 1).map((c) => c.cue.kind);
    expect(last).toEqual(['reel-stop', 'fanfare']);
    expect(ofKind(cues, 'chime')).toEqual([]);
    expect(ofKind(cues, 'rattle')).toEqual([]);
  });

  it('chimes for every tulip and attacker entry, and never for the out-hole or a foul', () => {
    const table = createTable(classic, { seed: 3, startingBalls: 400 });
    table.fire.power = BEST_POWER;
    table.fire.held = true;
    forceJackpot(table.machine);
    const cues = run(table, steps(120));
    const { entries } = table.economy;
    expect(entries.attacker).toBeGreaterThan(0);
    expect(entries.out).toBeGreaterThan(0);
    const chimes = ofKind(cues, 'chime').map((c) => (c.cue as { pocket: string }).pocket);
    const count = (p: string) => chimes.filter((x) => x === p).length;
    expect(count('start')).toBe(entries.start);
    expect(count('tulip')).toBe(entries.tulip);
    expect(count('attacker')).toBe(entries.attacker);
    expect(chimes.length).toBe(entries.start + entries.tulip + entries.attacker);
  });

  for (const power of [BEST_POWER, 1]) {
    it(`rattles at most once per ${RATTLE_INTERVAL_STEPS} steps, only for real strikes (power ${power})`, () => {
      const table = createTable(classic, { seed: 7 });
      table.fire.power = power;
      table.fire.held = true;
      const rattles = ofKind(run(table, steps(20)), 'rattle');
      expect(rattles.length).toBeGreaterThan(50);
      for (let i = 1; i < rattles.length; i++) {
        expect(
          (rattles[i] as Stamped).step - (rattles[i - 1] as Stamped).step,
        ).toBeGreaterThanOrEqual(RATTLE_INTERVAL_STEPS);
      }
      for (const { cue } of rattles) {
        const speed = (cue as { speedMps: number }).speedMps;
        expect(speed).toBeGreaterThanOrEqual(RATTLE_MIN_SPEED_MPS);
        // A ball is never moving faster than the hardest shot plus a full board's fall.
        expect(speed).toBeLessThan(2 * MAX_LAUNCH_SPEED_MPS);
      }
    });
  }

  it('the same seed gives the same cues', () => {
    const play = () => {
      const table = createTable(classic, { seed: 187 });
      table.fire.power = BEST_POWER;
      table.fire.held = true;
      return run(table, steps(15));
    };
    const first = play();
    expect(first.length).toBeGreaterThan(0);
    expect(play()).toEqual(first);
  });

  it('a tracker made mid-game sounds nothing for what already happened', () => {
    const table = createTable(classic, { seed: 54 });
    table.fire.power = BEST_POWER;
    table.fire.held = true;
    run(table, steps(3));
    expect(table.economy.entries.start).toBe(1);
    table.fire.held = false;
    const tracker = createCueTracker(table);
    // Let the field drain and the spin finish without new balls: no chime.
    const later = run(table, steps(8), tracker);
    expect(ofKind(later, 'chime')).toEqual([]);
  });

  it('holds at most MAX_PENDING_CUES between drains, keeping the oldest, and drains to empty', () => {
    const table = createTable(classic);
    forceJackpot(table.machine);
    const tracker = createCueTracker(table);
    for (let i = 0; i < SPIN_STEPS; i++) {
      stepTable(table);
      collectCues(tracker, table);
    }
    expect(tracker.pending.length).toBe(MAX_PENDING_CUES);
    const drained = drainCues(tracker);
    expect(drained.length).toBe(MAX_PENDING_CUES);
    // The oldest kept: the same first cues a drain every step gives, not the final stop.
    const uncapped = createTable(classic);
    forceJackpot(uncapped.machine);
    const first = run(uncapped, SPIN_STEPS).map((c) => c.cue);
    expect(drained).toEqual(first.slice(0, MAX_PENDING_CUES));
    expect(first.length).toBeGreaterThan(MAX_PENDING_CUES);
    expect(tracker.pending).toEqual([]);
    expect(drainCues(tracker)).toEqual([]);
  });

  it('collecting cues never changes the table', () => {
    const play = (withCues: boolean) => {
      const table = createTable(classic, { seed: 11 });
      table.fire.power = BEST_POWER;
      table.fire.held = true;
      const tracker = createCueTracker(table);
      for (let i = 0; i < steps(6); i++) {
        stepTable(table);
        if (withCues) collectCues(tracker, table);
      }
      return {
        balls: table.world.balls.map((b) => [b.x, b.y, b.vx, b.vy]),
        economy: table.economy,
        spins: table.machine.spins,
      };
    };
    expect(play(true)).toEqual(play(false));
  });
});
