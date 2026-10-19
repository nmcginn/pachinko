// One machine in play: the board's world, the tray, and the handle. The
// frame loop calls stepTable once per sim step; nothing else advances it.

import { type Board, createBoardWorld, launchBall, pocketKind } from '../sim/board';
import { type World, stepWorld } from '../sim/world';
import { type Economy, createEconomy, recordEntry, takeBallForLaunch } from './economy';
import { type FireControl, createFireControl, stepFire } from './fire';

export interface Table {
  readonly board: Board;
  readonly world: World;
  readonly economy: Economy;
  readonly fire: FireControl;
}

export function createTable(board: Board, startingBalls?: number): Table {
  return {
    board,
    world: createBoardWorld(board),
    economy: createEconomy(startingBalls),
    fire: createFireControl(),
  };
}

/** One fixed step: fire if the handle says so and the tray has a ball, then step the world. */
export function stepTable(table: Table): void {
  const { board, world, economy, fire } = table;
  if (stepFire(fire) && takeBallForLaunch(economy)) launchBall(world, board, fire.power);
  stepWorld(world);
  for (const capture of world.captures) {
    const kind = pocketKind(board, capture.sensorId);
    if (kind) recordEntry(economy, kind);
  }
}
