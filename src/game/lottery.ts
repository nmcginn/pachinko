// Jackpot draw and the hold queue's size (保留). PLAN.md game rules: a
// start-pocket entry draws its spin's result at once, from the seeded rng;
// the reel animation only shows it later.

import type { Rng } from '../sim/rng';

/** Default jackpot probability per spin: 1/99, so a session actually sees one. */
export const DEFAULT_JACKPOT_PROBABILITY = 1 / 99;
/** Spins held (保留) while the reel is busy. Entries beyond this pay but don't spin. */
export const HOLD_LIMIT = 4;
/** Symbols on each reel: the digits 0–9. */
export const REEL_SYMBOLS = 10;

export type Digits = readonly [number, number, number];

/** One spin's result, decided at entry. A jackpot shows three matching digits; a miss never does. */
export interface SpinResult {
  readonly jackpot: boolean;
  readonly digits: Digits;
}

/** Throws unless p is a probability in [0, 1]. */
export function checkProbability(p: number): void {
  if (!(p >= 0 && p <= 1)) throw new RangeError(`jackpot probability must be in [0, 1], got ${p}`);
}

const symbol = (rng: Rng): number => Math.floor(rng.next() * REEL_SYMBOLS);

/** A jackpot: three of one digit, the digit uniform. */
export function jackpotSpin(rng: Rng): SpinResult {
  const d = symbol(rng);
  return { jackpot: true, digits: [d, d, d] };
}

/**
 * Draw one spin: a jackpot with probability `jackpotProbability` (one
 * uniform draw against it, so the odds are exact), otherwise a miss whose
 * digits are uniform over the 990 combinations that don't all match.
 */
export function drawSpin(rng: Rng, jackpotProbability: number): SpinResult {
  checkProbability(jackpotProbability);
  if (rng.next() < jackpotProbability) return jackpotSpin(rng);
  // Rejection sampling: redraw the 1 in 100 triples that match.
  for (;;) {
    const digits = [symbol(rng), symbol(rng), symbol(rng)] as const;
    if (!(digits[0] === digits[1] && digits[1] === digits[2])) return { jackpot: false, digits };
  }
}
