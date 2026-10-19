import { describe, expect, it } from 'vitest';
import { SIM_STEP_S, createWorld, stepWorld } from '../../src/sim/world';

describe('world clock', () => {
  it('uses a step of 1/2000 s or finer (PLAN.md)', () => {
    expect(SIM_STEP_S).toBeLessThanOrEqual(1 / 2000);
  });

  it('starts at zero', () => {
    expect(createWorld()).toEqual({ timeS: 0, steps: 0 });
  });

  it('derives time from the step count with no accumulated drift', () => {
    const world = createWorld();
    for (let i = 0; i < 2_000_000; i++) stepWorld(world);
    expect(world.steps).toBe(2_000_000);
    expect(world.timeS).toBe(2_000_000 * SIM_STEP_S);
    expect(world.timeS).toBeCloseTo(1000, 9);
  });
});
