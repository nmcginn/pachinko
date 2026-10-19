// Headless Monte Carlo over a board: fire balls at a fixed handle power and
// tally where each one ends. Pure, so tools/montecarlo.ts runs it in worker
// threads and nail-adjust mode (M7) can run it in a Web Worker.
//
// Balls collide with each other (M5), so they are fired as the game fires
// them: at the auto-fire rate into one shared world, each launch waiting for
// the lane to clear. A run is split into batches, each its own world. Ball
// i's launch spread comes from its own rng stream, streamSeed(seed, i), and
// each batch also fires the TRAFFIC_BALLS before its first ball and as many
// after its last as are needed, uncounted, so every counted ball meets the
// traffic it would in a long session. A batch's tally depends only on the
// board and its own options, so a run split the same way gives the same
// total in any order, on any number of workers.

import {
  type Board,
  type PocketKind,
  createBoardWorld,
  launchBall,
  launcherClear,
  pocketKind,
} from '../sim/board';
import { createRng, streamSeed } from '../sim/rng';
import { type Ball, SIM_STEP_S, removeBall, setGateOpen, stepWorld } from '../sim/world';
import { STARTING_BALLS } from './economy';
import { createFireControl, stepFire } from './fire';

/**
 * Uncounted balls fired before a batch's first ball: 6 s of auto-fire,
 * longer than any flight, so the first counted ball already has company.
 */
export const TRAFFIC_BALLS = 10;

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
  /** Balls still in play MAX_FLIGHT_S after their launch. */
  stuck: number;
  /** Sim steps taken, summed over balls, uncounted traffic included. A measure of work, for throughput. */
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
  /** Uncounted balls fired before the first, at most. Default TRAFFIC_BALLS. */
  readonly traffic?: number;
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

/**
 * Simulate balls first … first + count − 1 of a run, fired at the auto-fire
 * rate into one world with up to `traffic` uncounted balls before them
 * and as many after as keep firing until the last counted ball is done.
 */
export function runBatch(board: Board, options: BatchOptions): Tally {
  const { power, seed, count } = options;
  const first = options.first ?? 0;
  const maxFlightS = options.maxFlightS ?? MAX_FLIGHT_S;
  if (!(power >= 0 && power <= 1)) throw new RangeError(`power must be in [0, 1], got ${power}`);
  if (!(Number.isInteger(count) && count >= 0)) {
    throw new RangeError(`count must be a whole number ≥ 0, got ${count}`);
  }
  if (!(Number.isInteger(first) && first >= 0)) {
    throw new RangeError(`first must be a whole number ≥ 0, got ${first}`);
  }
  const traffic = options.traffic ?? TRAFFIC_BALLS;
  if (!(Number.isInteger(traffic) && traffic >= 0)) {
    throw new RangeError(`traffic must be a whole number ≥ 0, got ${traffic}`);
  }
  streamSeed(seed, 0); // Checks the seed up front, even for an empty batch.
  if (!(maxFlightS > 0)) throw new RangeError(`maxFlightS must be > 0, got ${maxFlightS}`);
  const maxSteps = Math.ceil(maxFlightS / SIM_STEP_S);

  const tally = createTally();
  const world = createBoardWorld(board);
  if (options.gatesOpen) for (const gate of world.gates) setGateOpen(world, gate.id, true);
  const fire = createFireControl(power);
  fire.held = true;
  // A fresh world numbers its balls 1, 2, 3, … in launch order, so ball id k
  // is run index offset + k, and launchStep[k − 1] is when it went.
  const offset = first - Math.min(traffic, first) - 1;
  const launchStep: number[] = [];
  const end = first + count;
  const counted = (ball: Ball) => ball.id + offset >= first && ball.id + offset < end;
  let pending = count;

  while (pending > 0) {
    if (stepFire(fire, launcherClear(world, board))) {
      const index = offset + world.nextBallId;
      launchBall(world, board, power, createRng(streamSeed(seed, index)));
      launchStep.push(world.steps);
      if (index >= first && index < end) tally.launched += 1;
    }
    tally.ballSteps += world.balls.length;
    const removed = stepWorld(world);
    for (const ball of removed) {
      if (!counted(ball)) continue;
      const capture = world.captures.find((c) => c.ball === ball);
      // Every sensor in a board world is one of its pockets.
      const kind = capture ? pocketKind(board, capture.sensorId) : null;
      if (kind) tally.entries[kind] += 1;
      else tally.lost += 1;
      pending -= 1;
    }
    // Give up on balls in play too long.
    for (let i = world.balls.length - 1; i >= 0; i--) {
      const ball = world.balls[i] as Ball;
      if (world.steps - (launchStep[ball.id - 1] as number) < maxSteps) continue;
      if (counted(ball)) {
        tally.stuck += 1;
        pending -= 1;
      }
      removeBall(world, ball.id);
    }
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
