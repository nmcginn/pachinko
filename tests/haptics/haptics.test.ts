// Haptics (M6), against a fake motor that records each vibrate() call.
// Whether the buzzes feel right is for a phone in the hand; this checks
// which cues buzz, that patterns never overlap or blur, and that nothing
// buzzes before the first interaction or while switched off.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Cue, collectCues, createCueTracker, drainCues } from '../../src/audio/cues';
import { forceJackpot } from '../../src/game/machine';
import { createTable, stepTable } from '../../src/game/table';
import {
  CHIME_PATTERN,
  FANFARE_PATTERN,
  MIN_GAP_MS,
  REEL_STOP_PATTERN,
  createHaptics,
  patternMs,
  strongestCue,
} from '../../src/haptics/haptics';
import { parseBoard } from '../../src/sim/board';
import { SIM_STEP_S } from '../../src/sim/world';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
/** The classic board's best power (PLAN.md Status). */
const BEST_POWER = 0.2;

const rattle: Cue = { kind: 'rattle', speedMps: 1 };
const tick: Cue = { kind: 'reel-tick' };
const stop: Cue = { kind: 'reel-stop' };
const fanfare: Cue = { kind: 'fanfare' };
const chime = (pocket: 'start' | 'tulip' | 'attacker'): Cue => ({ kind: 'chime', pocket });

function fakeMotor(options: { activated?: boolean; accepts?: boolean } = {}) {
  const calls: { atMs: number; pattern: number[] }[] = [];
  const motor = {
    calls,
    nowMs: 1000,
    activated: options.activated ?? true,
    accepts: options.accepts ?? true,
    host: {
      vibrate(pattern: number[]) {
        calls.push({ atMs: motor.nowMs, pattern });
        return motor.accepts;
      },
      now: () => motor.nowMs,
      activated: () => motor.activated,
    },
  };
  return motor;
}

const patterns = (motor: ReturnType<typeof fakeMotor>) =>
  motor.calls.map((c) => JSON.stringify(c.pattern));

describe('which cue buzzes', () => {
  it('nothing for an empty batch, rattles, or reel ticks', () => {
    expect(strongestCue([])).toBeNull();
    expect(strongestCue([rattle, tick, rattle])).toBeNull();
  });

  it('the strongest in the batch: fanfare, attacker, start, tulip, reel stop', () => {
    const order = [fanfare, chime('attacker'), chime('start'), chime('tulip'), stop];
    order.forEach((cue, i) => {
      expect(strongestCue([rattle, ...order.slice(i + 1), cue, tick])).toBe(cue);
    });
  });

  it('ties go to the earliest', () => {
    const first = chime('start');
    expect(strongestCue([first, chime('start')])).toBe(first);
  });

  it('patterns are valid for the Vibration API: positive, whole ms, odd-length (end on a pulse)', () => {
    for (const p of [FANFARE_PATTERN, REEL_STOP_PATTERN, ...Object.values(CHIME_PATTERN)]) {
      expect(p.length % 2).toBe(1);
      for (const ms of p) {
        expect(Number.isInteger(ms)).toBe(true);
        expect(ms).toBeGreaterThan(0);
      }
    }
    expect(patternMs(FANFARE_PATTERN)).toBe(610);
    // The bigger payout buzzes longer.
    expect(patternMs(CHIME_PATTERN.attacker)).toBeGreaterThan(patternMs(CHIME_PATTERN.start));
    expect(patternMs(CHIME_PATTERN.start)).toBeGreaterThan(patternMs(CHIME_PATTERN.tulip));
  });
});

