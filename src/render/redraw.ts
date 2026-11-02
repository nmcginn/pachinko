// Whether the canvas needs drawing again this frame (M8, Lighthouse). The
// board, its gates and the edit marks change only now and then; most of
// the time nothing on the canvas moves except the balls and the glints.
// Redrawing an unchanged board every frame costs a full-canvas raster,
// which on a phone with no balls in play is nearly all of the page's
// main-thread time. So the frame loop describes what it would draw as a
// Scene and draws only when that differs from the last one drawn, or when
// something in it moves on its own (a ball, a fading glint).
//
// Pure: no DOM. main.ts builds the Scene from the canvas, the layout, the
// table and the adjust state.

import type { Board } from '../sim/board';
import type { Gate } from '../sim/world';
import { GLINT_STEPS, type Glints } from './glints';
import type { Rect } from './layout';

/** Everything the canvas shows, as far as deciding to redraw goes. */
export interface Scene {
  /** The canvas backing store in device pixels. Resizing it clears the canvas. */
  readonly backingWidth: number;
  readonly backingHeight: number;
  /** Drawing space in CSS pixels. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** Where the board is fitted (render/layout.ts), compared by value. */
  readonly area: Rect;
  /** The board, by identity: every nudge, bend, import or new game replaces it. */
  readonly board: Board;
  /** Each gate's open state, in the world's order (gateKey). */
  readonly gates: string;
  /** Balls in play. Any at all and the scene is redrawn every frame. */
  readonly balls: number;
  /** A nail is glinting (glintsLive). While one is, the scene is redrawn every frame. */
  readonly glinting: boolean;
  /** Edit mode, and the selected nail: the edit marks. */
  readonly editing: boolean;
  readonly selected: number | null;
}

/** The gates' open states as a short string, "1" open and "0" shut, so a change is a string compare. */
export function gateKey(gates: readonly Gate[]): string {
  let key = '';
  for (const g of gates) key += g.open ? '1' : '0';
  return key;
}

/**
 * Whether any nail is glinting at step `nowStep`, by the same rule as
 * glintLevel: a glint lasts GLINT_STEPS from the step it started.
 */
export function glintsLive(glints: Readonly<Glints>, nowStep: number): boolean {
  for (const start of glints.startStep) {
    const age = nowStep - start;
    if (age >= 0 && age < GLINT_STEPS) return true;
  }
  return false;
}

const sameRect = (a: Rect, b: Rect) =>
  a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

/**
 * Whether to draw `next`, given the scene drawn last (null for none yet).
 * Draws when anything shown has changed, and every frame while a ball or
 * a glint is on the board; a ball leaving or a glint ending changes the
 * scene too, so the frame that erases it is drawn.
 */
export function needsRedraw(prev: Scene | null, next: Scene): boolean {
  if (prev === null) return true;
  if (next.balls > 0 || next.glinting) return true;
  return (
    prev.balls !== next.balls ||
    prev.glinting !== next.glinting ||
    prev.backingWidth !== next.backingWidth ||
    prev.backingHeight !== next.backingHeight ||
    prev.cssWidth !== next.cssWidth ||
    prev.cssHeight !== next.cssHeight ||
    !sameRect(prev.area, next.area) ||
    prev.board !== next.board ||
    prev.gates !== next.gates ||
    prev.editing !== next.editing ||
    prev.selected !== next.selected
  );
}
