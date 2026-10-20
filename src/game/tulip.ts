// Tulips (チューリップ): side pockets whose wings open on an entry. Classic
// behaviour (PLAN.md game rules): an entry into a closed tulip opens it, and
// the next entry, while it is open, closes it. No timer. The wings are a
// gate in the world (sim/board.ts), so the open state lives there.

import type { Board } from '../sim/board';
import { type Capture, type World, setGateOpen } from '../sim/world';

/** Whether the tulip with this pocket id is open now. Throws if the world has no such gate. */
export function tulipOpen(world: Readonly<World>, id: string): boolean {
  const gate = world.gates.find((g) => g.id === id);
  if (!gate) throw new RangeError(`no tulip "${id}"`);
  return gate.open;
}

/**
 * A ball entered tulip `id`: open it if it was closed, close it if it was
 * open. Returns the balls its wings swept in as they moved (setGateOpen),
 * each one an entry of its own that the caller must record in turn.
 */
export function enterTulip(world: World, id: string): readonly Capture[] {
  return setGateOpen(world, id, !tulipOpen(world, id));
}

/** Ids of the board's tulips, in board order. */
export function tulipIds(board: Board): string[] {
  return board.pockets.filter((p) => p.kind === 'tulip').map((p) => p.id);
}
