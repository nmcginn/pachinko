// LCD-style reel panel above the board: three digits, the hold indicators
// (保留), and the jackpot round. DOM, like the HUD. Reads the machine only;
// the spinning digits are presentation, derived from how far the spin has
// run, never from the lottery's rng. data-* attributes mirror the state so
// tests can read it without parsing text.

import type { Digits } from '../game/lottery';
import { HOLD_LIMIT, REEL_SYMBOLS } from '../game/lottery';
import { type Machine, ROUNDS, ROUND_BALLS, SPIN_STEPS } from '../game/machine';
import { celebrating } from './celebration';

/**
 * Height the reel panel takes at the top of the screen, CSS pixels. The
 * board is fitted below it. Keep in step with #reel in style.css.
 */
export const REEL_BAND_PX = 84;

/** Fraction of the spin at which each reel stops: left, then right, then centre, as on real machines. */
export const REEL_STOP_AT: readonly [number, number, number] = [0.5, 1, 0.75];
/** Sim steps per symbol while a reel spins: 25 symbols a second. */
export const STEPS_PER_SYMBOL = 80;

export interface ReelView {
  readonly digits: Digits;
  /** Per reel, whether it is still spinning. */
  readonly spinning: readonly [boolean, boolean, boolean];
  /** 'idle', 'spinning', 'interval' (a jackpot between rounds, gate closed) or 'round' (gate open). */
  readonly phase: 'idle' | 'spinning' | 'interval' | 'round';
  /** Status line under the digits. */
  readonly status: string;
  readonly holds: number;
  /** Jackpot round, or 0 outside a jackpot. */
  readonly round: number;
  /** Balls counted into the open round. */
  readonly entries: number;
  /** The reel just showed a jackpot: the panel celebrates until round 1 opens. */
  readonly celebrating: boolean;
}

/** What the panel shows for a machine state. Pure. */
export function reelView(machine: Readonly<Machine>): ReelView {
  const { phase } = machine;
  const holds = machine.holds.length;
  if (phase.kind === 'spinning') {
    const progress = phase.elapsedSteps / SPIN_STEPS;
    const spinning = REEL_STOP_AT.map((at) => progress < at) as [boolean, boolean, boolean];
    const digits = phase.result.digits.map((d, i) =>
      spinning[i]
        ? (Math.floor(phase.elapsedSteps / STEPS_PER_SYMBOL) + 3 * i + d) % REEL_SYMBOLS
        : d,
    ) as [number, number, number];
    return {
      digits,
      spinning,
      phase: 'spinning',
      status: '',
      holds,
      round: 0,
      entries: 0,
      celebrating: false,
    };
  }
  const stopped = [false, false, false] as const;
  if (phase.kind === 'jackpot') {
    const status = phase.open
      ? `ROUND ${phase.round}/${ROUNDS} · IN ${phase.entries}/${ROUND_BALLS}`
      : phase.round === 1
        ? 'JACKPOT!'
        : `ROUND ${phase.round}/${ROUNDS} next`;
    return {
      digits: machine.shown,
      spinning: stopped,
      phase: phase.open ? 'round' : 'interval',
      status,
      holds,
      round: phase.round,
      entries: phase.open ? phase.entries : 0,
      celebrating: celebrating(machine),
    };
  }
  return {
    digits: machine.shown,
    spinning: stopped,
    phase: 'idle',
    status: '',
    holds,
    round: 0,
    entries: 0,
    celebrating: false,
  };
}

export interface ReelElements {
  /** The panel. Carries the data-* attributes. */
  readonly panel: HTMLElement;
  /** Three digit cells. */
  readonly digits: readonly HTMLElement[];
  /** HOLD_LIMIT hold lamps. */
  readonly holds: readonly HTMLElement[];
  readonly status: HTMLElement;
}

export interface Reel {
  update(machine: Readonly<Machine>): void;
}

export function createReel(els: ReelElements): Reel {
  if (els.digits.length !== 3 || els.holds.length !== HOLD_LIMIT) {
    throw new Error(`reel needs 3 digit cells and ${HOLD_LIMIT} hold lamps`);
  }
  // Only touch the DOM when something changed.
  const shown = new Map<string, string>();
  const set = (key: string, value: string, apply: () => void): void => {
    if (shown.get(key) === value) return;
    shown.set(key, value);
    apply();
  };

  return {
    update(machine) {
      const v = reelView(machine);
      const { panel } = els;
      v.digits.forEach((d, i) => {
        const cell = els.digits[i] as HTMLElement;
        set(`d${i}`, String(d), () => (cell.textContent = String(d)));
        set(`s${i}`, String(v.spinning[i]), () => cell.classList.toggle('spinning', v.spinning[i]));
      });
      els.holds.forEach((lamp, i) => {
        set(`h${i}`, String(i < v.holds), () => lamp.classList.toggle('lit', i < v.holds));
      });
      set('status', v.status, () => (els.status.textContent = v.status));
      set('phase', v.phase, () => {
        panel.dataset['phase'] = v.phase;
        panel.classList.toggle('jackpot', v.phase === 'round' || v.phase === 'interval');
      });
      set('celebrating', String(v.celebrating), () => {
        panel.classList.toggle('celebrate', v.celebrating);
        panel.dataset['celebrating'] = String(v.celebrating);
      });
      // While spinning these show the stopped result only once all three reels stop.
      const digits = v.phase === 'spinning' ? '' : v.digits.join('');
      set('digits', digits, () => (panel.dataset['digits'] = digits));
      set('holds', String(v.holds), () => (panel.dataset['holds'] = String(v.holds)));
      set('round', String(v.round), () => (panel.dataset['round'] = String(v.round)));
      set('entries', String(v.entries), () => (panel.dataset['entries'] = String(v.entries)));
      set('spins', String(machine.spins), () => (panel.dataset['spins'] = String(machine.spins)));
      set('jackpots', String(machine.jackpots), () => {
        panel.dataset['jackpots'] = String(machine.jackpots);
      });
      set('roundsPlayed', String(machine.roundsPlayed), () => {
        panel.dataset['roundsPlayed'] = String(machine.roundsPlayed);
      });
    },
  };
}
