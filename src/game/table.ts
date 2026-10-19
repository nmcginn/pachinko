// One machine in play: the board's world, the tray, the handle, the reel and
// jackpot state, and the rngs. The frame loop calls stepTable once per sim
// step; nothing else advances it.

import {
  type Board,
  type PocketKind,
  createBoardWorld,
  launchBall,
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

export interface Table {
  readonly board: Board;
  readonly world: World;
  readonly economy: Economy;
  readonly fire: FireControl;
  readonly machine: Machine;
  /** Launch-speed spread, one draw per shot. */
  readonly rng: Rng;
}

export interface TableOptions {
  /** Balls in the tray at the start. Default STARTING_BALLS. */
  readonly startingBalls?: number;
  /** Seed for the launch spread and the lottery. Same seed and same inputs, same game. Default 0. */
  readonly seed?: number;
  /** Jackpot probability per spin. Default DEFAULT_JACKPOT_PROBABILITY. */
  readonly jackpotProbability?: number;
}

/**
 * The lottery draws from its own stream of the seed, so how many spins have
 * been drawn never shifts a shot's launch speed, and the reverse.
 */
const LOTTERY_STREAM = 1;

export function createTable(board: Board, options: TableOptions = {}): Table {
  const seed = options.seed ?? 0;
  const lotteryRng = createRng(streamSeed(seed, LOTTERY_STREAM));
  return {
    board,
    world: createBoardWorld(board),
    economy: createEconomy(options.startingBalls),
    fire: createFireControl(),
    machine: createMachine(lotteryRng, options),
    rng: createRng(seed),
  };
}

/**
 * One fixed step: fire if the handle says so and the tray has a ball, step
 * the world, pay and report the step's pocket entries, step the machine, then
 * open or close the attacker to match it. A ball the closing lid sweeps in
 * pays like any other attacker entry, after the round has ended.
 */
export function stepTable(table: Table): void {
  const { board, world, economy, fire, machine, rng } = table;
  if (stepFire(fire) && takeBallForLaunch(economy)) launchBall(world, board, fire.power, rng);
  stepWorld(world);
  recordCaptures(table, world.captures);
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
    recordEntry(table.economy, kind);
    if (kind === 'start') enterStart(table.machine);
    else if (kind === 'attacker') enterAttacker(table.machine);
  }
}
