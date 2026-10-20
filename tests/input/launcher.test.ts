import { describe, expect, it } from 'vitest';
import { createFireControl } from '../../src/game/fire';
import {
  DIAL_SWEEP_DEG,
  POWER_STEP,
  stepPower,
  bindKeyboard,
  createHolds,
  dialAngleToPower,
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
  function setup() {
    const target = new EventTarget();
    const fire = createFireControl();
    const unbind = bindKeyboard(target as unknown as Window, fire, createHolds(fire));
    const send = (type: string, props: { code?: string; key?: string }) => {
      const e = new Event(type, { cancelable: true });
      Object.assign(e, props);
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
});
