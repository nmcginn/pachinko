import { describe, expect, it } from 'vitest';
import { createFireControl } from '../../src/game/fire';
import {
  DIAL_SWEEP_DEG,
  POWER_STEP,
  stepPower,
  bindDial,
  bindKeyboard,
  createHolds,
  dialAngleToPower,
  inFormField,
  pointerAngleDeg,
  powerToDialAngleDeg,
} from '../../src/input/launcher';

describe('dial mapping', () => {
  it('sweeps 270° from 7:30 (power 0) clockwise to 4:30 (power 1)', () => {
    expect(DIAL_SWEEP_DEG).toBe(270);
    expect(dialAngleToPower(-135)).toBe(0);
    expect(dialAngleToPower(0)).toBe(0.5);
    expect(dialAngleToPower(90)).toBeCloseTo(225 / 270, 12);
    expect(dialAngleToPower(135)).toBe(1);
  });

  it('snaps the dead zone at the bottom to the nearer end', () => {
    expect(dialAngleToPower(170)).toBe(1);
    expect(dialAngleToPower(180)).toBe(1);
    expect(dialAngleToPower(-170)).toBe(0);
    expect(dialAngleToPower(190)).toBe(0); // same as -170
  });

  it('normalises any angle, including multiple turns', () => {
    expect(dialAngleToPower(360)).toBe(0.5);
    expect(dialAngleToPower(-720 + 90)).toBeCloseTo(225 / 270, 12);
  });

  it('round-trips power through the dial angle', () => {
    for (let k = 0; k <= 20; k++) {
      expect(dialAngleToPower(powerToDialAngleDeg(k / 20))).toBeCloseTo(k / 20, 12);
    }
    expect(powerToDialAngleDeg(-1)).toBe(-135);
    expect(powerToDialAngleDeg(2)).toBe(135);
  });

  it('measures pointer angles clockwise from up, in screen space (y down)', () => {
    expect(pointerAngleDeg(0, -1)).toBeCloseTo(0, 12);
    expect(pointerAngleDeg(1, 0)).toBeCloseTo(90, 12);
    expect(pointerAngleDeg(-1, 0)).toBeCloseTo(-90, 12);
    expect(Math.abs(pointerAngleDeg(0, 1))).toBeCloseTo(180, 12);
  });
});

describe('holds', () => {
  it('keeps fire held while any input holds it', () => {
    const fire = createFireControl();
    const holds = createHolds(fire);
    holds.set('key', true);
    holds.set('dial', true);
    holds.set('dial', false);
    expect(fire.held).toBe(true);
    holds.set('key', false);
    expect(fire.held).toBe(false);
    holds.set('key', false);
    expect(fire.held).toBe(false);
  });
});

