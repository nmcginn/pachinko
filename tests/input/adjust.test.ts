import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAIL_STEP_M, createAdjust } from '../../src/game/adjust';
import { createTable } from '../../src/game/table';
import {
  ADJUST_CODE,
  BIG_NUDGE_STEPS,
  PICK_REACH_PX,
  adjustKeyAction,
  bindAdjust,
} from '../../src/input/adjust';
import { type BoardView, fitBoard } from '../../src/render/board';
import { parseBoard } from '../../src/sim/board';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));

const key = (props: Partial<KeyboardEvent>) => ({
  code: '',
  key: '',
  repeat: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...props,
});

describe('adjustKeyAction', () => {
  it('E toggles edit mode, in or out of it', () => {
    expect(ADJUST_CODE).toBe('KeyE');
    expect(adjustKeyAction(key({ code: 'KeyE', key: 'e' }), false)).toEqual({ kind: 'toggle' });
    expect(adjustKeyAction(key({ code: 'KeyE', key: 'e' }), true)).toEqual({ kind: 'toggle' });
  });

  it('ignores E on repeat and with Ctrl, Cmd or Alt', () => {
    expect(adjustKeyAction(key({ code: 'KeyE', repeat: true }), false)).toBeNull();
    expect(adjustKeyAction(key({ code: 'KeyE', ctrlKey: true }), false)).toBeNull();
    expect(adjustKeyAction(key({ code: 'KeyE', metaKey: true }), false)).toBeNull();
    expect(adjustKeyAction(key({ code: 'KeyE', altKey: true }), false)).toBeNull();
  });

  it('in edit mode, arrows nudge one step (ten with Shift), repeating, and Escape leaves', () => {
    expect(adjustKeyAction(key({ key: 'ArrowLeft' }), true)).toEqual({
      kind: 'nudge',
      dx: -1,
      dy: 0,
    });
    expect(adjustKeyAction(key({ key: 'ArrowUp', repeat: true }), true)).toEqual({
      kind: 'nudge',
      dx: 0,
      dy: 1,
    });
    expect(adjustKeyAction(key({ key: 'ArrowDown', shiftKey: true }), true)).toEqual({
      kind: 'nudge',
      dx: 0,
      dy: -BIG_NUDGE_STEPS,
    });
    expect(BIG_NUDGE_STEPS * NAIL_STEP_M).toBeCloseTo(0.001, 15);
    expect(adjustKeyAction(key({ key: 'Escape' }), true)).toEqual({ kind: 'leave' });
  });

  it('out of edit mode, arrows and Escape are left to the handle', () => {
    expect(adjustKeyAction(key({ key: 'ArrowLeft' }), false)).toBeNull();
    expect(adjustKeyAction(key({ key: 'Escape' }), false)).toBeNull();
    expect(adjustKeyAction(key({ code: 'Space', key: ' ' }), true)).toBeNull();
  });
});

describe('bindAdjust', () => {
  /** An element stand-in: an event target, with a box for the canvas. */
  const element = () =>
    Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 10, top: 20 }),
    }) as unknown as HTMLElement;

  function setup(view: BoardView | null = fitBoard(1280, 800, 0.5, 0.53, 16, 84)) {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    const target = new EventTarget();
    const els = {
      toggle: element(),
      canvas: element(),
      left: element(),
      right: element(),
      up: element(),
      down: element(),
      reset: element(),
    };
    let changes = 0;
    const unbind = bindAdjust(
      target,
      els,
      adjust,
      table,
      () => view,
      () => changes++,
    );
    const press = (props: Partial<KeyboardEvent>) => {
      const e = Object.assign(new Event('keydown', { cancelable: true }), key(props));
      target.dispatchEvent(e);
      return e;
    };
    const click = (el: HTMLElement) => el.dispatchEvent(new Event('click'));
    /** A pointer press on the canvas over board point (x, y). */
    const tap = (x: number, y: number) => {
      if (!view) throw new Error('no view');
      const e = Object.assign(new Event('pointerdown', { cancelable: true }), {
        clientX: 10 + view.ox + x * view.scale,
        clientY: 20 + view.oy - y * view.scale,
      });
      els.canvas.dispatchEvent(e);
      return e;
    };
    return { table, adjust, els, press, click, tap, unbind, changes: () => changes };
  }

  it('toggles edit mode with E and the button, and leaves with Escape', () => {
    const { adjust, els, press, click, changes } = setup();
    const e = press({ code: 'KeyE', key: 'e' });
    expect(adjust.editing).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    press({ key: 'Escape' });
    expect(adjust.editing).toBe(false);
    click(els.toggle);
    expect(adjust.editing).toBe(true);
    click(els.toggle);
    expect(adjust.editing).toBe(false);
    expect(changes()).toBe(4);
  });

  it('selects a nail by tapping near it, only in edit mode', () => {
    const { adjust, tap, press } = setup();
    tap(0.2573, 0.178);
    expect(adjust.selected).toBeNull();
    press({ code: 'KeyE' });
    const e = tap(0.2573 + 0.0005, 0.178);
    expect(adjust.selected).toBe(1);
    expect(e.defaultPrevented).toBe(true);
    // Over the out-hole, well away from any nail: deselects.
    tap(0.25, 0.02);
    expect(adjust.selected).toBeNull();
  });

  it('picks within PICK_REACH_PX on screen, whatever the scale', () => {
    const view = fitBoard(1280, 800, 0.5, 0.53, 16, 84);
    const { adjust, tap, press } = setup(view);
    press({ code: 'KeyE' });
    const reachM = PICK_REACH_PX / view.scale;
    tap(0.2573, 0.178 + 0.95 * reachM);
    expect(adjust.selected).toBe(1);
    tap(0.2573, 0.178 + 1.05 * reachM);
    expect(adjust.selected).toBeNull();
  });

  it('does nothing on a tap before the first frame has a view', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    const canvas = element();
    const els = {
      ...Object.fromEntries(
        ['toggle', 'left', 'right', 'up', 'down', 'reset'].map((k) => [k, element()]),
      ),
      canvas,
    } as unknown as Parameters<typeof bindAdjust>[1];
    bindAdjust(
      new EventTarget(),
      els,
      adjust,
      table,
      () => null,
      () => {},
    );
    adjust.editing = true;
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { clientX: 500, clientY: 500 }));
    expect(adjust.selected).toBeNull();
  });

  it('nudges the selected nail with the arrow keys and the buttons, and resets it', () => {
    const { table, adjust, els, press, click, tap } = setup();
    press({ code: 'KeyE' });
    tap(0.2573, 0.178);
    press({ key: 'ArrowRight' });
    press({ key: 'ArrowUp', shiftKey: true });
    expect(adjust.offsets.get(1)).toEqual({ dx: 1, dy: BIG_NUDGE_STEPS });
    click(els.left);
    click(els.left);
    click(els.down);
    click(els.up);
    click(els.right);
    expect(adjust.offsets.get(1)).toEqual({ dx: 0, dy: BIG_NUDGE_STEPS });
    expect(table.board.nails[1]).toEqual({ x: 0.2573, y: 0.179 });
    click(els.reset);
    expect(table.board.nails[1]).toEqual({ x: 0.2573, y: 0.178 });
    expect(adjust.offsets.size).toBe(0);
  });

  it('leaves the arrow keys alone out of edit mode, and stops after unbinding', () => {
    const { adjust, press, unbind } = setup();
    const e = press({ key: 'ArrowRight' });
    expect(e.defaultPrevented).toBe(false);
    unbind();
    press({ code: 'KeyE' });
    expect(adjust.editing).toBe(false);
  });
});
