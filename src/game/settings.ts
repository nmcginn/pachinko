// Player settings (M8): the jackpot odds, the balls a new game starts with,
// and the sound's volume. Pure: the choices on offer, their defaults, and
// reading back a saved copy that may be stale, partial, or tampered with.
// input/settings.ts keeps them in localStorage and wires the panel.

import { STARTING_BALLS } from './economy';
import { DEFAULT_JACKPOT_PROBABILITY } from './lottery';

/**
 * Jackpot odds on offer, as "1 in N" per spin. 1/99 is the game's default
 * (PLAN.md: so a session actually sees one) and a real 甘デジ ("sweet
 * deji") spec; 1/199 and 1/319 are the common light-middle and middle specs
 * on real machines. A short, fixed list rather than a free number: these
 * are the odds players of the real thing know, and none of them can turn
 * the game into a jackpot every spin.
 */
export const JACKPOT_ODDS = [99, 199, 319] as const;
export type JackpotOdds = (typeof JACKPOT_ODDS)[number];

/** Yen per ball: the ¥1000 rental is 250 balls (PLAN.md game rules). */
export const YEN_PER_BALL = 4;
/** Starting balls on offer: ¥500, ¥1000 (the default), ¥2000 and ¥5000 of balls. */
export const STARTING_BALL_OPTIONS = [125, 250, 500, 1250] as const;
export type StartingBalls = (typeof STARTING_BALL_OPTIONS)[number];

/** Volume steps: 0 to 1 in tenths. 0 is silent, 1 is the level M6 set (audio/sound.ts MASTER_GAIN). */
export const VOLUME_STEP = 0.1;

export interface Settings {
  /** Jackpot odds, 1 in this many spins. */
  readonly jackpotOdds: JackpotOdds;
  /** Balls in the tray when a new game starts. */
  readonly startingBalls: StartingBalls;
  /** Sound volume, 0 to 1 in VOLUME_STEP steps, scaling the master level. Independent of mute. */
  readonly volume: number;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  jackpotOdds: 99,
  startingBalls: STARTING_BALLS as StartingBalls,
  volume: 1,
});

/** The jackpot probability per spin for a setting: exactly the lottery's default at 1 in 99. */
export function jackpotProbability(odds: JackpotOdds): number {
  return odds === 99 ? DEFAULT_JACKPOT_PROBABILITY : 1 / odds;
}

export function isJackpotOdds(n: unknown): n is JackpotOdds {
  return (JACKPOT_ODDS as readonly unknown[]).includes(n);
}

export function isStartingBalls(n: unknown): n is StartingBalls {
  return (STARTING_BALL_OPTIONS as readonly unknown[]).includes(n);
}

/** A volume rounded to the nearest step and clamped to [0, 1]; null for anything that isn't a finite number. */
export function snapVolume(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const steps = Math.round(Math.min(1, Math.max(0, v)) / VOLUME_STEP);
  // Rounded again so 0.30000000000000004 reads back as 0.3.
  return Math.round(steps * VOLUME_STEP * 10) / 10;
}

/**
 * Settings from a saved copy: each field that is one of the choices on
 * offer is kept, and anything else (missing, out of range, the wrong type,
 * or the whole thing not an object) falls back to its default. Never
 * throws, so a corrupt save can't stop the game loading.
 */
export function parseSettings(raw: unknown): Settings {
  const r: Record<string, unknown> =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    jackpotOdds: isJackpotOdds(r['jackpotOdds']) ? r['jackpotOdds'] : DEFAULT_SETTINGS.jackpotOdds,
    startingBalls: isStartingBalls(r['startingBalls'])
      ? r['startingBalls']
      : DEFAULT_SETTINGS.startingBalls,
    volume: snapVolume(r['volume']) ?? DEFAULT_SETTINGS.volume,
  };
}

/** "125 balls (¥500)". */
export function startingBallsLabel(balls: StartingBalls): string {
  return `${balls.toLocaleString('en-US')} balls (¥${(balls * YEN_PER_BALL).toLocaleString('en-US')})`;
}
