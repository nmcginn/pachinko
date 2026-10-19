// Launch handle state and auto-fire timing. Pure: the input layer sets
// `held` and `power`, and the table asks once per sim step whether to fire.
// Timing counts sim steps, never wall time.

import { SIM_STEP_S } from '../sim/world';

/** Real machines cap the firing rate at 100 balls a minute (PLAN.md). */
export const AUTO_FIRE_PER_MIN = 100;
/** Sim steps between shots while the handle is held: 0.6 s. */
export const FIRE_INTERVAL_STEPS = Math.round(60 / AUTO_FIRE_PER_MIN / SIM_STEP_S);
/** Handle position on load: the middle of its range. */
export const DEFAULT_POWER = 0.5;

export interface FireControl {
  /** Handle held (or fire key down): fire at the auto-fire rate. */
  held: boolean;
  /** Handle power in [0, 1]. Set it through setPower. */
  power: number;
  /** Steps until the next shot is allowed. 0 means ready. */
  cooldownSteps: number;
}

export function createFireControl(power = DEFAULT_POWER): FireControl {
  const control = { held: false, power: 0, cooldownSteps: 0 };
  setPower(control, power);
  return control;
}

/** Set the handle power, clamped to [0, 1]. NaN leaves it unchanged. */
export function setPower(control: FireControl, power: number): void {
  if (Number.isNaN(power)) return;
  control.power = Math.min(1, Math.max(0, power));
}

/**
 * Advance one sim step. True if a ball should be fired on this step. The
 * first shot goes the moment the handle is held; then one every
 * FIRE_INTERVAL_STEPS while it stays held. The cooldown keeps running after
 * release, so tapping the handle can't beat the 100-a-minute cap.
 *
 * `laneClear` false (a ball still sits where the next one would appear)
 * holds a due shot back until it is clear, as a real ball feed waits; the
 * interval counts from the shot that actually goes.
 */
export function stepFire(control: FireControl, laneClear = true): boolean {
  if (control.cooldownSteps > 0) control.cooldownSteps -= 1;
  if (!control.held || control.cooldownSteps > 0 || !laneClear) return false;
  control.cooldownSteps = FIRE_INTERVAL_STEPS;
  return true;
}