describe('keyboard', () => {
  function setup(active?: () => boolean) {
    const target = new EventTarget();
    const fire = createFireControl();
    const unbind = bindKeyboard(target as unknown as Window, fire, createHolds(fire), active);
    const send = (type: string, props: { code?: string; key?: string }, tagName?: string) => {
      const e = new Event(type, { cancelable: true });
      Object.assign(e, props);
      // An own property shadows Event's target getter, so the handler sees a form field.
      if (tagName) Object.defineProperty(e, 'target', { value: { tagName } });
      target.dispatchEvent(e);
      return e;
    };
    return { fire, send, unbind };
  }

  it('holds fire while space is down', () => {
    const { fire, send } = setup();
    const e = send('keydown', { code: 'Space', key: ' ' });
    expect(fire.held).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    send('keyup', { code: 'Space', key: ' ' });
    expect(fire.held).toBe(false);
  });

  it('releases fire when the window loses focus', () => {
    const { fire, send } = setup();
    send('keydown', { code: 'Space', key: ' ' });
    send('blur', {});
    expect(fire.held).toBe(false);
  });

  it('steps power with the arrow keys and clamps it', () => {
    const { fire, send } = setup();
    send('keydown', { code: 'ArrowUp', key: 'ArrowUp' });
    expect(fire.power).toBeCloseTo(0.5 + POWER_STEP, 12);
    send('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' });
    send('keydown', { code: 'ArrowDown', key: 'ArrowDown' });
    expect(fire.power).toBeCloseTo(0.5 - POWER_STEP, 12);
    for (let i = 0; i < 100; i++) send('keydown', { code: 'ArrowRight', key: 'ArrowRight' });
    expect(fire.power).toBe(1);
  });

  it('keeps key steps on the POWER_STEP grid, exactly', () => {
    const { fire, send } = setup();
    for (let i = 0; i < 60; i++) send('keydown', { code: 'ArrowDown', key: 'ArrowDown' });
    expect(fire.power).toBe(0);
    for (let i = 0; i < 10; i++) send('keydown', { code: 'ArrowUp', key: 'ArrowUp' });
    // Adding 0.02 ten times would give 0.20000000000000004.
    expect(fire.power).toBe(0.2);
    for (let i = 0; i < 31; i++) send('keydown', { code: 'ArrowUp', key: 'ArrowUp' });
    expect(fire.power).toBe(0.82);
  });

  it('snaps an off-grid power (from the dial) onto the grid at the next key step', () => {
    expect(stepPower(0.437, 1)).toBe(0.46);
    expect(stepPower(0.437, -1)).toBe(0.42);
    expect(stepPower(0, -1)).toBe(-0.02); // setPower clamps it to 0.
    expect(stepPower(1, 1)).toBe(1.02);
  });

  it('ignores other keys, and everything after unbinding', () => {
    const { fire, send, unbind } = setup();
    const e = send('keydown', { code: 'KeyA', key: 'a' });
    expect(e.defaultPrevented).toBe(false);
    expect(fire).toMatchObject({ held: false, power: 0.5 });
    unbind();
    send('keydown', { code: 'Space', key: ' ' });
    expect(fire.held).toBe(false);
  });

  it('does nothing while inactive (adjusting nails), and works again after', () => {
    let active = false;
    const { fire, send } = setup(() => active);
    const e = send('keydown', { code: 'ArrowUp', key: 'ArrowUp' });
    send('keydown', { code: 'Space', key: ' ' });
    expect(e.defaultPrevented).toBe(false);
    expect(fire).toMatchObject({ held: false, power: 0.5 });
    active = true;
    send('keydown', { code: 'ArrowUp', key: 'ArrowUp' });
    expect(fire.power).toBeCloseTo(0.5 + POWER_STEP, 12);
  });

  it('leaves keys in a form field alone (the settings selects and volume slider)', () => {
    const { fire, send } = setup();
    for (const tag of ['SELECT', 'INPUT', 'TEXTAREA']) {
      const arrow = send('keydown', { code: 'ArrowUp', key: 'ArrowUp' }, tag);
      const space = send('keydown', { code: 'Space', key: ' ' }, tag);
      expect(arrow.defaultPrevented, tag).toBe(false);
      expect(space.defaultPrevented, tag).toBe(false);
      expect(fire).toMatchObject({ held: false, power: 0.5 });
    }
    // A button is not a form field: space on the focused mute button still fires.
    send('keydown', { code: 'Space', key: ' ' }, 'BUTTON');
    expect(fire.held).toBe(true);
  });

  it('inFormField: only inputs, selects and text areas', () => {
    const ev = (target: unknown) => {
      const e = new Event('keydown');
      Object.defineProperty(e, 'target', { value: target });
      return e;
    };
    expect(inFormField(ev({ tagName: 'INPUT' }))).toBe(true);
    expect(inFormField(ev({ tagName: 'SELECT' }))).toBe(true);
    expect(inFormField(ev({ tagName: 'TEXTAREA' }))).toBe(true);
    expect(inFormField(ev({ tagName: 'BUTTON' }))).toBe(false);
    expect(inFormField(ev({ tagName: 'BODY' }))).toBe(false);
    expect(inFormField(ev(null))).toBe(false);
    expect(inFormField(ev({}))).toBe(false);
  });
});

