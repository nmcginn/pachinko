import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Tally,
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

const classicData = () => JSON.parse(readFileSync('boards/classic.json', 'utf8'));
const classic = parseBoard(classicData());
/** The classic board's best handle power (PHYSICS.md tuning log, the handle remap). */
const BEST_POWER = 0.2;

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
    const t = runBatch(classic, { power: BEST_POWER, seed: 1, count: 200 });
    const { start, out, foul, attacker, tulip } = t.entries;
    expect(t.launched).toBe(200);
    expect(attacker).toBe(0); // The gate stays closed.
    expect(start + out + foul + tulip + t.lost + t.stuck).toBe(200);
    expect(t.ballSteps).toBeGreaterThan(200);
  });

  it('with the gates held open, catches balls in the attacker and changes nothing above it', () => {
    const closed = runBatch(classic, { power: BEST_POWER, seed: 1, count: 300 });
    const opened = runBatch(classic, { power: BEST_POWER, seed: 1, count: 300, gatesOpen: true });
    const { start, out, foul, attacker, tulip } = opened.entries;
    expect(start + out + foul + attacker + tulip + opened.lost + opened.stuck).toBe(300);
    // About 28% at the best power (PHYSICS.md tuning log, the handle remap): 83 expected, s.d. 8.
    expect(attacker).toBeGreaterThan(50);
    expect(summarize(opened).attackerRate).toBe(attacker / 300);
    // The attacker sits below the start pocket and the tulips, so no ball's
    // start or tulip entry depends on it.
    expect(start).toBe(closed.entries.start);
    expect(tulip).toBe(closed.entries.tulip);
    expect(out).toBe(closed.entries.out - attacker);
  });

  it('gives the same tally for the same seed', () => {
    const a = runBatch(classic, { power: 0.62, seed: 3, count: 150 });
    const b = runBatch(classic, { power: 0.62, seed: 3, count: 150 });
    expect(b).toEqual(a);
  });

  // Pinned tallies, to the ball-step, recorded on master before the step's
  // performance work of 2026-10-23. A change that only makes the sim faster
  // must leave them exactly as they are; ballSteps moves if any ball's flight
  // changes by a single step. A deliberate physics or board change will move
  // them too: re-record them then, with the before and after Monte Carlo
  // numbers in PHYSICS.md's tuning log.
  it('gives exactly the recorded tallies (pinned, to catch a speed-up that changes results)', () => {
    expect(runBatch(classic, { power: BEST_POWER, seed: 1, first: 1000, count: 300 })).toEqual({
      launched: 300,
      entries: { start: 23, out: 261, foul: 0, attacker: 0, tulip: 16 },
      lost: 0,
      stuck: 0,
      ballSteps: 1063717,
      tulips: {
        'tulip-left': {
          openEntries: 4,
          closedEntries: 4,
          openBallSteps: 92178,
          closedBallSteps: 933018,
        },
        'tulip-right': {
          openEntries: 4,
          closedEntries: 4,
          openBallSteps: 117480,
          closedBallSteps: 907716,
        },
      },
    });
    expect(
      runBatch(classic, { power: 0.62, seed: 5, count: 150, gatesOpen: true, tulips: 'open' }),
    ).toEqual({
      launched: 150,
      entries: { start: 1, out: 124, foul: 0, attacker: 12, tulip: 13 },
      lost: 0,
      stuck: 0,
      ballSteps: 361753,
      tulips: {
        'tulip-left': {
          openEntries: 0,
          closedEntries: 0,
          openBallSteps: 359773,
          closedBallSteps: 0,
        },
        'tulip-right': {
          openEntries: 13,
          closedEntries: 0,
          openBallSteps: 359773,
          closedBallSteps: 0,
        },
      },
    });
  });

  it('gives a different run for a different seed', () => {
    const a = runBatch(classic, { power: BEST_POWER, seed: 1, count: 150 });
    const b = runBatch(classic, { power: BEST_POWER, seed: 2, count: 150 });
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
    const together = runBatch(classic, { power: BEST_POWER, seed: 7, first: 0, count: 40 });
    const apart = createTally();
    for (let i = 0; i < 40; i++) {
      // first: i with no traffic: each ball alone in its own world.
      addTally(
        apart,
        runBatch(classic, { power: BEST_POWER, seed: 7, first: i, count: 1, traffic: 0 }),
      );
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
    const zero = { openEntries: 0, closedEntries: 0, openBallSteps: 0, closedBallSteps: 0 };
    expect(runBatch(classic, { power: 0.5, seed: 1, count: 0 })).toEqual({
      ...createTally(),
      tulips: { 'tulip-left': zero, 'tulip-right': zero },
    });
  });

  it('runs at full power and at the best power without fouls or stuck balls', () => {
    for (const power of [BEST_POWER, 1]) {
      const t = runBatch(classic, { power, seed: 1, count: 100 });
      expect(t.entries.foul).toBe(0);
      expect(t.stuck + t.lost).toBe(0);
    }
  });

  it('fouls every shot at zero power, the bottom of the handle (the handle remap)', () => {
    const t = runBatch(classic, { power: 0, seed: 1, count: 30 });
    expect(t.entries.foul).toBe(30);
    expect(t.stuck + t.lost).toBe(0);
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
// is open, for each of the classic board's two tulips, at the best power.
// Long runs, so a longer timeout.
describe('montecarlo: tulips', { timeout: 60_000 }, () => {
  const TULIPS = ['tulip-left', 'tulip-right'];
  const run = (tulips: TulipMode, count: number, seed = 1) => {
    const t = createTally();
    for (let first = 0; first < count; first += 1000) {
      const n = Math.min(1000, count - first);
      addTally(t, runBatch(classic, { power: BEST_POWER, seed, first, count: n, tulips }));
    }
    return t;
  };
  const byId = (t: Tally) => new Map(summarize(t).tulips.map((s) => [s.id, s]));

  it('each takes far more balls held open than held closed', () => {
    const open = run('open', 1000);
    const closed = run('closed', 1000);
    // About 10.6% each held open and 1.4% held closed (PHYSICS.md, "Gates:
    // tulips"): with 1000 balls, about 106 and 14 entries each.
    for (const id of TULIPS) {
      const o = byId(open).get(id) as TulipSummary;
      const c = byId(closed).get(id) as TulipSummary;
      expect(o).toMatchObject({ closedRate: null, openShare: 1, closedEntries: 0 });
      expect(c).toMatchObject({ openRate: null, openShare: 0, openEntries: 0 });
      // Held, the rate in that state is the plain entry rate (to rounding).
      expect(o.openRate).toBeCloseTo(o.entryRate, 12);
      expect(c.closedRate).toBeCloseTo(c.entryRate, 12);
      expect(c.closedEntries, id).toBeGreaterThan(0);
      expect(o.openEntries, id).toBeGreaterThan(3 * c.closedEntries);
    }
    expect(summarize(open).tulips.map((s) => s.id)).toEqual(TULIPS);
    for (const t of [open, closed]) {
      const { start, out, foul, attacker, tulip } = t.entries;
      expect(start + out + foul + attacker + tulip + t.lost + t.stuck).toBe(1000);
      expect(t.stuck + t.lost).toBe(0);
    }
  });

  it('in play, each opens on one entry and closes on the next, and takes more while open', () => {
    const t = run('play', 2000);
    let entries = 0;
    for (const id of TULIPS) {
      const s = byId(t).get(id) as TulipSummary;
      expect(s.openRate, id).not.toBeNull();
      expect(s.closedRate, id).not.toBeNull();
      expect(s.openRate as number, id).toBeGreaterThan(2 * (s.closedRate as number));
      expect(s.openEntries, id).toBeGreaterThan(0);
      expect(s.closedEntries, id).toBeGreaterThan(0);
      expect(s.openShare, id).toBeGreaterThan(0);
      expect(s.openShare, id).toBeLessThan(0.5);
      entries += s.openEntries + s.closedEntries;
    }
    expect(entries).toBe(t.entries.tulip);
    expect(t.stuck + t.lost).toBe(0);
    const { start, out, foul, attacker, tulip } = t.entries;
    expect(start + out + foul + attacker + tulip).toBe(2000);
  });

  it('gives the same tally for the same seed, tulip states and all', () => {
    const a = runBatch(classic, { power: BEST_POWER, seed: 4, count: 300 });
    expect(a.entries.tulip).toBeGreaterThan(0);
    expect(runBatch(classic, { power: BEST_POWER, seed: 4, count: 300 })).toEqual(a);
  });

  it('holds the attacker open with gatesOpen, and leaves the tulips to play', () => {
    const t = runBatch(classic, { power: BEST_POWER, seed: 1, count: 200, gatesOpen: true });
    expect(t.entries.attacker).toBeGreaterThan(0);
    for (const id of TULIPS) {
      expect((t.tulips[id] as TulipTally).closedBallSteps).toBeGreaterThan(0);
    }
  });

  it('tallies a board with no tulips with none, and zero balls with zero', () => {
    const data = classicData();
    data.pockets = data.pockets.filter((p: { kind: string }) => p.kind !== 'tulip');
    // And their cups, or balls would come to rest in them.
    data.rails = data.rails.filter((r: { id: string }) => !r.id.startsWith('tulip-'));
    const bare = parseBoard(data);
    expect(runBatch(bare, { power: BEST_POWER, seed: 1, count: 5 }).tulips).toEqual({});
    const none = runBatch(classic, { power: BEST_POWER, seed: 1, count: 0 });
    const zero = { openEntries: 0, closedEntries: 0, openBallSteps: 0, closedBallSteps: 0 };
    expect(none.tulips).toEqual({ 'tulip-left': zero, 'tulip-right': zero });
    expect(summarize(none).tulips).toEqual(
      TULIPS.map((id) => ({
        id,
        openEntries: 0,
        closedEntries: 0,
        entryRate: 0,
        openRate: null,
        closedRate: null,
        openShare: 0,
      })),
    );
  });

  it('rejects an unknown tulip mode', () => {
    expect(() =>
      runBatch(classic, { power: BEST_POWER, seed: 1, count: 1, tulips: 'ajar' as TulipMode }),
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
