// Nail adjustment (M7): select a nail and nudge it in 0.1 mm steps, or
// bend it in 0.5° steps, as a hall's nail man (釘師) would with a hammer.
// Pure: the input layer turns clicks and keys into these calls, and the
// renderer reads the state.
//
// The machine is stopped while its nails are being adjusted: main.ts
// doesn't step the table while `editing` is set, so balls in play wait
// where they are. A move applies to the table's board and its world
// together, so the game always plays the board it draws.
//
// A nail's position is kept as whole steps from where the board loaded it,
// so nudging back and forth returns it exactly, with no rounding drift.
//
// Bending (the maintainer's option (a), PLAN.md "Resolved") leans the nail
// about its root. The ball meets a nail about one ball radius above the
// backboard, so a lean of θ moves the point the sim sees by
// BEND_HEIGHT_M × tan θ that way; the board stores only that position, as
// for a nudge. Leans are kept in whole steps too, per axis: a nail leant
// right and up moves right by h·tan θx and up by h·tan θy. A nail's
// position is its loaded one plus its nudges plus its lean's shift.
//
// Importing a board file replaces the table's board, world and all: the
// imported board is then the board as loaded, with nothing moved, and the
// nudges and leans start again from it. Its nails are where the file put
// them, so a nail bent before the export is just a nail in a new place.

import { BoardError, moveNail, nailMoveProblem } from '../sim/board';
import type { Vec2 } from '../sim/vec';
import { BALL_RADIUS_M, moveCircle } from '../sim/world';
import { readBoard } from './boardfile';
import { type Table, replaceBoard } from './table';

/** One nudge: 0.1 mm (PLAN.md M7). */
export const NAIL_STEP_M = 0.0001;

/** One bend: 0.5° (PLAN.md M7). */
export const BEND_STEP_DEG = 0.5;
/** Where the ball meets a nail, above the backboard: one ball radius (5.5 mm). */
export const BEND_HEIGHT_M = BALL_RADIUS_M;
/**
 * Most a nail leans either way on each axis, in steps: 15°, moving it
 * 1.47 mm. The model is a small-angle one: it takes the ball to meet the
 * nail at a fixed height whatever the lean, which stops being true once
 * the shank leans far enough to meet the ball first. 15° is well past
 * anything a nail man does (a degree or two) and keeps tan θ within 2.4%
 * of θ. Not a physics constant: a limit on the editor.
 */
export const MAX_LEAN_STEPS = 30;

export interface NailOffset {
  /** Steps of NAIL_STEP_M from the loaded position, x right, y up. */
  readonly dx: number;
  readonly dy: number;
}

export interface NailLean {
  /** Steps of BEND_STEP_DEG the head leans, x right, y up (toward the top of the board). */
  readonly lx: number;
  readonly ly: number;
}

/** What the arrows do in edit mode: nudge the selected nail, or bend it. */
export type AdjustMode = 'nudge' | 'bend';

export interface Adjust {
  /** Edit mode is on. The table isn't stepped while it is. */
  editing: boolean;
  /** Whether the arrows nudge or bend. Kept when edit mode is left. */
  mode: AdjustMode;
  /** Index into the board's nails (and the world's circles), or null for none. */
  selected: number | null;
  /** The nails as the board loaded them, or as it was imported. Offsets count from these. */
  original: readonly Vec2[];
  /** Per moved nail, its offset in steps. A nail back where it started has no entry. */
  readonly offsets: Map<number, NailOffset>;
  /** Per bent nail, its lean in steps. An upright nail has no entry. */
  readonly leans: Map<number, NailLean>;
  /** Why the latest move was refused, or null. Cleared by the next call that changes anything. */
  problem: string | null;
  /** What the latest call did, when it isn't plain on the board (an import), or null. Cleared like `problem`. */
  notice: string | null;
}

export function createAdjust(table: Table): Adjust {
  return {
    editing: false,
    mode: 'nudge',
    selected: null,
    original: table.board.nails.map((n) => ({ x: n.x, y: n.y })),
    offsets: new Map(),
    leans: new Map(),
    problem: null,
    notice: null,
  };
}

/** Clear the refusal and the notice: the call that does this succeeded. */
function clearMessages(adjust: Adjust): void {
  adjust.problem = null;
  adjust.notice = null;
}

/** Refuse, saying why. */
function refuse(adjust: Adjust, problem: string): false {
  adjust.problem = problem;
  adjust.notice = null;
  return false;
}

/** Turn edit mode on or off. Leaving it keeps the selection for next time, and clears any refusal. */
export function setEditing(adjust: Adjust, editing: boolean): void {
  adjust.editing = editing;
  clearMessages(adjust);
}

/** Switch the arrows between nudging and bending. Clears any refusal. */
export function setMode(adjust: Adjust, mode: AdjustMode): void {
  adjust.mode = mode;
  clearMessages(adjust);
}

/** Every nail nudged or bent away from where the board loaded it, in index order. */
export function movedNails(adjust: Adjust): number[] {
  return [...new Set([...adjust.offsets.keys(), ...adjust.leans.keys()])].sort((a, b) => a - b);
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
  clearMessages(adjust);
  return best;
}

/** The selected nail's offset in steps: zero if it hasn't moved, null with no selection. */
export function selectedOffset(adjust: Adjust): NailOffset | null {
  if (adjust.selected === null) return null;
  return adjust.offsets.get(adjust.selected) ?? { dx: 0, dy: 0 };
}

/** The selected nail's lean in steps: zero if it is upright, null with no selection. */
export function selectedLean(adjust: Adjust): NailLean | null {
  if (adjust.selected === null) return null;
  return adjust.leans.get(adjust.selected) ?? { lx: 0, ly: 0 };
}

