import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_FLIGHT_S,
  addTally,
  createTally,
  runBatch,
  summarize,
} from '../../src/game/montecarlo';
import { parseBoard } from '../../src/sim/board';
import { SIM_STEP_S } from '../../src/sim/world';

const classicData = () => JSON.parse(readFileSync('boards/classic.json', 'utf8'));
const classic = parseBoard(classicData());

/** A launcher firing straight up an open board: every ball flies off the top. */
const open = parseBoard({
  name: 'open',
  widthM: 0.2,
  heightM: 0.2,
  nails: [],
  rails: [],
  pockets: [
    {
      id: 'out',
      kind: 'out',
      polygon: [
        [0.15, 0.0],
        [0.2, 0.0],
        [0.2, 0.02],
        [0.15, 0.02],
      ],
    },
  ],
  launcher: { x: 0.05, y: 0.05, angleDeg: 90, minSpeedMps: 3 },
});

describe('montecarlo: runBatch', () => {
  it('accounts for every ball launched', () => {
    const t = runBatch(classic, { power: 0, seed: 1, count: 200 });
    const { start, out, foul } = t.entries;
    expect(t.launched).toBe(200);
    expect(start + out + foul + t.lost + t.stuck).toBe(200);
    expect(t.ballSteps).toBeGreaterThan(200);
  });

  it('gives the same tally for the same seed', () => {
    const a = runBatch(classic, { power: 0.62, seed: 3, count: 150 });
    const b = runBatch(classic, { power: 0.62, seed: 3, count: 150 });
    expect(b).toEqual(a);
  });

  it('gives a different run for a different seed', () => {
    const a = runBatch(classic, { power: 0, seed: 1, count: 150 });
    const b = runBatch(classic, { power: 0, seed: 2, count: 150 });
    // Total flight time is a sum over 150 chaotic paths: equal only by accident.
    expect(b.ballSteps).not.toBe(a.ballSteps);
  });

  it('adds up the same however the run is split into batches, in any order', () => {
    const whole = runBatch(classic, { power: 0.05, seed: 7, count: 120 });
    const later = runBatch(classic, { power: 0.05, seed: 7, first: 50, count: 70 });
    const earlier = runBatch(classic, { power: 0.05, seed: 7, first: 0, count: 50 });
    expect(addTally(addTally(createTally(), later), earlier)).toEqual(whole);
    const ones = createTally();
    for (let i = 119; i >= 100; i--) {
      addTally(ones, runBatch(classic, { power: 0.05, seed: 7, first: i, count: 1 }));
    }
    expect(ones).toEqual(runBatch(classic, { power: 0.05, seed: 7, first: 100, count: 20 }));
  });

  it('runs zero balls', () => {
    expect(runBatch(classic, { power: 0.5, seed: 1, count: 0 })).toEqual(createTally());
  });

  it('runs at full power and at zero power without fouls or stuck balls', () => {
    for (const power of [0, 1]) {
      const t = runBatch(classic, { power, seed: 1, count: 100 });
      expect(t.entries.foul).toBe(0);
      expect(t.stuck + t.lost).toBe(0);
    }
  });

  it('counts fouls on a board whose weakest shot can’t leave the lane', () => {
    const data = classicData();
    data.launcher.minSpeedMps = 2;
    const t = runBatch(parseBoard(data), { power: 0, seed: 1, count: 20 });
    expect(t.entries.foul).toBe(20);
  });

  it('counts balls that leave through a gap in the walls as lost', () => {
    const t = runBatch(open, { power: 0, seed: 1, count: 5 });
    expect(t).toMatchObject({ launched: 5, lost: 5, stuck: 0, entries: { out: 0 } });
  });

  it('gives up on a ball after the flight limit, counts it stuck, and clears it', () => {
    expect(MAX_FLIGHT_S).toBe(30);
    const limitS = 0.01;
    const t = runBatch(classic, { power: 0.5, seed: 1, count: 4, maxFlightS: limitS });
    expect(t.stuck).toBe(4);
    // Each ball was stepped exactly to the limit, alone: none carried over.
    expect(t.ballSteps).toBe(4 * Math.ceil(limitS / SIM_STEP_S));
  });

  it('rejects a bad power, count, seed, or flight limit', () => {
    for (const power of [-0.01, 1.01, NaN]) {
      expect(() => runBatch(classic, { power, seed: 1, count: 1 })).toThrow(RangeError);
    }
    for (const count of [-1, 1.5, NaN]) {
      expect(() => runBatch(classic, { power: 0, seed: 1, count })).toThrow(RangeError);
    }
    for (const seed of [-1, 0.5, 2 ** 32]) {
      expect(() => runBatch(classic, { power: 0, seed, count: 1 })).toThrow(RangeError);
    }
    expect(() => runBatch(classic, { power: 0, seed: 1, count: 1, maxFlightS: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('montecarlo: summarize', () => {
  it('turns a tally into rates and spins per ¥1000 (entries per 250 launched)', () => {
    const t = createTally();
    t.launched = 1000;
    t.entries.start = 80;
    t.entries.out = 910;
    t.entries.foul = 10;
    const s = summarize(t);
    expect(s).toMatchObject({ launched: 1000, startRate: 0.08, outRate: 0.91, foulRate: 0.01 });
    expect(s.spinsPer1000Yen).toBeCloseTo(20, 12);
    expect(s.spinsPer1000YenSe).toBeCloseTo(Math.sqrt((0.08 * 0.92) / 1000) * 250, 12);
  });

  it('gives all-zero rates for zero balls rather than NaN', () => {
    expect(summarize(createTally())).toEqual({
      launched: 0,
      startRate: 0,
      outRate: 0,
      foulRate: 0,
      spinsPer1000Yen: 0,
      spinsPer1000YenSe: 0,
    });
  });
});