describe('dial', () => {
  /** A 100 px dial with its centre at (150, 250), as getBoundingClientRect gives it. */
  const BOX = { left: 100, top: 200, width: 100, height: 100 };
  const CX = 150;
  const CY = 250;

  function setup(active?: () => boolean) {
    const target = new EventTarget();
    const captured: number[] = [];
    const dial = Object.assign(target, {
      getBoundingClientRect: () => BOX,
      setPointerCapture: (id: number) => captured.push(id),
    }) as unknown as HTMLElement;
    const fire = createFireControl();
    const unbind = bindDial(dial, fire, createHolds(fire), active);
    const send = (type: string, pointerId: number, clientX = CX, clientY = CY) => {
      const e = new Event(type, { cancelable: true });
      Object.assign(e, { pointerId, clientX, clientY });
      target.dispatchEvent(e);
      return e;
    };
    return { fire, send, unbind, captured };
  }

  it('a press holds fire and aims; turning sets the power; lifting lets go', () => {
    const { fire, send, captured } = setup();
    // 3 o'clock: 90° clockwise from up.
    const down = send('pointerdown', 1, CX + 40, CY);
    expect(down.defaultPrevented).toBe(true);
    expect(captured).toEqual([1]);
    expect(fire.held).toBe(true);
    expect(fire.power).toBeCloseTo(225 / 270, 12);
    // 12 o'clock: power 0.5.
    send('pointermove', 1, CX, CY - 40);
    expect(fire.power).toBeCloseTo(0.5, 12);
    send('pointerup', 1, CX, CY - 40);
    expect(fire.held).toBe(false);
    expect(fire.power).toBeCloseTo(0.5, 12);
  });

  it('keeps aiming with a finger slid off the dial, by its angle from the centre', () => {
    const { fire, send } = setup();
    send('pointerdown', 1, CX, CY - 40);
    // Far to the left of the dial: 9 o'clock, power 45 / 270.
    send('pointermove', 1, CX - 300, CY);
    expect(fire.held).toBe(true);
    expect(fire.power).toBeCloseTo(45 / 270, 12);
  });

  it('keeps the power when the finger is too near the centre to aim', () => {
    const { fire, send } = setup();
    send('pointerdown', 1, CX, CY - 40);
    send('pointermove', 1, CX + 9, CY + 1);
    expect(fire.power).toBeCloseTo(0.5, 12);
    // A press right on the centre holds without moving the power either.
    send('pointerup', 1);
    send('pointerdown', 2, CX, CY);
    expect(fire).toMatchObject({ held: true, power: 0.5 });
  });

  it('ignores a second finger while the first holds the dial', () => {
    const { fire, send, captured } = setup();
    send('pointerdown', 1, CX, CY - 40);
    send('pointerdown', 2, CX + 40, CY);
    send('pointermove', 2, CX - 40, CY);
    expect(captured).toEqual([1]);
    expect(fire.power).toBeCloseTo(0.5, 12);
    // The second finger lifting doesn't let go of the first's hold.
    send('pointerup', 2, CX - 40, CY);
    expect(fire.held).toBe(true);
    send('pointerup', 1);
    expect(fire.held).toBe(false);
  });

  it('lets go when the browser cancels the pointer, and takes the next press', () => {
    const { fire, send } = setup();
    send('pointerdown', 1, CX, CY - 40);
    send('pointercancel', 1);
    expect(fire.held).toBe(false);
    send('pointerdown', 2, CX + 40, CY);
    expect(fire.held).toBe(true);
  });

  it('cancels the long-press context menu', () => {
    const { send } = setup();
    expect(send('contextmenu', 1).defaultPrevented).toBe(true);
  });

  it('ignores a press while inactive (adjusting nails, the settings open)', () => {
    let active = false;
    const { fire, send } = setup(() => active);
    const e = send('pointerdown', 1, CX + 40, CY);
    expect(e.defaultPrevented).toBe(false);
    expect(fire).toMatchObject({ held: false, power: 0.5 });
    // That pointer never held the dial, so its moves do nothing either.
    send('pointermove', 1, CX - 40, CY);
    expect(fire.power).toBe(0.5);
    active = true;
    send('pointerdown', 2, CX + 40, CY);
    expect(fire.held).toBe(true);
  });

  it('does nothing after unbinding', () => {
    const { fire, send, unbind } = setup();
    unbind();
    send('pointerdown', 1, CX + 40, CY);
    expect(fire).toMatchObject({ held: false, power: 0.5 });
    expect(send('contextmenu', 1).defaultPrevented).toBe(false);
  });
});