/** How far a lean of `steps` moves a nail along that axis, in metres: BEND_HEIGHT_M × tan θ. */
export function leanShiftM(steps: number): number {
  return BEND_HEIGHT_M * Math.tan((steps * BEND_STEP_DEG * Math.PI) / 180);
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
    return refuse(adjust, 'Select a nail first');
  }
  if (!(Number.isInteger(dx) && Number.isInteger(dy))) {
    return refuse(adjust, `Nudges are whole steps, got (${dx}, ${dy})`);
  }
  const lean = selectedLean(adjust) as NailLean;
  return placeSelected(adjust, table, { dx: offset.dx + dx, dy: offset.dy + dy }, lean);
}

/**
 * Lean the selected nail's head by (lx, ly) more whole steps of
 * BEND_STEP_DEG, x right and y up. Refused like a nudge, and also if the
 * lean would pass MAX_LEAN_STEPS either way on either axis. Returns
 * whether it moved.
 */
export function leanSelected(adjust: Adjust, table: Table, lx: number, ly: number): boolean {
  const lean = selectedLean(adjust);
  const offset = selectedOffset(adjust);
  if (lean === null || offset === null) {
    return refuse(adjust, 'Select a nail first');
  }
  if (!(Number.isInteger(lx) && Number.isInteger(ly))) {
    return refuse(adjust, `Bends are whole steps, got (${lx}, ${ly})`);
  }
  const to = { lx: lean.lx + lx, ly: lean.ly + ly };
  if (Math.abs(to.lx) > MAX_LEAN_STEPS || Math.abs(to.ly) > MAX_LEAN_STEPS) {
    return refuse(adjust, `Nails lean at most ${MAX_LEAN_STEPS * BEND_STEP_DEG}° each way`);
  }
  return placeSelected(adjust, table, offset, to);
}

/**
 * Put the selected nail back where the board loaded it, unnudged and
 * upright. Refused like a nudge if it can't go there now.
 */
export function resetSelected(adjust: Adjust, table: Table): boolean {
  if (adjust.selected === null) {
    return refuse(adjust, 'Select a nail first');
  }
  return placeSelected(adjust, table, { dx: 0, dy: 0 }, { lx: 0, ly: 0 });
}

/**
 * `steps` nudges and `leanSteps` of lean from `homeM`, rounded to the
 * nanometre so a moved nail's coordinates are the decimals they look like
 * (0.2558, not 0.25580000000000003) in the board data and in messages.
 * No steps of either is home exactly.
 */
function stepFrom(homeM: number, steps: number, leanSteps: number): number {
  if (steps === 0 && leanSteps === 0) return homeM;
  return Math.round((homeM + steps * NAIL_STEP_M + leanShiftM(leanSteps)) * 1e9) / 1e9;
}

function placeSelected(adjust: Adjust, table: Table, offset: NailOffset, lean: NailLean): boolean {
  const index = adjust.selected as number;
  const home = adjust.original[index] as Vec2;
  const to = {
    x: stepFrom(home.x, offset.dx, lean.lx),
    y: stepFrom(home.y, offset.dy, lean.ly),
  };
  const problem = nailMoveProblem(table.board, index, to);
  if (problem) {
    return refuse(adjust, `Nail ${index} can't go there: ${problem}`);
  }
  try {
    moveCircle(table.world, index, to.x, to.y);
  } catch {
    return refuse(adjust, `Nail ${index} can't go there: a ball in play is in the way`);
  }
  // nailMoveProblem passed, so this can't throw; and the world has moved.
  table.board = moveNail(table.board, index, to);
  if (offset.dx === 0 && offset.dy === 0) adjust.offsets.delete(index);
  else adjust.offsets.set(index, offset);
  if (lean.lx === 0 && lean.ly === 0) adjust.leans.delete(index);
  else adjust.leans.set(index, lean);
  clearMessages(adjust);
  return true;
}

/** What the panel says when a board file is refused: the first problem, and how many more. */
export function importProblem(issues: readonly string[]): string {
  const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : '';
  return `Can't import that board: ${issues[0] ?? 'unknown problem'}${more}`;
}

/** Refuse a board file before reading it (too big, unreadable), as importBoard would. */
export function refuseImport(adjust: Adjust, issue: string): void {
  refuse(adjust, importProblem([issue]));
}

/**
 * Load a board file's text (game/boardfile.ts) in place of the table's
 * board: replaceBoard, then start the adjustments afresh from it, nothing
 * selected or moved, the mode and edit mode as they were. Refused, with
 * the file's first problem in `problem` and nothing changed, if it isn't a
 * valid board. Returns whether it loaded.
 */
export function importBoard(adjust: Adjust, table: Table, text: string): boolean {
  let board;
  try {
    board = readBoard(text);
  } catch (e) {
    if (e instanceof BoardError) return refuse(adjust, importProblem(e.issues));
    throw e;
  }
  const returned = replaceBoard(table, board);
  adjust.original = board.nails.map((n) => ({ x: n.x, y: n.y }));
  adjust.offsets.clear();
  adjust.leans.clear();
  adjust.selected = null;
  clearMessages(adjust);
  const nails = `${board.nails.length} nail${board.nails.length === 1 ? '' : 's'}`;
  const back =
    returned > 0 ? `; ${returned} ball${returned === 1 ? '' : 's'} in play back to the tray` : '';
  adjust.notice = `Imported "${board.name}", ${nails}${back}`;
  return true;
}

/** Say that the board was exported, as `fileName`, and how many nails it has moved. */
export function noteExported(adjust: Adjust, fileName: string): void {
  clearMessages(adjust);
  const moved = movedNails(adjust).length;
  adjust.notice = `Exported ${fileName}, ${moved} nail${moved === 1 ? '' : 's'} moved`;
}
