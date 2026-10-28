import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAdjust, nudgeSelected, selectNailAt } from '../../src/game/adjust';
import {
  type LiveStats,
  type StatsJob,
  STATS_CACHE,
  STATS_MAX_BALLS,
  STATS_SEED,
  asLoaded,
  createLiveStats,
  finishJob,
  measure,
  nextJob,
  serveJob,
  statsKey,
  stopMeasuring,
  tallyFor,
} from '../../src/game/livestats';
import {
  BATCH_BALLS,
  type Tally,
  addTally,
  createTally,
  runBatch,
  summarize,
} from '../../src/game/montecarlo';
import { createTable } from '../../src/game/table';
import { type Board, moveNail, parseBoard } from '../../src/sim/board';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
/** The classic board's best handle power (PHYSICS.md tuning log, the handle remap). */
const BEST_POWER = 0.2;
const LEFT = 0;
const RIGHT = 1;

/** The classic board with nail 1 moved 0.1 mm right: a different board. */
const nudged = moveNail(classic, RIGHT, { x: 0.2574, y: 0.178 });

/** A stand-in reply for a job: a tally of `count` launches and nothing else, without simulating. */
function fakeReply(job: StatsJob) {
  const tally = createTally();
  tally.launched = job.count;
  tally.entries.out = job.count;
  return { key: job.key, first: job.first, tally };
}

/** Run jobs with fake tallies until nothing is left; returns the keys in the order they ran. */
function drainFake(stats: LiveStats, limit = 1000): string[] {
  const ran: string[] = [];
  for (let job = nextJob(stats); job && ran.length < limit; job = nextJob(stats)) {
    ran.push(job.key);
    expect(finishJob(stats, fakeReply(job))).toBe(true);
  }
  return ran;
}

describe('statsKey and asLoaded', () => {
  it('names a board and power: the same contents give the same key, any change another', () => {
    const copy = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
    expect(statsKey(copy, 0.2)).toBe(statsKey(classic, 0.2));
    expect(statsKey(nudged, 0.2)).not.toBe(statsKey(classic, 0.2));
    expect(statsKey(classic, 0.22)).not.toBe(statsKey(classic, 0.2));
  });

  it('puts the nails back where they loaded, leaving the rest of the board', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    selectNailAt(adjust, table, 0.2573, 0.178, 0.001);
    expect(nudgeSelected(adjust, table, 5, -3)).toBe(true);
    expect(statsKey(table.board, 0.2)).not.toBe(statsKey(classic, 0.2));
    const loaded = asLoaded(table.board, adjust.original);
    expect(loaded).toEqual(classic);
    expect(statsKey(loaded, 0.2)).toBe(statsKey(classic, 0.2));
    // A nail nudged back is the loaded board exactly, key and all.
    nudgeSelected(adjust, table, -5, 3);
    expect(statsKey(table.board, 0.2)).toBe(statsKey(classic, 0.2));
  });
});

