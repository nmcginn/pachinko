import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type StatsJob,
  type StatsReply,
  STATS_MAX_BALLS,
  createLiveStats,
  measure,
  serveJob,
  stopMeasuring,
  tallyFor,
} from '../../src/game/livestats';
import { BATCH_BALLS, createTally } from '../../src/game/montecarlo';
import { moveNail, parseBoard } from '../../src/sim/board';
import { type StatsWorker, createStatsDriver } from '../../src/stats/driver';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
const nudged = moveNail(classic, 1, { x: 0.2574, y: 0.178 });

/** A worker that holds each job until the test answers it. */
function fakeWorker() {
  const posted: StatsJob[] = [];
  let onMessage: ((e: { data: StatsReply }) => void) | null = null;
  let onError: ((e: { message?: string }) => void) | null = null;
  const worker: StatsWorker = {
    postMessage: (job) => posted.push(job),
    addEventListener: (type: 'message' | 'error', fn: never) => {
      if (type === 'message') onMessage = fn;
      else onError = fn;
    },
  };
  return {
    worker,
    posted,
    /** Answer the oldest job with a fake tally (or the real one), as the worker would. */
    answer(real = false) {
      const job = posted.shift();
      if (!job) throw new Error('nothing posted');
      const tally = createTally();
      tally.launched = job.count;
      onMessage?.({ data: real ? serveJob(job) : { key: job.key, first: job.first, tally } });
    },
    fail(message?: string) {
      onError?.(message === undefined ? {} : { message });
    },
  };
}

describe('createStatsDriver', () => {
  it('posts one batch at a time and the next as each comes back, telling the page', () => {
    const fake = fakeWorker();
    const stats = createLiveStats();
    let changes = 0;
    const driver = createStatsDriver(fake.worker, stats, () => (changes += 1));
    driver.pump();
    expect(fake.posted).toEqual([]);
    measure(stats, nudged, classic, 0.2);
    driver.pump();
    driver.pump();
    expect(fake.posted).toHaveLength(1);
    fake.answer();
    expect(changes).toBe(1);
    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0]?.board).toBe(classic);
    fake.answer();
    expect(tallyFor(stats, stats.current)?.launched).toBe(BATCH_BALLS);
    expect(tallyFor(stats, stats.baseline)?.launched).toBe(BATCH_BALLS);
  });

  it('runs both boards to STATS_MAX_BALLS, then rests', () => {
    const fake = fakeWorker();
    const stats = createLiveStats();
    const driver = createStatsDriver(fake.worker, stats, () => {});
    measure(stats, nudged, classic, 0.2);
    driver.pump();
    let answered = 0;
    while (fake.posted.length > 0) {
      fake.answer();
      answered += 1;
    }
    expect(answered).toBe((2 * STATS_MAX_BALLS) / BATCH_BALLS);
    driver.pump();
    expect(fake.posted).toEqual([]);
  });

  it('posts nothing more once stopped, but keeps the batch in flight', () => {
    const fake = fakeWorker();
    const stats = createLiveStats();
    const driver = createStatsDriver(fake.worker, stats, () => {});
    measure(stats, nudged, classic, 0.2);
    driver.pump();
    stopMeasuring(stats);
    driver.pump();
    fake.answer(true);
    expect(fake.posted).toEqual([]);
    expect(stats.entries.size).toBe(1);
  });

  it('a worker error stops the run with its message, for good: the worker is gone', () => {
    const fake = fakeWorker();
    const stats = createLiveStats();
    let changes = 0;
    const driver = createStatsDriver(fake.worker, stats, () => (changes += 1));
    measure(stats, nudged, classic, 0.2);
    driver.pump();
    fake.posted.length = 0;
    fake.fail();
    expect(stats.error).toBe('the worker failed');
    expect(stats.running).toBeNull();
    expect(changes).toBe(1);
    driver.pump();
    expect(fake.posted).toEqual([]);
    // An edit would clear a batch's error, but not a dead worker's.
    measure(stats, classic, classic, 0.2);
    driver.pump();
    expect(fake.posted).toEqual([]);
    expect(stats.error).toBe('the worker failed');
  });

  it('a worker that dies while idle says so when next asked to measure', () => {
    const fake = fakeWorker();
    const stats = createLiveStats();
    const driver = createStatsDriver(fake.worker, stats, () => {});
    fake.fail('failed to load');
    // Not editing: nothing to show it on.
    expect(stats.error).toBeNull();
    measure(stats, classic, classic, 0.2);
    driver.pump();
    expect(fake.posted).toEqual([]);
    expect(stats.error).toBe('failed to load');
  });
});
