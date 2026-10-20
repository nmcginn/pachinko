// Where a board's tulips are, for tests that drop a ball straight into one
// or put a ball where its wings are about to appear. Read from the board
// data, so the tests follow the board if its tulips move.

import type { Board } from '../../src/sim/board';

export interface TulipMouth {
  readonly id: string;
  /** The tulip's centre line. */
  readonly xM: number;
  /** Top of its cup walls, where the wings are hinged. */
  readonly yM: number;
}

/** Each tulip's mouth: midway between its wing hinges (the first point of each closed wing). */
export function tulipMouths(board: Board): TulipMouth[] {
  return board.pockets.flatMap((p) => {
    const hinges = p.wings?.closed.map((wing) => wing[0]);
    const [a, b] = hinges ?? [];
    if (p.kind !== 'tulip' || !a || !b) return [];
    return [{ id: p.id, xM: (a.x + b.x) / 2, yM: Math.max(a.y, b.y) }];
  });
}

/** The mouth of tulip `id`. Throws if the board has none. */
export function tulipMouth(board: Board, id: string): TulipMouth {
  const mouth = tulipMouths(board).find((m) => m.id === id);
  if (!mouth) throw new Error(`no tulip "${id}" on board "${board.name}"`);
  return mouth;
}

/**
 * A point 3 mm below and outside the middle of the left wing's open shape,
 * for the tulip shape on the classic board (wings hinged at ±8.5 mm, open to
 * tips at ±19 mm, 10.5 mm up): overlapping the open wing, 8 mm from the
 * closed one, so clear while the tulip is closed.
 */
export function underLeftOpenWing(mouth: TulipMouth): { x: number; y: number } {
  return { x: mouth.xM - 0.0159, y: mouth.yM + 0.0031 };
}
