// Headless Monte Carlo over a board: launch balls one at a time at a fixed
// handle power and tally where each one ends. Pure, so tools/montecarlo.ts
// runs it in worker threads and nail-adjust mode (M7) can run it in a Web
// Worker.
//
// Each ball is simulated alone, start to finish. Until ball–ball collisions
// land (M5) balls in flight never interact, so this gives exactly the
// outcomes of firing them at the auto-fire rate, and far faster. Ball i's
// launch spread comes from its own rng stream, streamSeed(seed, i), so a
// ball's outcome depends only on the seed and its index: any split of a run
// into batches, in any order, adds up to the same tally.

import {
  type Board,
  type PocketKind,
  createBoardWorld,
  launchBall,
  pocketKind,
} from '../sim/board';
import { createRng, streamSeed } from '../sim/rng';
import { SIM_STEP_S, setGateOpen, stepWorld } from '../sim/world';
import { STARTING_BALLS } from './economy';

/**
 * Longest a ball may stay in play before the run gives up on it and counts it
 * stuck: far longer than any real flight (about 2 s on the classic board).
 * Only a ball come to rest on a ledge reaches it.
 */
export const MAX_FLIGHT_S = 30;

export interface Tally {
  /** Balls launched. */
  launched: number;
  /** Balls that ended in each kind of pocket. */
  readonly entries: Record<PocketKind, number>;
  /** Balls that left the board through a gap in its walls. */
  lost: number;
  /** Balls still in play after MAX_FLIGHT_S. */
  stuck: number;
  /** Sim steps taken, summed over balls. A measure of work, for throughput. */
  ballSteps: number;
}

export interface BatchOptions {
  /** Handle power in [0, 1]. */
  readonly power: number;
  /** Run seed, an integer in [0, 2^32). */
  readonly seed: number;
  /** Index of the first ball in this batch. Default 0. */
  readonly first?: number;
  /** Balls in this batch. */
  readonly count: number;
  /**
   * Hold every gate (the attacker) open for the whole run, to measure what
   * it catches during a jackpot round. Default false: closed, as in normal play.
   */
  readonly gatesOpen?: boolean;
  /** Override MAX_FLIGHT_S, for tests. */
  readonly maxFlightS?: number;
}

export function createTally(): Tally {
  return {
    launched: 0,
    entries: { start: 0, out: 0, foul: 0, attacker: 0 },
    lost: 0,
    stuck: 0,
    ballSteps: 0,
  };
}

/** Add `b` into `a`. */
export function addTally(a: Tally, b: Readonly<Tally>): Tally {
  a.launched += b.launched;
  a.entries.start += b.entries.start;
  a.entries.out += b.entries.out;
  a.entries.foul += b.entries.foul;
  a.entries.attacker += b.entries.attacker;
  a.lost += b.lost;
  a.stuck += b.stuck;
  a.ballSteps += b.ballSteps;
  return a;
}

/** Simulate balls first … first + count − 1 of a run. */
export function runBatch(board: Board, options: BatchOptions): Tally {
  const { power, seed, count } = options;
  const first = options.first ?? 0;
  const maxFlightS = options.maxFlightS ?? MAX_FLIGHT_S;
  if (!(power >= 0 && power <= 1)) throw new RangeError(`power must be in [0, 1], got ${power}`);
  if (!(Number.isInteger(count) && count >= 0)) {
    throw new RangeError(`count must be a whole number ≥ 0, got ${count}`);
  }
  // streamSeed checks the seed and each ball index.
  if (!(maxFlightS > 0)) throw new RangeError(`maxFlightS must be > 0, got ${maxFlightS}`);
  const maxSteps = Math.ceil(maxFlightS / SIM_STEP_S);

  const tally = createTally();
  const world = createBoardWorld(board);
  if (options.gatesOpen) for (const gate of world.gates) setGateOpen(world, gate.id, true);
  for (let i = first; i < first + count; i++) {
    launchBall(world, board, power, createRng(streamSeed(seed, i)));
    tally.launched += 1;
    let steps = 0;
    let ended = false;
    while (steps < maxSteps) {
      stepWorld(world);
      steps += 1;
      const capture = world.captures[0];
      if (capture) {
        const kind = pocketKind(board, capture.sensorId);
        // Every sensor in a board world is one of its pockets.
        if (kind) tally.entries[kind] += 1;
        ended = true;
        break;
      }
      if (world.balls.length === 0) {
        tally.lost += 1;
        ended = true;
        break;
      }
    }
    if (!ended) {
      // Clear it so it isn't stepped alongside the next ball.
      tally.stuck += 1;
      world.balls.length = 0;
    }
    tally.ballSteps += steps;
  }
  return tally;
}

export interface Summary {
  readonly launched: number;
  /** Fraction of launched balls that entered the start pocket. */
  readonly startRate: number;
  /** Fraction that went down the out-hole. */
  readonly outRate: number;
  /** Fraction that fouled (and went back to the tray). */
  readonly foulRate: number;
  /** Fraction that entered the attacker. 0 unless the run held the gates open. */
  readonly attackerRate: number;
  /**
   * Start-pocket entries per 250 balls launched (PLAN.md's key metric).
   * Every launch counts, fouls included.
   */
  readonly spinsPer1000Yen: number;
  /** One standard error of spinsPer1000Yen, from the binomial count. */
  readonly spinsPer1000YenSe: number;
}

/** Rates from a tally. A tally of zero balls has every rate 0. */
export function summarize(tally: Readonly<Tally>): Summary {
  const n = tally.launched;
  const rate = (k: number) => (n > 0 ? k / n : 0);
  const p = rate(tally.entries.start);
  return {
    launched: n,
    startRate: p,
    outRate: rate(tally.entries.out),
    foulRate: rate(tally.entries.foul),
    attackerRate: rate(tally.entries.attacker),
    spinsPer1000Yen: p * STARTING_BALLS,
    spinsPer1000YenSe: n > 0 ? Math.sqrt((p * (1 - p)) / n) * STARTING_BALLS : 0,
  };
}
