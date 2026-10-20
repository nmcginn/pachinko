import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type TulipMode,
  type TulipSummary,
  type TulipTally,
  MAX_FLIGHT_S,
  TRAFFIC_BALLS,
  addTally,
  createTally,
  runBatch,
  summarize,
} from '../../src/game/montecarlo';
import { parseBoard } from '../../src/sim/board';
import { SIM_STEP_S } from '../../src/sim/world';
import { tulipBoardData } from '../fixtures/tulipBoard';

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
    const { start, out, foul, attacker } = t.entries;
    expect(t.launched).toBe(200);
    expect(attacker).toBe(0); // The gate stays closed.
    expect(start + out + foul + t.lost + t.stuck).toBe(200);
    expect(t.ballSteps).toBeGreaterThan(200);
  });

  it('with the gates held open, catches balls in the attacker and changes nothing above it', () => {
    const closed = runBatch(classic, { power: 0, seed: 1, count: 300 });
    const opened = runBatch(classic, { power: 0, seed: 1, count: 300, gatesOpen: true });
    const { start, out, foul, attacker } = opened.entries;
    expect(start + out + foul + attacker + opened.lost + opened.stuck).toBe(300);
    // About 29% at power 0 (PHYSICS.md, "Attacker"): 87 expected, s.d. 8.
    expect(attacker).toBeGreaterThan(50);
    expect(summarize(opened).attackerRate).toBe(attacker / 300);
    // The attacker sits below the start pocket, so no ball's start entry depends on it.
    expect(start).toBe(closed.entries.start);
    expect(out).toBe(closed.entries.out - attacker);
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

  it('gives a batch the same tally whatever ran before it', () => {
    // Batches run one after another in a worker; nothing may carry over.
    const later = runBatch(classic, { power: 0.05, seed: 7, first: 50, count: 40 });
    runBatch(classic, { power: 1, seed: 9, count: 60 });
    expect(runBatch(classic, { power: 0.05, seed: 7, first: 50, count: 40 })).toEqual(later);
  });

  it('fires balls into one world at the auto-fire rate, so they meet', () => {
    // The same balls fired far apart in time, one per batch, never meet; fired
    // together, at least one collision changes some ball's flight.
    const together = runBatch(classic, { power: 0, seed: 7, first: 0, count: 40 });
    const apart = createTally();
    for (let i = 0; i < 40; i++) {
      // first: i with no traffic: each ball alone in its own world.
      addTally(apart, runBatch(classic, { power: 0, seed: 7, first: i, count: 1, traffic: 0 }));
    }
    expect(together.launched).toBe(apart.launched);
    expect(together.ballSteps).not.toBe(apart.ballSteps);
  });

  it('fires TRAFFIC_BALLS uncounted balls before a batch, or as many as there are', () => {
    expect(TRAFFIC_BALLS).toBe(10);
    // With a flight limit far shorter than the auto-fire interval, every
    // ball flies alone to the limit, so ballSteps counts the balls fired.
    const limitS = 0.01;
    const perBall = Math.ceil(limitS / SIM_STEP_S);
    const at = (first: number) =>
      runBatch(classic, { power: 0.5, seed: 1, first, count: 2, maxFlightS: limitS });
    expect(at(0).ballSteps).toBe(2 * perBall);
    expect(at(3).ballSteps).toBe((3 + 2) * perBall);
    expect(at(500).ballSteps).toBe((TRAFFIC_BALLS + 2) * perBall);
    // Only the batch's own balls are counted.
    expect(at(500)).toMatchObject({ launched: 2, stuck: 2 });
  });

  it('keeps the out-hole floor clear: no jam of balls lying on balls (regression)', () => {
    // Ball 4269 of this run once stopped on the floor with ball 4270 lying
    // on it, and every later ball piled up behind (PHYSICS.md, "Ball against ball").
    const t = runBatch(classic, { power: 0.2, seed: 1, first: 4250, count: 40 });
    expect(t.stuck).toBe(0);
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
    // Each ball was stepped exactly to the limit: the next isn't fired until
    // 0.6 s later, and none carried over.
    expect(t.ballSteps).toBe(4 * Math.ceil(limitS / SIM_STEP_S));
  });

  it('rejects a bad power, count, seed, or flight limit', () => {
    for (const power of [-0.01, 1.01, NaN]) {
      expect(() => runBatch(classic, { power, seed: 1, count: 1 })).toThrow(RangeError);
    }
    for (const count of [-1, 1.5, NaN]) {
      expect(() => runBatch(classic, { power: 0, seed: 1, count })).toThrow(RangeError);
    }
    for (const first of [-1, 0.5]) {
      expect(() => runBatch(classic, { power: 0, seed: 1, first, count: 1 })).toThrow(RangeError);
    }
    for (const seed of [-1, 0.5, 2 ** 32]) {
      expect(() => runBatch(classic, { power: 0, seed, count: 1 })).toThrow(RangeError);
    }
    expect(() => runBatch(classic, { power: 0, seed: 1, count: 1, maxFlightS: 0 })).toThrow(
      RangeError,
    );
  });
});

