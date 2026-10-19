import { describe, expect, it } from 'vitest';
import {
  AUTO_FIRE_PER_MIN,
  DEFAULT_POWER,
  FIRE_INTERVAL_STEPS,
  createFireControl,
  setPower,
  stepFire,
} from '../../src/game/fire';
import { SIM_STEP_S } from '../../src/sim/world';

/** Step indices that fire over n steps, with `held` decided per step. */
function firings(n: number, held: (step: number) => boolean): number[] {
  const c = createFireControl();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    c.held = held(i);
    if (stepFire(c)) out.push(i);
  }
  return out;
}

describe('fire control', () => {
  it('auto-fires at 100 balls a minute: one every 0.6 s of sim time', () => {
    expect(AUTO_FIRE_PER_MIN).toBe(100);
    expect(FIRE_INTERVAL_STEPS * SIM_STEP_S).toBeCloseTo(0.6, 12);
    const shots = firings(Math.round(60 / SIM_STEP_S), () => true);
    expect(shots).toHaveLength(100);
    expect(shots[0]).toBe(0);
    for (let i = 1; i < shots.length; i++) {
      expect((shots[i] as number) - (shots[i - 1] as number)).toBe(FIRE_INTERVAL_STEPS);
    }
  });

  it('does not fire while released', () => {
    expect(firings(10_000, () => false)).toEqual([]);
  });

  it('fires the moment the handle is first held', () => {
    expect(firings(100, (i) => i >= 37)).toEqual([37]);
  });

  it('cannot beat the rate cap by tapping', () => {
    // Held for one step in every ten.
    const shots = firings(Math.round(6 / SIM_STEP_S), (i) => i % 10 === 0);
    expect(shots.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < shots.length; i++) {
      expect((shots[i] as number) - (shots[i - 1] as number)).toBeGreaterThanOrEqual(
        FIRE_INTERVAL_STEPS,
      );
    }
  });

  it('fires again as soon as the cooldown is over when re-held after a pause', () => {
    // Released between shots, re-held long after the cooldown ran out.
    const shots = firings(5000, (i) => i < 10 || i >= 3000);
    expect(shots).toEqual([0, 3000, 3000 + FIRE_INTERVAL_STEPS]);
  });

  it('starts at mid power and clamps power to [0, 1]', () => {
    const c = createFireControl();
    expect(c.power).toBe(DEFAULT_POWER);
    setPower(c, 1.7);
    expect(c.power).toBe(1);
    setPower(c, -0.2);
    expect(c.power).toBe(0);
    setPower(c, 0.25);
    expect(c.power).toBe(0.25);
    setPower(c, NaN);
    expect(c.power).toBe(0.25);
    expect(createFireControl(4).power).toBe(1);
  });
});
