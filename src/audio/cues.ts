// Sound cues: what just happened on the table that should make a sound.
// Pure and DOM-free, so it is unit-tested under Node; sound.ts turns cues
// into WebAudio. Like rendering, it reads the table and never changes it.
//
// The frame loop calls collectCues once per sim step, right after
// stepTable, and drains the queue once per frame. Time counts sim steps.

import type { Table } from '../game/table';
import { SPIN_STEPS } from '../game/machine';
import { REEL_STOP_AT, STEPS_PER_SYMBOL } from '../render/reel';
import { SIM_STEP_S } from '../sim/world';

/** Pockets that chime. The out-hole and the foul pocket stay quiet. */
export type ChimePocket = 'start' | 'tulip' | 'attacker';

export type Cue =
  /** A ball struck a nail, a rail, or another ball. */
  | { readonly kind: 'rattle'; readonly speedMps: number }
  /** A ball entered a paying pocket. */
  | { readonly kind: 'chime'; readonly pocket: ChimePocket }
  /** The spinning reels moved on a symbol. */
  | { readonly kind: 'reel-tick' }
  /** One reel stopped: three a spin. */
  | { readonly kind: 'reel-stop' }
  /** The reel showed a jackpot. */
  | { readonly kind: 'fanfare' };

/**
 * Impacts slower than this make no rattle. Resting and rolling contacts
 * approach at well under 0.05 m/s; a ball dropping between nails strikes at
 * 0.2 to 2 m/s. On the classic board at the best power, about 37 impacts a
 * second clear it with 2 or 3 balls in flight.
 */
export const RATTLE_MIN_SPEED_MPS = 0.2;
/** At most one rattle per this long, so a crowded board rattles rather than roars: 40 a second. */
export const RATTLE_INTERVAL_S = 0.025;
export const RATTLE_INTERVAL_STEPS = Math.round(RATTLE_INTERVAL_S / SIM_STEP_S);
/**
 * Most cues held between drains. The loop drains every frame, so this only
 * bites if nothing drains for a long while; the newest are dropped, so a
 * late drain never plays a burst of stale sound.
 */
export const MAX_PENDING_CUES = 64;

/** Steps into a spin at which each reel short of the last stops (reelView's rule: progress ≥ stop point). */
const MID_STOP_STEPS = REEL_STOP_AT.filter((at) => at < 1).map((at) => Math.ceil(at * SPIN_STEPS));

export interface CueTracker {
  /** Cues since the last drain, oldest first. */
  readonly pending: Cue[];
  /** Steps since the last rattle; starts ready. */
  stepsSinceRattle: number;
  /** Entries already chimed for, per pocket. */
  readonly chimed: Record<ChimePocket, number>;
  /** Spins and jackpots already sounded. */
  spins: number;
  jackpots: number;
}

/** A tracker for a table: what the table has already done makes no sound. */
export function createCueTracker(table: Readonly<Table>): CueTracker {
  const { entries } = table.economy;
  return {
    pending: [],
    stepsSinceRattle: RATTLE_INTERVAL_STEPS,
    chimed: { start: entries.start, tulip: entries.tulip, attacker: entries.attacker },
    spins: table.machine.spins,
    jackpots: table.machine.jackpots,
  };
}

/** Queue the cues for the step the table just took. */
export function collectCues(tracker: CueTracker, table: Readonly<Table>): void {
  const { pending, chimed } = tracker;
  const push = (cue: Cue): void => {
    if (pending.length < MAX_PENDING_CUES) pending.push(cue);
  };

  tracker.stepsSinceRattle += 1;
  const speedMps = table.world.impactSpeedMps;
  if (speedMps >= RATTLE_MIN_SPEED_MPS && tracker.stepsSinceRattle >= RATTLE_INTERVAL_STEPS) {
    tracker.stepsSinceRattle = 0;
    push({ kind: 'rattle', speedMps });
  }

  const { entries } = table.economy;
  for (const pocket of ['start', 'tulip', 'attacker'] as const) {
    for (; chimed[pocket] < entries[pocket]; chimed[pocket] += 1) push({ kind: 'chime', pocket });
  }

  const { machine } = table;
  // A spin that just ended stopped its last reel; a jackpot it showed sounds after.
  for (; tracker.spins < machine.spins; tracker.spins += 1) push({ kind: 'reel-stop' });
  for (; tracker.jackpots < machine.jackpots; tracker.jackpots += 1) push({ kind: 'fanfare' });
  const { phase } = machine;
  if (phase.kind === 'spinning' && phase.elapsedSteps > 0) {
    if (MID_STOP_STEPS.includes(phase.elapsedSteps)) push({ kind: 'reel-stop' });
    else if (phase.elapsedSteps % STEPS_PER_SYMBOL === 0) push({ kind: 'reel-tick' });
  }
}

/** Take the queued cues, leaving the queue empty. */
export function drainCues(tracker: CueTracker): Cue[] {
  return tracker.pending.splice(0);
}