// M5 acceptance: the Monte Carlo shows a tulip's entry rate rises while it
// is open. On the test board (tests/fixtures/tulipBoard.ts): the classic
// board with one tulip, since where tulips go on the classic board is still
// the maintainer's to decide. Long runs, so a longer timeout.
describe('montecarlo: tulips', { timeout: 60_000 }, () => {
  const tulipBoard = parseBoard(tulipBoardData());
  const run = (tulips: TulipMode, count: number, seed = 1) => {
    const t = createTally();
    for (let first = 0; first < count; first += 1000) {
      const n = Math.min(1000, count - first);
      addTally(t, runBatch(tulipBoard, { power: 0, seed, first, count: n, tulips }));
    }
    return t;
  };

  it('takes far more balls held open than held closed', () => {
    const open = run('open', 1000);
    const closed = run('closed', 1000);
    const o = summarize(open).tulips[0] as TulipSummary;
    const c = summarize(closed).tulips[0] as TulipSummary;
    // About 9.0% open and 1.2% closed (PHYSICS.md, "Gates: tulips"):
    // with 1000 balls, about 90 and 12 entries.
    expect(o).toMatchObject({ id: 'tulip', closedRate: null, openShare: 1, closedEntries: 0 });
    expect(c).toMatchObject({ id: 'tulip', openRate: null, openShare: 0, openEntries: 0 });
    expect(o.openRate).toBe(o.entryRate);
    expect(c.closedRate).toBe(c.entryRate);
    expect(o.openEntries).toBeGreaterThan(3 * c.closedEntries);
    expect(c.closedEntries).toBeGreaterThan(0);
    // Nothing above the tulip changes: the balls it doesn't take go on to the out-hole.
    expect(open.entries.tulip).toBe(o.openEntries);
    for (const t of [open, closed]) {
      const { start, out, foul, attacker, tulip } = t.entries;
      expect(start + out + foul + attacker + tulip + t.lost + t.stuck).toBe(1000);
      expect(t.stuck + t.lost).toBe(0);
    }
  });

  it('in play, opens on one entry and closes on the next, and its rate while open is higher', () => {
    const t = run('play', 2000);
    const s = summarize(t).tulips[0] as TulipSummary;
    expect(s.openRate).not.toBeNull();
    expect(s.closedRate).not.toBeNull();
    expect(s.openRate as number).toBeGreaterThan(2 * (s.closedRate as number));
    // Each entry toggles it, traffic's too, so counted entries split about evenly.
    expect(s.openEntries + s.closedEntries).toBe(t.entries.tulip);
    expect(s.openEntries).toBeGreaterThan(0);
    expect(s.closedEntries).toBeGreaterThan(0);
    expect(s.openShare).toBeGreaterThan(0);
    expect(s.openShare).toBeLessThan(0.5);
    expect(t.stuck + t.lost).toBe(0);
    const { start, out, foul, attacker, tulip } = t.entries;
    expect(start + out + foul + attacker + tulip).toBe(2000);
  });

  it('gives the same tally for the same seed, tulip state and all', () => {
    const a = runBatch(tulipBoard, { power: 0, seed: 4, count: 300 });
    expect(a.entries.tulip).toBeGreaterThan(0);
    expect(runBatch(tulipBoard, { power: 0, seed: 4, count: 300 })).toEqual(a);
  });

  it('holds the attacker open with gatesOpen, and leaves the tulip to play', () => {
    const t = runBatch(tulipBoard, { power: 0, seed: 1, count: 200, gatesOpen: true });
    expect(t.entries.attacker).toBeGreaterThan(0);
    const s = t.tulips['tulip'] as TulipTally;
    expect(s.closedBallSteps).toBeGreaterThan(0);
  });

  it('tallies a board with no tulips with none, and zero balls with zero', () => {
    expect(runBatch(classic, { power: 0, seed: 1, count: 5 }).tulips).toEqual({});
    const none = runBatch(tulipBoard, { power: 0, seed: 1, count: 0 });
    expect(none.tulips).toEqual({
      tulip: { openEntries: 0, closedEntries: 0, openBallSteps: 0, closedBallSteps: 0 },
    });
    expect(summarize(none).tulips).toEqual([
      {
        id: 'tulip',
        openEntries: 0,
        closedEntries: 0,
        entryRate: 0,
        openRate: null,
        closedRate: null,
        openShare: 0,
      },
    ]);
  });

  it('rejects an unknown tulip mode', () => {
    expect(() =>
      runBatch(tulipBoard, { power: 0, seed: 1, count: 1, tulips: 'ajar' as TulipMode }),
    ).toThrow(/tulips must be one of play, open, closed/);
  });
});

