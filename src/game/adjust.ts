// Nail adjustment (M7): select a nail and nudge it in 0.1 mm steps, as a
// hall's nail man (釘師) would with a hammer. Pure: the input layer turns
// clicks and keys into these calls, and the renderer reads the state.
//
// The machine is stopped while its nails are being adjusted: main.ts
// doesn't step the table while `editing` is set, so balls in play wait
// where they are. A move applies to the table's board and its world
// together, so the game always plays the board it draws.
//
// A nail's position is kept as whole steps from where the board loaded it,
// so nudging back and forth returns it exactly, with no rounding drift.

import { moveNail, nailMoveProblem } from '../sim/board';
import type { Vec2 } from '../sim/vec';
import { moveCircle } from '../sim/world';
import type { Table } from './table';

/** One nudge: 0.1 mm (PLAN.md M7). */
export const NAIL_STEP_M = 0.0001;

export interface NailOffset {
  /** Steps of NAIL_STEP_M from the loaded position, x right, y up. */
  readonly dx: number;
  readonly dy: number;
}

export interface Adjust {
  /** Edit mode is on. The table isn't stepped while it is. */
  editing: boolean;
  /** Index into the board's nails (and the world's circles), or null for none. */
  selected: number | null;
  /** The nails as the board loaded them. Offsets count from these. */
  readonly original: readonly Vec2[];
  /** Per moved nail, its offset in steps. A nail back where it started has no entry. */
  readonly offsets: Map<number, NailOffset>;
  /** Why the latest move was refused, or null. Cleared by the next call that changes anything. */
  problem: string | null;
}

export function createAdjust(table: Table): Adjust {
  return {
    editing: false,
    selected: null,
    original: table.board.nails.map((n) => ({ x: n.x, y: n.y })),
    offsets: new Map(),
    problem: null,
  };
}

/** Turn edit mode on or off. Leaving it keeps the selection for next time, and clears any refusal. */
export function setEditing(adjust: Adjust, editing: boolean): void {
  adjust.editing = editing;
  adjust.problem = null;
}

/**
 * Select the nail nearest (x, y), in metres, if one is within `reachM` of
 * it; otherwise select none. Ties go to the lower index. Returns the
 * selection.
 */
export function selectNailAt(
  adjust: Adjust,
  table: Table,
  x: number,
  y: number,
  reachM: number,
): number | null {
  let best: number | null = null;
  let bestM = reachM;
  table.board.nails.forEach((n, i) => {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d <= bestM && (best === null || d < bestM)) {
      best = i;
      bestM = d;
    }
  });
  adjust.selected = best;
  adjust.problem = null;
  return best;
}

/** The selected nail's offset in steps: zero if it hasn't moved, null with no selection. */
export function selectedOffset(adjust: Adjust): NailOffset | null {
  if (adjust.selected === null) return null;
  return adjust.offsets.get(adjust.selected) ?? { dx: 0, dy: 0 };
}

/**
 * Move the selected nail by (dx, dy) whole steps of NAIL_STEP_M. Refused,
 * with the reason in `problem` and nothing changed, if no nail is selected,
 * the steps aren't whole numbers, the board's rules forbid the new spot
 * (nailMoveProblem), or a ball in play is in the way. Returns whether it
 * moved.
 */
export function nudgeSelected(adjust: Adjust, table: Table, dx: number, dy: number): boolean {
  const offset = selectedOffset(adjust);
  if (offset === null || adjust.selected === null) {
    adjust.problem = 'Select a nail first';
    return false;
  }
  if (!(Number.isInteger(dx) && Number.isInteger(dy))) {
    adjust.problem = `Nudges are whole steps, got (${dx}, ${dy})`;
    return false;
  }
  return placeSelected(adjust, table, { dx: offset.dx + dx, dy: offset.dy + dy });
}

/** Put the selected nail back where the board loaded it. Refused like a nudge if it can't go there now. */
export function resetSelected(adjust: Adjust, table: Table): boolean {
  if (adjust.selected === null) {
    adjust.problem = 'Select a nail first';
    return false;
  }
  return placeSelected(adjust, table, { dx: 0, dy: 0 });
}

function placeSelected(adjust: Adjust, table: Table, offset: NailOffset): boolean {
  const index = adjust.selected as number;
  const home = adjust.original[index] as Vec2;
  const to = { x: home.x + offset.dx * NAIL_STEP_M, y: home.y + offset.dy * NAIL_STEP_M };
  const problem = nailMoveProblem(table.board, index, to);
  if (problem) {
    adjust.problem = `Nail ${index} can't go there: ${problem}`;
    return false;
  }
  try {
    moveCircle(table.world, index, to.x, to.y);
  } catch {
    adjust.problem = `Nail ${index} can't go there: a ball in play is in the way`;
    return false;
  }
  // nailMoveProblem passed, so this can't throw; and the world has moved.
  table.board = moveNail(table.board, index, to);
  if (offset.dx === 0 && offset.dy === 0) adjust.offsets.delete(index);
  else adjust.offsets.set(index, offset);
  adjust.problem = null;
  return true;
}
