// One machine in play: the board's world, the tray, the handle, and the rng
// that varies each shot's launch speed. The frame loop calls stepTable once
// per sim step; nothing else advances it.

import { type Board, createBoardWorld, launchBall, pocketKind } from '../sim/board';
import { type Rng, createRng } from '../sim/rng';
import { type World, stepWorld } from '../sim/world';
import { type Economy, createEconomy, recordEntry, takeBallForLaunch } from './economy';
import { type FireControl, createFireControl, stepFire } from './fire';

export interface Table {
  readonly board: Board;
  readonly world: World;
  readonly economy: Economy;
  readonly fire: FireControl;
  /** Launch-speed spread, one draw per shot. */
  readonly rng: Rng;
}

export interface TableOptions {
  /** Balls in the tray at the start. Default STARTING_BALLS. */
  readonly startingBalls?: number;
  /** Seed for the launch spread. Same seed and same inputs, same game. Default 0. */
  readonly seed?: number;
}

export function createTable(board: Board, options: TableOptions = {}): Table {
  return {
    board,
    world: createBoardWorld(board),
    economy: createEconomy(options.startingBalls),
    fire: createFireControl(),
    rng: createRng(options.seed ?? 0),
  };
}

/** One fixed step: fire if the handle says so and the tray has a ball, then step the world. */
export function stepTable(table: Table): void {
  const { board, world, economy, fire, rng } = table;
  if (stepFire(fire) && takeBallForLaunch(economy)) launchBall(world, board, fire.power, rng);
  stepWorld(world);
  for (const capture of world.captures) {
    const kind = pocketKind(board, capture.sensorId);
    if (kind) recordEntry(economy, kind);
  }
}