describe('nextJob and finishJob', () => {
  it('runs nothing until asked, and nothing after stopping', () => {
    const stats = createLiveStats();
    expect(nextJob(stats)).toBeNull();
    measure(stats, classic, classic, BEST_POWER);
    stopMeasuring(stats);
    expect(nextJob(stats)).toBeNull();
  });

  it("hands out the CLI's batches, one at a time, at the fixed seed", () => {
    const stats = createLiveStats();
    measure(stats, nudged, classic, BEST_POWER);
    const job = nextJob(stats);
    expect(job).toMatchObject({
      key: statsKey(nudged, BEST_POWER),
      power: BEST_POWER,
      seed: STATS_SEED,
      first: 0,
      count: BATCH_BALLS,
    });
    expect(job?.board).toBe(nudged);
    // One in flight: nothing more until it comes back.
    expect(nextJob(stats)).toBeNull();
  });

  it('alternates between the two boards, current first, so they grow together', () => {
    const stats = createLiveStats();
    measure(stats, nudged, classic, BEST_POWER);
    const now = statsKey(nudged, BEST_POWER);
    const was = statsKey(classic, BEST_POWER);
    const ran = drainFake(stats, 6);
    expect(ran).toEqual([now, was, now, was, now, was]);
    expect(stats.running?.first).toBe(3 * BATCH_BALLS);
  });

  it('stops each board at STATS_MAX_BALLS', () => {
    const stats = createLiveStats();
    measure(stats, nudged, classic, BEST_POWER);
    const ran = drainFake(stats);
    expect(ran).toHaveLength((2 * STATS_MAX_BALLS) / BATCH_BALLS);
    expect(tallyFor(stats, stats.current)?.launched).toBe(STATS_MAX_BALLS);
    expect(tallyFor(stats, stats.baseline)?.launched).toBe(STATS_MAX_BALLS);
    expect(nextJob(stats)).toBeNull();
  });

  it('measures once when nothing has moved: the two are the same board', () => {
    const stats = createLiveStats();
    measure(stats, classic, asLoaded(classic, classic.nails), BEST_POWER);
    expect(stats.current).toBe(stats.baseline);
    const ran = drainFake(stats);
    expect(ran).toHaveLength(STATS_MAX_BALLS / BATCH_BALLS);
  });

  it('switches to an edited board at the next batch, and picks an old one up where it left off', () => {
    const stats = createLiveStats();
    measure(stats, nudged, classic, BEST_POWER);
    const first = nextJob(stats) as StatsJob;
    // An edit while the first batch is in flight: back to the loaded board.
    measure(stats, classic, classic, BEST_POWER);
    expect(nextJob(stats)).toBeNull();
    // The batch in flight still lands, on the board it ran.
    finishJob(stats, fakeReply(first));
    expect(tallyFor(stats, statsKey(nudged, BEST_POWER))?.launched).toBe(BATCH_BALLS);
    const second = nextJob(stats) as StatsJob;
    expect(second.key).toBe(statsKey(classic, BEST_POWER));
    finishJob(stats, fakeReply(second));
    // Back to the nudged board: it carries on from ball 1000.
    measure(stats, nudged, classic, BEST_POWER);
    expect(nextJob(stats)).toMatchObject({
      key: statsKey(nudged, BEST_POWER),
      first: BATCH_BALLS,
    });
  });

  it('ignores a reply that is not for the job in flight', () => {
    const stats = createLiveStats();
    measure(stats, nudged, classic, BEST_POWER);
    const job = nextJob(stats) as StatsJob;
    expect(finishJob(stats, { ...fakeReply(job), first: BATCH_BALLS })).toBe(false);
    expect(finishJob(stats, { ...fakeReply(job), key: 'other' })).toBe(false);
    expect(stats.running).toBe(job);
    expect(finishJob(stats, fakeReply(job))).toBe(true);
    // And a second copy of the same reply is stale too.
    expect(finishJob(stats, fakeReply(job))).toBe(false);
    expect(tallyFor(stats, job.key)?.launched).toBe(BATCH_BALLS);
  });

  it('stops on an error until a board changes', () => {
    const stats = createLiveStats();
    measure(stats, nudged, classic, BEST_POWER);
    const job = nextJob(stats) as StatsJob;
    expect(finishJob(stats, { key: job.key, first: job.first, error: 'boom' })).toBe(true);
    expect(stats.error).toBe('boom');
    expect(nextJob(stats)).toBeNull();
    // The same boards again: still stopped, so a bad board doesn't spin.
    measure(stats, nudged, classic, BEST_POWER);
    expect(nextJob(stats)).toBeNull();
    // An edit clears it.
    measure(stats, classic, classic, BEST_POWER);
    expect(stats.error).toBeNull();
    expect(nextJob(stats)).not.toBeNull();
  });

  it('keeps at most STATS_CACHE tallies, dropping the least recent but never the two in use', () => {
    const stats = createLiveStats();
    const boards: Board[] = [];
    for (let i = 0; i < STATS_CACHE + 10; i++) {
      boards.push(moveNail(classic, RIGHT, { x: 0.2574 + i * 0.0001, y: 0.178 }));
    }
    for (const b of boards) {
      measure(stats, b, classic, BEST_POWER);
      // Measure the edited board once, and the loaded board once each round.
      for (let k = 0; k < 2; k++) finishJob(stats, fakeReply(nextJob(stats) as StatsJob));
    }
    expect(stats.entries.size).toBe(STATS_CACHE);
    expect(tallyFor(stats, stats.current)).not.toBeNull();
    expect(tallyFor(stats, stats.baseline)).not.toBeNull();
    expect(tallyFor(stats, statsKey(boards[0] as Board, BEST_POWER))).toBeNull();
  });

  it('refuses a power outside [0, 1]', () => {
    const stats = createLiveStats();
    expect(() => measure(stats, classic, classic, 1.5)).toThrow(RangeError);
    expect(() => measure(stats, classic, classic, NaN)).toThrow(RangeError);
  });
});

