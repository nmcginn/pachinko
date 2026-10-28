// Live stats for nail-adjust mode (M7): the Monte Carlo of game/montecarlo.ts
// run a batch at a time in a Web Worker while the player edits, so the panel
// shows spins per ¥1000 for the board as it stands next to the board as it
// loaded, both at the handle's power.
//
// Pure: this file decides which batch to run next and keeps the tallies;
// src/stats/ posts the batches to the worker and hands the tallies back.
// One batch is in flight at a time, so an edit takes effect as soon as the
// batch in flight comes back (under a second on the classic board), and the
// worker never needs telling to stop.
//
// Both boards run with the same seed, ball for ball, so their difference
// is mostly the nails' doing, not the launch spread's (common random
// numbers). Each batch is the CLI's (BATCH_BALLS, the same `first`), so
// the panel's numbers for N balls are exactly what
// `tools/montecarlo.ts --balls N --power P --seed STATS_SEED` prints for
// that board. Tallies are kept per board and power, so nudging a nail back
// shows the numbers it had there at once and carries on from them.

import type { Board } from '../sim/board';
import type { Vec2 } from '../sim/vec';
import { BATCH_BALLS, type Tally, addTally, createTally, runBatch } from './montecarlo';

/** Seed for every live-stats run: fixed, so the same board always shows the same numbers. */
export const STATS_SEED = 1;
/**
 * Balls a board is measured to, then the worker rests: about 15 s of one
 * core on the classic board, and one standard error of about 0.5 spins per
 * ¥1000 near its 22.
 */
export const STATS_MAX_BALLS = 20_000;
/** Boards' tallies kept for when a nail goes back where it was. Each is tiny, but every nudge makes one. */
export const STATS_CACHE = 64;

/** One batch for the worker: run `runBatch(board, …)` and send back the tally. */
export interface StatsJob {
  /** Which board and power this is for, from statsKey. */
  readonly key: string;
  readonly board: Board;
  readonly power: number;
  readonly seed: number;
  readonly first: number;
  readonly count: number;
}

/** What the worker sends back for a job: its tally, or why it failed. */
export type StatsReply =
  | { readonly key: string; readonly first: number; readonly tally: Tally }
  | { readonly key: string; readonly first: number; readonly error: string };

interface Entry {
  readonly tally: Tally;
  /** Index of the next ball to measure: balls first … next − 1 are in the tally. */
  next: number;
}

export interface LiveStats {
  /** Tallies per board and power, least recently measured first. */
  readonly entries: Map<string, Entry>;
  /** What the panel wants measured: the board as it stands, and as it loaded. Null while not editing. */
  current: string | null;
  baseline: string | null;
  /** The boards behind those keys. */
  readonly boards: Map<string, { readonly board: Board; readonly power: number }>;
  /** The job in flight, or null. */
  running: StatsJob | null;
  /** Why the last batch failed, or null. The run stops there until the boards change. */
  error: string | null;
}

export function createLiveStats(): LiveStats {
  return {
    entries: new Map(),
    current: null,
    baseline: null,
    boards: new Map(),
    running: null,
    error: null,
  };
}

/** A board and power's identity: everything the run depends on but the seed, which is fixed. */
export function statsKey(board: Board, power: number): string {
  return `${power}|${JSON.stringify(board)}`;
}

/** `board` with its nails where they loaded (`original`, as in Adjust): the panel's baseline. */
export function asLoaded(board: Board, original: readonly Vec2[]): Board {
  return { ...board, nails: original.map((n) => ({ x: n.x, y: n.y })) };
}

/**
 * Measure `current` against `baseline` at `power` from now on. A board
 * already measured carries on from its tally. Clears an error if either
 * board changed.
 */
export function measure(stats: LiveStats, current: Board, baseline: Board, power: number): void {
  if (!(power >= 0 && power <= 1)) throw new RangeError(`power must be in [0, 1], got ${power}`);
  const keys = [statsKey(current, power), statsKey(baseline, power)] as const;
  if (keys[0] !== stats.current || keys[1] !== stats.baseline) stats.error = null;
  [stats.current, stats.baseline] = keys;
  stats.boards.clear();
  stats.boards.set(keys[0], { board: current, power });
  stats.boards.set(keys[1], { board: baseline, power });
}

/** Stop measuring: no new batches. The one in flight still lands in the cache. */
export function stopMeasuring(stats: LiveStats): void {
  stats.current = null;
  stats.baseline = null;
  stats.boards.clear();
}

/** Balls measured so far on a key, and their tally; null for a key never run. */
export function tallyFor(stats: LiveStats, key: string | null): Tally | null {
  return key === null ? null : (stats.entries.get(key)?.tally ?? null);
}

/**
 * The next batch to run, or null if one is in flight, nothing is wanted,
 * the last one failed, or both boards have STATS_MAX_BALLS. Takes the
 * wanted board with fewer balls measured, the current one on a tie, so the
 * two grow together and an edit shows first. Marks it running.
 */
export function nextJob(stats: LiveStats): StatsJob | null {
  if (stats.running || stats.error !== null) return null;
  let best: { key: string; next: number } | null = null;
  for (const key of [stats.current, stats.baseline]) {
    if (key === null) continue;
    const next = stats.entries.get(key)?.next ?? 0;
    if (next >= STATS_MAX_BALLS) continue;
    if (best === null || next < best.next) best = { key, next };
  }
  if (best === null) return null;
  const { board, power } = stats.boards.get(best.key) as { board: Board; power: number };
  stats.running = {
    key: best.key,
    board,
    power,
    seed: STATS_SEED,
    first: best.next,
    count: Math.min(BATCH_BALLS, STATS_MAX_BALLS - best.next),
  };
  return stats.running;
}

/**
 * Take the worker's reply to the job in flight: add its tally, or keep its
 * error. A reply that isn't for the job in flight is ignored. Returns
 * whether anything changed.
 */
export function finishJob(stats: LiveStats, reply: StatsReply): boolean {
  const job = stats.running;
  if (!job || reply.key !== job.key || reply.first !== job.first) return false;
  stats.running = null;
  if ('error' in reply) {
    stats.error = reply.error;
    return true;
  }
  let entry = stats.entries.get(job.key);
  if (!entry) {
    entry = { tally: createTally(), next: 0 };
    stats.entries.set(job.key, entry);
  }
  // Batches for a key always go in order from 0, so this is always the next.
  if (job.first === entry.next) {
    addTally(entry.tally, reply.tally);
    entry.next += job.count;
  }
  // Most recently measured last, so eviction drops the least recent.
  stats.entries.delete(job.key);
  stats.entries.set(job.key, entry);
  evict(stats);
  return true;
}

/** Drop the least recently measured tallies past STATS_CACHE, never the two being measured. */
function evict(stats: LiveStats): void {
  for (const key of stats.entries.keys()) {
    if (stats.entries.size <= STATS_CACHE) return;
    if (key !== stats.current && key !== stats.baseline) stats.entries.delete(key);
  }
}

/** The worker's side: run one job. Pure, so the worker file is only wiring. */
export function serveJob(job: StatsJob): StatsReply {
  try {
    const tally = runBatch(job.board, {
      power: job.power,
      seed: job.seed,
      first: job.first,
      count: job.count,
    });
    return { key: job.key, first: job.first, tally };
  } catch (e) {
    return { key: job.key, first: job.first, error: e instanceof Error ? e.message : String(e) };
  }
}
