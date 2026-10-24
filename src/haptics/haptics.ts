// Haptics (M6): short buzzes on a phone for the moments that pay, from the
// same cues the sound plays (audio/cues.ts). The Vibration API is all there
// is: one motor, on/off patterns in milliseconds, and each call cancels the
// pattern before it. So this plays at most one pattern at a time and picks
// the strongest cue in each frame's batch.
//
// What buzzes, strongest first: the jackpot fanfare, an attacker entry, a
// start entry, a tulip entry, and a light tap as each reel stops. Rattles and
// reel ticks never do: a board with balls in flight rattles 40 times a
// second, and a motor running that often is noise, not feedback.
//
// Browsers block vibrate() until the page has had a user activation (and log
// a warning for each blocked call), so nothing buzzes before one: the same
// rule as the sound, for the same reason.

import type { ChimePocket, Cue } from '../audio/cues';

/** Vibration API pattern: on, off, on, ... in milliseconds. */
export type Pattern = readonly number[];

/** Three short pulses, then a long one: unmistakable in a pocket. 610 ms. */
export const FANFARE_PATTERN: Pattern = [70, 50, 70, 50, 70, 50, 250];
/** One pulse per paying entry, longer for the bigger payout (the attacker pays 15, the rest 3). */
export const CHIME_PATTERN: Record<ChimePocket, Pattern> = {
  attacker: [30],
  start: [20],
  tulip: [15],
};
/** A tap as each reel stops. Shorter than about 10 ms, some phone motors don't spin up at all. */
export const REEL_STOP_PATTERN: Pattern = [10];
/** Quiet time after a pattern ends before the next may start, so pulses stay distinct rather than blur. */
export const MIN_GAP_MS = 50;

/** How strongly each cue buzzes; 0 is never. The fanfare's rank is the highest and it alone may cut in. */
function rank(cue: Cue): number {
  switch (cue.kind) {
    case 'fanfare':
      return 5;
    case 'chime':
      return cue.pocket === 'attacker' ? 4 : cue.pocket === 'start' ? 3 : 2;
    case 'reel-stop':
      return 1;
    case 'rattle':
    case 'reel-tick':
      return 0;
  }
}

function patternOf(cue: Cue): Pattern | null {
  switch (cue.kind) {
    case 'fanfare':
      return FANFARE_PATTERN;
    case 'chime':
      return CHIME_PATTERN[cue.pocket];
    case 'reel-stop':
      return REEL_STOP_PATTERN;
    case 'rattle':
    case 'reel-tick':
      return null;
  }
}

/** The cue in a batch that should buzz, or null when none should. Ties go to the earliest. */
export function strongestCue(cues: readonly Cue[]): Cue | null {
  let best: Cue | null = null;
  for (const cue of cues) {
    if (rank(cue) > (best ? rank(best) : 0)) best = cue;
  }
  return best;
}

/** How long a pattern keeps the motor busy, ms. */
export function patternMs(pattern: Pattern): number {
  return pattern.reduce((sum, ms) => sum + ms, 0);
}

export interface HapticsHost {
  /** navigator.vibrate. Only called after activated() is true. */
  vibrate(pattern: number[]): boolean;
  /** A monotonic clock, ms. */
  now(): number;
  /** True once the page has had a user activation; vibrate() is blocked before. */
  activated(): boolean;
}

export interface Haptics {
  readonly enabled: boolean;
  /** Turning it off also stops a pattern in progress. */
  setEnabled(enabled: boolean): void;
  /** Buzz for this frame's cues. Dropped while disabled, before activation, or while a pattern plays. */
  play(cues: readonly Cue[]): void;
}

export function createHaptics(host: HapticsHost, options: { enabled?: boolean } = {}): Haptics {
  let enabled = options.enabled ?? true;
  /** No new pattern before this, except the fanfare. */
  let quietUntilMs = -Infinity;

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(value) {
      if (enabled && !value && host.activated()) host.vibrate([0]);
      enabled = value;
      quietUntilMs = -Infinity;
    },
    play(cues) {
      if (!enabled) return;
      const cue = strongestCue(cues);
      const pattern = cue && patternOf(cue);
      if (!cue || !pattern || !host.activated()) return;
      const nowMs = host.now();
      if (nowMs < quietUntilMs && cue.kind !== 'fanfare') return;
      if (host.vibrate([...pattern])) quietUntilMs = nowMs + patternMs(pattern) + MIN_GAP_MS;
    },
  };
}