describe('serveJob', () => {
  it("is runBatch's tally for the job", () => {
    const job: StatsJob = {
      key: 'k',
      board: classic,
      power: BEST_POWER,
      seed: STATS_SEED,
      first: 1000,
      count: 50,
    };
    const reply = serveJob(job);
    expect(reply).toEqual({
      key: 'k',
      first: 1000,
      tally: runBatch(classic, { power: BEST_POWER, seed: STATS_SEED, first: 1000, count: 50 }),
    });
    // The same job twice: the same tally.
    expect(serveJob(job)).toEqual(reply);
  });

  it('answers a job runBatch refuses with the reason, instead of throwing', () => {
    const reply = serveJob({ key: 'k', board: classic, power: 2, seed: 1, first: 0, count: 1 });
    expect(reply).toEqual({ key: 'k', first: 0, error: 'power must be in [0, 1], got 2' });
  });
});

describe('live stats on the classic board (M7 acceptance, headless)', () => {
  it('the two start nails nudged 1 mm outward raise the start rate over the board as loaded', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    for (const [index, dx] of [
      [LEFT, -1],
      [RIGHT, 1],
    ] as const) {
      const n = classic.nails[index] as { x: number; y: number };
      selectNailAt(adjust, table, n.x, n.y, 0.001);
      for (let i = 0; i < 10; i++) expect(nudgeSelected(adjust, table, dx, 0)).toBe(true);
    }
    const stats = createLiveStats();
    measure(stats, table.board, asLoaded(table.board, adjust.original), BEST_POWER);
    // Two batches each, served in-process as the worker would.
    for (let k = 0; k < 4; k++) finishJob(stats, serveJob(nextJob(stats) as StatsJob));
    const now = summarize(tallyFor(stats, stats.current) as Tally);
    const was = summarize(tallyFor(stats, stats.baseline) as Tally);
    expect(now.launched).toBe(2000);
    expect(was.launched).toBe(2000);
    // Seeded, so exact, and the same as tests/game/adjust.test.ts's and the
    // CLI's for 2000 balls at power 0.2, seed 1: 21.88 and 28.88.
    expect(was.spinsPer1000Yen).toBeCloseTo(21.875, 9);
    expect(now.spinsPer1000Yen).toBeCloseTo(28.875, 9);
    expect(now.startRate).toBeGreaterThan(was.startRate);
    // The panel's tally is the CLI's: the same batches, added up.
    const cli = addTally(
      runBatch(classic, { power: BEST_POWER, seed: STATS_SEED, first: 0, count: 1000 }),
      runBatch(classic, { power: BEST_POWER, seed: STATS_SEED, first: 1000, count: 1000 }),
    );
    expect(tallyFor(stats, stats.baseline)).toEqual(cli);
  }, 30_000);
});
