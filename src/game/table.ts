// One machine in play: the board's world, the tray, the handle, the reel and
// jackpot state, and the rngs. The frame loop calls stepTable once per sim
// step; nothing else advances it.

import {
  type Board,
  type PocketKind,
  createBoardWorld,
  launchBall,
  launcherClear,
  pocketKind,
} from '../sim/board';
import { type Rng, createRng, streamSeed } from '../sim/rng';
import { type Capture, type World, setGateOpen, stepWorld } from '../sim/world';
import { type Economy, createEconomy, recordEntry, takeBallForLaunch } from './economy';
import { type FireControl, createFireControl, stepFire } from './fire';
import {
  type Machine,
  attackerOpen,
  createMachine,
  enterAttacker,
  enterStart,
  stepMachine,
} from './machine';
import { enterTulip } from './tulip';

export interface Table {
  /** Replaced, never mutated, when a nail is adjusted (game/adjust.ts). */
  board: Board;
  readonly world: World;
  readonly economy: Economy;
  readonly fire: FireControl;
  readonly machine: Machine;
  /** Launch-speed spread, one draw per shot. */
  readonly rng: Rng;
  /** Debug: keep this many balls in play (TableOptions.keepInPlay). 0 is off. */
  readonly keepInPlay: number;
  /** Ids of balls in play that keepInPlay launched. The economy never sees them. */
  readonly freeBalls: Set<number>;
}

export interface TableOptions {
  /** Balls in the tray at the start. Default STARTING_BALLS. */
  readonly startingBalls?: number;
  /** Seed for the launch spread and the lottery. Same seed and same inputs, same game. Default 0. */
  readonly seed?: number;
  /** Jackpot probability per spin. Default DEFAULT_JACKPOT_PROBABILITY. */
  readonly jackpotProbability?: number;
  /**
   * Debug (M6's frame-time check): whenever fewer than this many balls are
   * in play and the launch point is clear, launch one more at the handle
   * power, whether or not the handle is held and ignoring the 100-a-minute
   * cap. These balls are free: they don't come from the tray, and their
   * entries pay nothing and aren't tallied, but they spin the reel, open
   * the attacker's rounds and work the tulips like any other ball. A whole
   * number ≥ 0; default 0, off.
   */
  readonly keepInPlay?: number;
}

/**
 * The lottery draws from its own stream of the seed, so how many spins have
 * been drawn never shifts a shot's launch speed, and the reverse.
 */
const LOTTERY_STREAM = 1;

export function createTable(board: Board, options: TableOptions = {}): Table {
  const seed = options.seed ?? 0;
  const keepInPlay = options.keepInPlay ?? 0;
  if (!(Number.isInteger(keepInPlay) && keepInPlay >= 0)) {
    throw new RangeError(`keepInPlay must be a whole number ≥ 0, got ${keepInPlay}`);
  }
  const lotteryRng = createRng(streamSeed(seed, LOTTERY_STREAM));
  return {
    board,
    world: createBoardWorld(board),
    economy: createEconomy(options.startingBalls),
    fire: createFireControl(),
    machine: createMachine(lotteryRng, options),
    rng: createRng(seed),
    keepInPlay,
    freeBalls: new Set(),
  };
}

/**
 * One fixed step: fire if the handle says so, the tray has a ball, and the
 * last ball has cleared the launch point (balls collide since M5), step
 * the world, pay and report the step's pocket entries, step the machine, then
 * open or close the attacker to match it. A ball the closing lid sweeps in
 * pays like any other attacker entry, after the round has ended. Each tulip
 * entry opens or closes that tulip at once, and a ball its moving wings
 * sweep in is an entry too, recorded in turn. With keepInPlay set, a free
 * ball goes in after the handle's shot, if there's room for one.
 */
export function stepTable(table: Table): void {
  const { board, world, economy, fire, machine, rng } = table;
  if (stepFire(fire, launcherClear(world, board)) && takeBallForLaunch(economy)) {
    launchBall(world, board, fire.power, rng);
  }
  if (world.balls.length < table.keepInPlay && launcherClear(world, board)) {
    table.freeBalls.add(launchBall(world, board, fire.power, rng).id);
  }
  const removed = stepWorld(world);
  recordCaptures(table, world.captures);
  // A free ball out of bounds (no capture) leaves the set here.
  for (const ball of removed) table.freeBalls.delete(ball.id);
  stepMachine(machine);
  const open = attackerOpen(machine);
  for (const gate of world.gates) {
    if (gate.open !== open && pocketKind(board, gate.id) === 'attacker') {
      recordCaptures(table, setGateOpen(world, gate.id, open));
    }
  }
}

function recordCaptures(table: Table, captures: readonly Capture[]): void {
  for (const capture of captures) {
    const kind: PocketKind | null = pocketKind(table.board, capture.sensorId);
    if (!kind) continue;
    if (!table.freeBalls.delete(capture.ball.id)) recordEntry(table.economy, kind);
    if (kind === 'start') enterStart(table.machine);
    else if (kind === 'attacker') enterAttacker(table.machine);
    else if (kind === 'tulip') recordCaptures(table, enterTulip(table.world, capture.sensorId));
  }
}
