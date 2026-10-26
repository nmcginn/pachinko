// Launch handle input: a drag/touch dial and the keyboard. Both only set the
// fire control's `power` and `held`; the table does the firing, on sim time.
//
// Dial: press and turn, like the real handle. Holding it fires; its angle is
// the power, over a 270° sweep from 7:30 (power 0) clockwise to 4:30 (power 1).
// Keyboard: arrow keys adjust power, space held fires.

import { type FireControl, setPower } from '../game/fire';

/** Angle the dial turns through from power 0 to power 1. */
export const DIAL_SWEEP_DEG = 270;
/** Power change per arrow key press (or key repeat). */
export const POWER_STEP = 0.02;

/**
 * Power one arrow-key step up (+1) or down (−1) from `power`, on the grid of
 * POWER_STEP: ten steps up from 0 are exactly 0.2, not 0.2 plus rounding
 * error, so a power reached by keys gives the same shots as that power set
 * in a test or the Monte Carlo. Clamped to [0, 1] by setPower.
 */
export function stepPower(power: number, direction: 1 | -1): number {
  const stepsPerUnit = Math.round(1 / POWER_STEP);
  return Math.round(power * stepsPerUnit + direction) / stepsPerUnit;
}

/**
 * Power for a dial angle in degrees, clockwise from straight up. The dead
 * zone at the bottom snaps to whichever end is nearer.
 */
export function dialAngleToPower(angleDeg: number): number {
  // Normalise to (-180, 180].
  let a = ((angleDeg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  const half = DIAL_SWEEP_DEG / 2;
  return Math.min(1, Math.max(0, (a + half) / DIAL_SWEEP_DEG));
}

/** Dial angle in degrees, clockwise from up, that shows this power. */
export function powerToDialAngleDeg(power: number): number {
  const p = Math.min(1, Math.max(0, power));
  return -DIAL_SWEEP_DEG / 2 + p * DIAL_SWEEP_DEG;
}

/** Angle of a screen-space offset (y down) from the dial centre, clockwise from up. */
export function pointerAngleDeg(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/**
 * Fire is held while any input holds it, so letting go of the dial doesn't
 * cancel a held space bar, or the other way round.
 */
export interface Holds {
  set(source: string, down: boolean): void;
}

export function createHolds(fire: FireControl): Holds {
  const down = new Set<string>();
  return {
    set(source, isDown) {
      if (isDown) down.add(source);
      else down.delete(source);
      fire.held = down.size > 0;
    },
  };
}

const INCREASE = new Set(['ArrowUp', 'ArrowRight']);
const DECREASE = new Set(['ArrowDown', 'ArrowLeft']);

/**
 * Arrow keys and space, on the whole window, while `active()` (not while
 * the nails are being adjusted, M7: the arrows nudge a nail then). Returns
 * an unbind function.
 */
export function bindKeyboard(
  target: Window,
  fire: FireControl,
  holds: Holds,
  active: () => boolean = () => true,
): () => void {
  const down = (e: KeyboardEvent): void => {
    if (!active()) return;
    if (e.code === 'Space') {
      holds.set('key', true);
      e.preventDefault();
    } else if (INCREASE.has(e.key)) {
      setPower(fire, stepPower(fire.power, 1));
      e.preventDefault();
    } else if (DECREASE.has(e.key)) {
      setPower(fire, stepPower(fire.power, -1));
      e.preventDefault();
    }
  };
  const up = (e: KeyboardEvent): void => {
    if (e.code === 'Space') holds.set('key', false);
  };
  // A key released while the window is not focused never sends keyup.
  const blur = (): void => holds.set('key', false);
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', blur);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
    target.removeEventListener('blur', blur);
  };
}

/**
 * Pointer (mouse, touch, pen) on the dial element. A press while
 * `active()` is false is ignored. Returns an unbind function.
 */
export function bindDial(
  dial: HTMLElement,
  fire: FireControl,
  holds: Holds,
  active: () => boolean = () => true,
): () => void {
  let pointer: number | null = null;

  const aim = (e: PointerEvent): void => {
    const box = dial.getBoundingClientRect();
    const dx = e.clientX - (box.left + box.width / 2);
    const dy = e.clientY - (box.top + box.height / 2);
    // Too close to the centre to have a meaningful angle: keep the power.
    if (Math.hypot(dx, dy) < box.width * 0.1) return;
    setPower(fire, dialAngleToPower(pointerAngleDeg(dx, dy)));
  };
  const press = (e: PointerEvent): void => {
    if (pointer !== null || !active()) return;
    pointer = e.pointerId;
    dial.setPointerCapture(e.pointerId);
    holds.set('dial', true);
    aim(e);
    e.preventDefault();
  };
  const move = (e: PointerEvent): void => {
    if (e.pointerId === pointer) aim(e);
  };
  const release = (e: PointerEvent): void => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    holds.set('dial', false);
  };
  dial.addEventListener('pointerdown', press);
  dial.addEventListener('pointermove', move);
  dial.addEventListener('pointerup', release);
  dial.addEventListener('pointercancel', release);
  return () => {
    dial.removeEventListener('pointerdown', press);
    dial.removeEventListener('pointermove', move);
    dial.removeEventListener('pointerup', release);
    dial.removeEventListener('pointercancel', release);
  };
}