describe('the player', () => {
  it('buzzes the strongest cue once per batch, as a copy of the pattern', () => {
    const motor = fakeMotor();
    createHaptics(motor.host).play([rattle, chime('tulip'), chime('start'), tick]);
    expect(motor.calls).toEqual([{ atMs: 1000, pattern: [...CHIME_PATTERN.start] }]);
    expect(motor.calls[0]?.pattern).not.toBe(CHIME_PATTERN.start);
  });

  it('never calls the motor for a batch with nothing to buzz', () => {
    const motor = fakeMotor();
    const haptics = createHaptics(motor.host);
    haptics.play([]);
    haptics.play([rattle, tick]);
    expect(motor.calls).toEqual([]);
  });

  it('nothing before the first interaction, not even the fanfare', () => {
    const motor = fakeMotor({ activated: false });
    const haptics = createHaptics(motor.host);
    haptics.play([fanfare]);
    haptics.setEnabled(false);
    haptics.setEnabled(true);
    expect(motor.calls).toEqual([]);
    motor.activated = true;
    haptics.play([fanfare]);
    expect(motor.calls).toHaveLength(1);
  });

  it('waits for a pattern to end, plus the gap, before the next', () => {
    const motor = fakeMotor();
    const haptics = createHaptics(motor.host);
    haptics.play([chime('start')]);
    const quietMs = patternMs(CHIME_PATTERN.start) + MIN_GAP_MS;
    motor.nowMs += quietMs - 1;
    haptics.play([chime('attacker')]);
    expect(motor.calls).toHaveLength(1);
    motor.nowMs += 1;
    haptics.play([chime('attacker')]);
    expect(motor.calls.map((c) => c.pattern)).toEqual([
      [...CHIME_PATTERN.start],
      [...CHIME_PATTERN.attacker],
    ]);
  });

  it('the fanfare cuts in; nothing else cuts into it', () => {
    const motor = fakeMotor();
    const haptics = createHaptics(motor.host);
    haptics.play([chime('start')]);
    motor.nowMs += 1;
    haptics.play([fanfare]);
    motor.nowMs += patternMs(FANFARE_PATTERN) + MIN_GAP_MS - 2;
    haptics.play([chime('attacker')]);
    expect(motor.calls.map((c) => c.pattern)).toEqual([
      [...CHIME_PATTERN.start],
      [...FANFARE_PATTERN],
    ]);
  });

  it('a refused call does not hold off the next', () => {
    const motor = fakeMotor({ accepts: false });
    const haptics = createHaptics(motor.host);
    haptics.play([chime('start')]);
    motor.accepts = true;
    haptics.play([chime('start')]);
    expect(motor.calls).toHaveLength(2);
  });

  it('switched off: silent, and a pattern in progress is stopped', () => {
    const motor = fakeMotor();
    const haptics = createHaptics(motor.host);
    expect(haptics.enabled).toBe(true);
    haptics.play([fanfare]);
    haptics.setEnabled(false);
    expect(haptics.enabled).toBe(false);
    expect(motor.calls.at(-1)?.pattern).toEqual([0]);
    haptics.play([fanfare, chime('start')]);
    haptics.setEnabled(false);
    expect(motor.calls).toHaveLength(2);
    // Back on: free to buzz at once, not held off by the stopped pattern.
    haptics.setEnabled(true);
    haptics.play([chime('tulip')]);
    expect(motor.calls.at(-1)?.pattern).toEqual([...CHIME_PATTERN.tulip]);
  });

  it('can start switched off', () => {
    const motor = fakeMotor();
    createHaptics(motor.host, { enabled: false }).play([fanfare]);
    expect(motor.calls).toEqual([]);
  });
});

describe('on a real table', () => {
  /**
   * Play the table at 60 frames a second for `simS`, draining cues once per
   * frame into the player the way main.ts does. Time is sim time.
   */
  function play(seed: number, simS: number, before?: (t: ReturnType<typeof createTable>) => void) {
    const table = createTable(classic, { seed });
    table.fire.power = BEST_POWER;
    table.fire.held = true;
    before?.(table);
    const tracker = createCueTracker(table);
    const motor = fakeMotor();
    const haptics = createHaptics(motor.host);
    const stepsPerFrame = Math.round(1 / 60 / SIM_STEP_S);
    let rattles = 0;
    for (let step = 1; step * SIM_STEP_S <= simS; step++) {
      stepTable(table);
      collectCues(tracker, table);
      if (step % stepsPerFrame === 0) {
        motor.nowMs = step * SIM_STEP_S * 1000;
        const cues = drainCues(tracker);
        rattles += cues.filter((c) => c.kind === 'rattle').length;
        haptics.play(cues);
      }
    }
    return { table, motor, rattles };
  }

  it('buzzes for entries and reel stops, never for the rattle, and never overlaps', () => {
    const { table, motor, rattles } = play(3, 30);
    const { entries } = table.economy;
    expect(rattles).toBeGreaterThan(300);
    expect(entries.start).toBeGreaterThan(0);
    // Each buzz is a known pattern, and each waits for the one before plus the gap.
    const known = [REEL_STOP_PATTERN, CHIME_PATTERN.start, CHIME_PATTERN.tulip].map((p) =>
      JSON.stringify(p),
    );
    for (const call of motor.calls) expect(known).toContain(JSON.stringify(call.pattern));
    motor.calls.slice(1).forEach((next, i) => {
      const prev = motor.calls[i] ?? next;
      expect(next.atMs - prev.atMs).toBeGreaterThanOrEqual(patternMs(prev.pattern) + MIN_GAP_MS);
    });
    // Far fewer buzzes than rattles: the motor is for the moments that pay.
    expect(motor.calls.length).toBeLessThan(rattles / 20);
    expect(patterns(motor)).toContain(JSON.stringify(CHIME_PATTERN.start));
  });

  it('a forced jackpot buzzes the fanfare, then the attacker entries', () => {
    const { table, motor } = play(3, 60, (t) => forceJackpot(t.machine));
    expect(table.machine.jackpots).toBe(1);
    const seen = patterns(motor);
    const at = seen.indexOf(JSON.stringify(FANFARE_PATTERN));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(seen.indexOf(JSON.stringify(CHIME_PATTERN.attacker))).toBeGreaterThan(at);
  });

  it('the same seed buzzes the same way twice', () => {
    expect(play(5, 20).motor.calls).toEqual(play(5, 20).motor.calls);
  });

  it('a table with no shots fired never buzzes', () => {
    const table = createTable(classic, { seed: 1 });
    const tracker = createCueTracker(table);
    const motor = fakeMotor();
    const haptics = createHaptics(motor.host);
    for (let i = 0; i < 4000; i++) {
      stepTable(table);
      collectCues(tracker, table);
      haptics.play(drainCues(tracker));
    }
    expect(motor.calls).toEqual([]);
  });
});
