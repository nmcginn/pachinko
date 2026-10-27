// Nail adjustment input (M7): the "Adjust nails" button or the E key turns
// edit mode on and off (Escape also leaves it). In edit mode a click or tap
// on the board selects the nearest nail, and the arrow keys or the panel's
// arrow buttons nudge it 0.1 mm (Shift with a key: 1 mm), or in bend mode
// lean it 0.5° (Shift: 2.5°). B or the panel's Nudge and Bend buttons
// switch between the two. The launch handle's keys and dial do nothing
// meanwhile (see bindKeyboard).

import {
  type Adjust,
  type AdjustMode,
  leanSelected,
  nudgeSelected,
  resetSelected,
  selectNailAt,
  setEditing,
  setMode,
} from '../game/adjust';
import type { Table } from '../game/table';
import { type BoardView, boardPointM } from '../render/board';

export const ADJUST_CODE = 'KeyE';
/** Switches the arrows between nudging and bending, in edit mode. */
export const MODE_CODE = 'KeyB';
/** A click or tap selects the nearest nail within this many CSS pixels. */
export const PICK_REACH_PX = 14;
/** Steps per Shift+arrow: 1 mm. */
export const BIG_NUDGE_STEPS = 10;
/** Steps per Shift+arrow in bend mode: 2.5°, so six reach the 15° limit. */
export const BIG_LEAN_STEPS = 5;

/**
 * An arrow moves the selected nail one way: (dx, dy) is a unit direction,
 * x right and y up, and `big` is Shift. What it does depends on the mode
 * (arrowSteps).
 */
export type AdjustAction =
  | { readonly kind: 'toggle' }
  | { readonly kind: 'leave' }
  | { readonly kind: 'mode' }
  | { readonly kind: 'arrow'; readonly dx: number; readonly dy: number; readonly big: boolean };

/** Steps an arrow takes in a mode: one, or with Shift ten nudges (1 mm) or five bends (2.5°). */
export function arrowSteps(mode: AdjustMode, big: boolean): number {
  if (!big) return 1;
  return mode === 'nudge' ? BIG_NUDGE_STEPS : BIG_LEAN_STEPS;
}

const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/**
 * What a key press does to nail adjustment, or null for nothing. E toggles
 * edit mode (not on key repeat, nor with Ctrl, Cmd or Alt); in edit mode,
 * Escape leaves it, B switches between nudging and bending (not on
 * repeat), and the arrows move the nail, repeating while held, further
 * with Shift. Board y is up, so ArrowUp is +y.
 */
export function adjustKeyAction(
  e: Pick<KeyboardEvent, 'code' | 'key' | 'repeat' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  editing: boolean,
): AdjustAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.code === ADJUST_CODE) return e.repeat ? null : { kind: 'toggle' };
  if (!editing) return null;
  if (e.key === 'Escape') return { kind: 'leave' };
  if (e.code === MODE_CODE) return e.repeat ? null : { kind: 'mode' };
  const arrow = ARROWS[e.key];
  if (!arrow) return null;
  return { kind: 'arrow', dx: arrow[0], dy: arrow[1], big: e.shiftKey };
}

export interface AdjustElements {
  /** Turns edit mode on and off. aria-pressed is on. */
  readonly toggle: HTMLElement;
  /** The canvas the board is drawn on: clicks and taps on it select nails. */
  readonly canvas: HTMLElement;
  /** The panel's arrow buttons, each nudging or bending one step. */
  readonly left: HTMLElement;
  readonly right: HTMLElement;
  readonly up: HTMLElement;
  readonly down: HTMLElement;
  /** Puts the selected nail back where the board loaded it. */
  readonly reset: HTMLElement;
  /** Make the arrows nudge, or bend. */
  readonly nudgeMode: HTMLElement;
  readonly bendMode: HTMLElement;
}

/**
 * Wire edit mode to `target`'s keys and the elements. `view` is the board's
 * latest mapping to the canvas, or null before the first frame. Calls
 * `changed` after anything that changed the adjust state, so the page can
 * show it. Returns an unbind function.
 */
export function bindAdjust(
  target: EventTarget,
  els: AdjustElements,
  adjust: Adjust,
  table: Table,
  view: () => BoardView | null,
  changed: () => void,
): () => void {
  const apply = (action: AdjustAction): void => {
    if (action.kind === 'toggle') setEditing(adjust, !adjust.editing);
    else if (action.kind === 'leave') setEditing(adjust, false);
    else if (action.kind === 'mode') setMode(adjust, adjust.mode === 'nudge' ? 'bend' : 'nudge');
    else {
      const n = arrowSteps(adjust.mode, action.big);
      if (adjust.mode === 'nudge') nudgeSelected(adjust, table, action.dx * n, action.dy * n);
      else leanSelected(adjust, table, action.dx * n, action.dy * n);
    }
    changed();
  };
  const key = (e: Event): void => {
    const action = adjustKeyAction(e as KeyboardEvent, adjust.editing);
    if (!action) return;
    e.preventDefault();
    apply(action);
  };
  const pick = (e: Event): void => {
    const bv = view();
    if (!adjust.editing || !bv || !(bv.scale > 0)) return;
    const p = e as PointerEvent;
    const box = els.canvas.getBoundingClientRect();
    const at = boardPointM(bv, p.clientX - box.left, p.clientY - box.top);
    selectNailAt(adjust, table, at.x, at.y, PICK_REACH_PX / bv.scale);
    e.preventDefault();
    changed();
  };
  const clicks: [HTMLElement, () => void][] = [
    [els.toggle, () => apply({ kind: 'toggle' })],
    [els.left, () => apply({ kind: 'arrow', dx: -1, dy: 0, big: false })],
    [els.right, () => apply({ kind: 'arrow', dx: 1, dy: 0, big: false })],
    [els.up, () => apply({ kind: 'arrow', dx: 0, dy: 1, big: false })],
    [els.down, () => apply({ kind: 'arrow', dx: 0, dy: -1, big: false })],
    [
      els.nudgeMode,
      () => {
        setMode(adjust, 'nudge');
        changed();
      },
    ],
    [
      els.bendMode,
      () => {
        setMode(adjust, 'bend');
        changed();
      },
    ],
    [
      els.reset,
      () => {
        resetSelected(adjust, table);
        changed();
      },
    ],
  ];
  target.addEventListener('keydown', key);
  els.canvas.addEventListener('pointerdown', pick);
  for (const [el, fn] of clicks) el.addEventListener('click', fn);
  return () => {
    target.removeEventListener('keydown', key);
    els.canvas.removeEventListener('pointerdown', pick);
    for (const [el, fn] of clicks) el.removeEventListener('click', fn);
  };
}
