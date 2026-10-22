// The jackpot celebration: a screen flash and the reel panel's celebration,
// both in the 2 s the gate stays shut before round 1 (ROUND_INTERVAL_S),
// while the fanfare plays. Timed in sim steps from the machine, so they
// pause with the game and play the same way under a test's fake clock.
// The pure functions are Node-tested; createFlash is the DOM side.

import type { Machine } from '../game/machine';
import { SIM_STEP_S } from '../sim/world';

/**
 * Flash pulses: when each starts after the reel shows the jackpot, and its
 * peak opacity. Two in the first second, under the three-flashes-a-second
 * limit for photosensitive viewers (WCAG 2.3.1), and never under
 * prefers-reduced-motion.
 */
export const FLASH_PULSES: readonly { readonly atS: number; readonly peak: number }[] = [
  { atS: 0, peak: 0.55 },
  { atS: 0.45, peak: 0.3 },
];
/** How long each pulse takes to fade out. */
export const FLASH_FADE_S = 0.3;

const FLASH_FADE_STEPS = Math.round(FLASH_FADE_S / SIM_STEP_S);
const PULSE_STEPS = FLASH_PULSES.map((p) => ({ at: Math.round(p.atS / SIM_STEP_S), peak: p.peak }));

/** Steps since the reel showed a jackpot, while still in the interval before round 1; null otherwise. */
function stepsSinceJackpot(machine: Readonly<Machine>): number | null {
  const { phase } = machine;
  if (phase.kind !== 'jackpot' || phase.open || phase.round !== 1) return null;
  return phase.elapsedSteps;
}

/** The reel panel celebrates from the moment it shows a jackpot until round 1 opens. */
export function celebrating(machine: Readonly<Machine>): boolean {
  return stepsSinceJackpot(machine) !== null;
}

/** Opacity of the screen flash, in [0, 1). 0 outside the celebration, and always 0 with reduced motion. */
export function flashLevel(machine: Readonly<Machine>, reducedMotion: boolean): number {
  const t = stepsSinceJackpot(machine);
  if (t === null || reducedMotion) return 0;
  let level = 0;
  for (const p of PULSE_STEPS) {
    const age = t - p.at;
    if (age >= 0 && age < FLASH_FADE_STEPS)
      level = Math.max(level, p.peak * (1 - age / FLASH_FADE_STEPS));
  }
  return level;
}

export interface Flash {
  update(machine: Readonly<Machine>): void;
}

/**
 * Drive the full-screen flash layer. `reducedMotion` is read every frame,
 * so turning the setting on mid-game stops the flash at once.
 */
export function createFlash(el: HTMLElement, reducedMotion: () => boolean): Flash {
  let shown = -1;
  return {
    update(machine) {
      // Two decimals is finer than the eye can tell, and keeps DOM writes to the frames that change.
      const level = Math.round(flashLevel(machine, reducedMotion()) * 100) / 100;
      if (level === shown) return;
      shown = level;
      el.style.opacity = String(level);
      el.dataset['level'] = String(level);
    },
  };
}
