// Fixed-step integrator and ball lifecycle (M1).
//
// For M0 the world holds only the sim clock, so the frame loop has something
// real to advance and the debug overlay has something to report.

/** Sim timestep. PLAN.md: 1/2000 s or finer, so a ball at max launch speed moves less than its radius per step. */
export const SIM_STEP_S = 1 / 2000;

export interface World {
  /** Total sim time advanced, in seconds. Equals steps × SIM_STEP_S. */
  timeS: number;
  /** Number of fixed steps taken since creation. */
  steps: number;
}

export function createWorld(): World {
  return { timeS: 0, steps: 0 };
}

/** Advance the world by exactly one fixed step. */
export function stepWorld(world: World): void {
  world.steps += 1;
  // Derive time from the step count so it never accumulates float error.
  world.timeS = world.steps * SIM_STEP_S;
}
