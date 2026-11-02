// Ball counts. Takes a ball per launch, tallies where balls end up, pays
// out for the start pocket, and puts foul balls back in the tray (PLAN.md
// game rules).

import type { PocketKind } from '../sim/board';

/** The classic ¥1000 rental. */
export const STARTING_BALLS = 250;
/** Balls paid into the tray for each start-pocket (ヘソ) entry. */
export const START_POCKET_PAYOUT = 3;
/** Balls paid into the tray for each attacker entry, during a jackpot round or swept in as it closes. */
export const ATTACKER_PAYOUT = 15;
/** Balls paid into the tray for each tulip entry, open or closed: the start pocket's 3 (the maintainer's choice, M5). */
export const TULIP_PAYOUT = 3;

/** What a pocket pays into the tray. A foul's returned ball is not a payout. */
const PAYOUT: Record<PocketKind, number> = {
  start: START_POCKET_PAYOUT,
  attacker: ATTACKER_PAYOUT,
  tulip: TULIP_PAYOUT,
  out: 0,
  foul: 0,
};

export interface Economy {
  /** Balls this game started with (createEconomy, resetEconomy). */
  startingBalls: number;
  /** Balls in the tray, available to launch. */
  balls: number;
  /** Balls launched since the start. */
  launched: number;
  /** Balls that have ended in each kind of pocket. */
  readonly entries: Record<PocketKind, number>;
  /** Balls paid into the tray by pockets since the start. Foul returns are not payouts. */
  paidOut: number;
}

/** Throws unless n is a whole number ≥ 0. */
export function checkStartingBalls(n: number): void {
  if (!(Number.isInteger(n) && n >= 0)) {
    throw new RangeError(`starting balls must be a whole number ≥ 0, got ${n}`);
  }
}

export function createEconomy(startingBalls = STARTING_BALLS): Economy {
  checkStartingBalls(startingBalls);
  return {
    startingBalls,
    balls: startingBalls,
    launched: 0,
    entries: { start: 0, out: 0, foul: 0, attacker: 0, tulip: 0 },
    paidOut: 0,
  };
}

/** Take a ball from the tray for a launch. False, and nothing changes, if the tray is empty. */
export function takeBallForLaunch(economy: Economy): boolean {
  if (economy.balls <= 0) return false;
  economy.balls -= 1;
  economy.launched += 1;
  return true;
}

/**
 * Record a ball ending in a pocket. The start pocket pays
 * START_POCKET_PAYOUT into the tray, the attacker ATTACKER_PAYOUT and a
 * tulip TULIP_PAYOUT (spins and rounds are game/machine.ts's; a tulip's
 * wings are game/tulip.ts's). A foul ball never reached the
 * field, so it goes back to the tray, as on real machines. The out-hole
 * pays nothing.
 */
export function recordEntry(economy: Economy, kind: PocketKind): void {
  economy.entries[kind] += 1;
  economy.balls += PAYOUT[kind];
  economy.paidOut += PAYOUT[kind];
  if (kind === 'foul') economy.balls += 1;
}

/**
 * Put balls that were in play back in the tray, as if never launched: for
 * M7's board import, which takes them off the old board (game/table.ts
 * replaceBoard). They pay nothing and aren't entries.
 */
export function returnBalls(economy: Economy, count: number): void {
  if (!(Number.isInteger(count) && count >= 0 && count <= economy.launched)) {
    throw new RangeError(`can return 0 to ${economy.launched} balls, got ${count}`);
  }
  economy.balls += count;
  economy.launched -= count;
}

/**
 * Start the tray again (M8's new game): `startingBalls` in it, nothing
 * launched, no entries, nothing paid. In place, since the page holds the
 * table's economy. Throws, and changes nothing, unless `startingBalls` is a
 * whole number ≥ 0.
 */
export function resetEconomy(economy: Economy, startingBalls: number): void {
  checkStartingBalls(startingBalls);
  economy.startingBalls = startingBalls;
  economy.balls = startingBalls;
  economy.launched = 0;
  economy.paidOut = 0;
  for (const kind of Object.keys(economy.entries) as PocketKind[]) economy.entries[kind] = 0;
}