describe('montecarlo: addTally and summarize with tulips', () => {
  it('adds tulip tallies by id, keeping ids only one side has', () => {
    const a = createTally();
    const b = createTally();
    a.tulips['left'] = { openEntries: 1, closedEntries: 2, openBallSteps: 10, closedBallSteps: 20 };
    b.tulips['left'] = { openEntries: 3, closedEntries: 4, openBallSteps: 30, closedBallSteps: 40 };
    b.tulips['right'] = { openEntries: 5, closedEntries: 0, openBallSteps: 50, closedBallSteps: 0 };
    b.entries.tulip = 12;
    addTally(a, b);
    expect(a.tulips).toEqual({
      left: { openEntries: 4, closedEntries: 6, openBallSteps: 40, closedBallSteps: 60 },
      right: { openEntries: 5, closedEntries: 0, openBallSteps: 50, closedBallSteps: 0 },
    });
    expect(a.entries.tulip).toBe(12);
    // b is unchanged.
    expect(b.tulips['left']?.openEntries).toBe(3);
  });

  it('turns ball-time in each state into entries per ball launched', () => {
    const t = createTally();
    t.launched = 100;
    t.entries.tulip = 6;
    // 100 balls, 4000 steps each in play: 400 000 ball-steps, a quarter of them open.
    t.tulips['t'] = { openEntries: 4, closedEntries: 2, openBallSteps: 1e5, closedBallSteps: 3e5 };
    const s = summarize(t);
    expect(s.tulipRate).toBeCloseTo(0.06, 12);
    const tulip = s.tulips[0] as TulipSummary;
    expect(tulip.entryRate).toBeCloseTo(0.06, 12);
    expect(tulip.openShare).toBeCloseTo(0.25, 12);
    // Open: 4 per 1e5 ball-steps, times 4000 steps a ball: 0.16. Closed: 2 per 3e5: 0.0267.
    expect(tulip.openRate).toBeCloseTo(0.16, 12);
    expect(tulip.closedRate).toBeCloseTo(2 / 75, 12);
  });

  it('lists tulips in id order', () => {
    const t = createTally();
    t.tulips['b'] = { openEntries: 0, closedEntries: 0, openBallSteps: 0, closedBallSteps: 0 };
    t.tulips['a'] = { openEntries: 0, closedEntries: 0, openBallSteps: 0, closedBallSteps: 0 };
    expect(summarize(t).tulips.map((x) => x.id)).toEqual(['a', 'b']);
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
      attackerRate: 0,
      spinsPer1000Yen: 0,
      spinsPer1000YenSe: 0,
      tulipRate: 0,
      tulips: [],
    });
  });
});
