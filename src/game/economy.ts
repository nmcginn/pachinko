// Ball counts. M2 only takes a ball per launch and tallies where balls end
// up; payouts (start pocket pays 3) arrive in M3. What a foul ball pays is an
// open question for the maintainer (PLAN.md), so fouls are tallied, not paid.

import type { PocketKind } from '../sim/board';

/** The classic ¥1000 rental. */
export const STARTING_BALLS = 250;

export interface Economy {
  /** Balls in the tray, available to launch. */
  balls: number;
  /** Balls launched since the start. */
  launched: number;
  /** Balls that have ended in each kind of pocket. */
  readonly entries: Record<PocketKind, number>;
}

export function createEconomy(startingBalls = STARTING_BALLS): Economy {
  if (!(Number.isInteger(startingBalls) && startingBalls >= 0)) {
    throw new RangeError(`starting balls must be a whole number ≥ 0, got ${startingBalls}`);
  }
  return { balls: startingBalls, launched: 0, entries: { start: 0, out: 0, foul: 0 } };
}

/** Take a ball from the tray for a launch. False, and nothing changes, if the tray is empty. */
export function takeBallForLaunch(economy: Economy): boolean {
  if (economy.balls <= 0) return false;
  economy.balls -= 1;
  economy.launched += 1;
  return true;
}

/** Record a ball ending in a pocket. */
export function recordEntry(economy: Economy, kind: PocketKind): void {
  economy.entries[kind] += 1;
}
