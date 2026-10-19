// The machine's state: the reel, the hold queue (保留), and jackpot rounds.
// Pure. Time counts sim steps, never wall time: the table calls stepMachine
// once per sim step, after reporting that step's pocket entries.
//
//   idle ──(a held or forced spin)──▶ spinning ──(miss)──▶ idle, or the next spin
//                                        │
//                                     (jackpot)
//                                        ▼
//   ┌──▶ interval (gate closed) ──▶ round open (gate open) ──(ROUND_BALLS entries
//   │                                        │                or ROUND_TIMEOUT_S)
//   └────────────(rounds 1 … ROUNDS − 1)─────┘──(round ROUNDS)──▶ idle
//
// Start-pocket entries keep filling the hold queue during spins and jackpot
// rounds; held spins play once the reel is free again. Payouts are the
// economy's (game/economy.ts); this file only decides spins and rounds.

import type { Rng } from '../sim/rng';
import { SIM_STEP_S } from '../sim/world';
import {
  type Digits,
  type SpinResult,
  DEFAULT_JACKPOT_PROBABILITY,
  HOLD_LIMIT,
  checkProbability,
  drawSpin,
  jackpotSpin,
} from './lottery';

/** How long the reel spins before showing its result. Presentation, but it paces the hold queue. */
export const SPIN_S = 5;
/** Jackpot rounds (ラウンド) per jackpot. */
export const ROUNDS = 10;
/** A round closes once this many balls have entered the attacker... */
export const ROUND_BALLS = 10;
/** ...or after this long open, whichever comes first. */
export const ROUND_TIMEOUT_S = 30;
/** Gate closed before each round, including the first (the jackpot fanfare). */
export const ROUND_INTERVAL_S = 2;

const steps = (s: number) => Math.round(s / SIM_STEP_S);
export const SPIN_STEPS = steps(SPIN_S);
export const ROUND_TIMEOUT_STEPS = steps(ROUND_TIMEOUT_S);
export const ROUND_INTERVAL_STEPS = steps(ROUND_INTERVAL_S);

export type Phase =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'spinning';
      readonly result: SpinResult;
      /** Sim steps since the spin started, in [0, SPIN_STEPS). */
      readonly elapsedSteps: number;
    }
  | {
      readonly kind: 'jackpot';
      /** Current round, 1 … ROUNDS. During an interval, the round about to open. */
      readonly round: number;
      /** True while the round is open (the attacker gate with it); false in the interval before it. */
      readonly open: boolean;
      /** Balls counted into this round. */
      readonly entries: number;
      /** Sim steps since this round or interval began. */
      readonly elapsedSteps: number;
    };

export interface Machine {
  phase: Phase;
  /** Spins waiting their turn, oldest first. At most HOLD_LIMIT. */
  readonly holds: SpinResult[];
  /** The forced-jackpot debug key was pressed: the next spin is a jackpot, ahead of the holds. */
  forced: boolean;
  /** Digits on the reel when it isn't spinning: the last result. */
  shown: Digits;
  /** Spins played to the end. */
  spins: number;
  /** Jackpots hit (counted when the reel shows one). */
  jackpots: number;
  /** Start-pocket entries that found the hold queue full. They paid, but never spin. */
  overflow: number;
  /** Rounds finished, over all jackpots. */
  roundsPlayed: number;
  readonly jackpotProbability: number;
  /** Draws every spin. Nothing else may draw from it, or results would shift. */
  readonly rng: Rng;
}

export interface MachineOptions {
  /** Default DEFAULT_JACKPOT_PROBABILITY (1/99). */
  readonly jackpotProbability?: number;
}

const IDLE: Phase = Object.freeze({ kind: 'idle' });

export function createMachine(rng: Rng, options: MachineOptions = {}): Machine {
  const jackpotProbability = options.jackpotProbability ?? DEFAULT_JACKPOT_PROBABILITY;
  checkProbability(jackpotProbability);
  return {
    phase: IDLE,
    holds: [],
    forced: false,
    shown: [0, 0, 0],
    spins: 0,
    jackpots: 0,
    overflow: 0,
    roundsPlayed: 0,
    jackpotProbability,
    rng,
  };
}

/**
 * A ball entered the start pocket. Its spin is drawn now (the lottery
 * decides at entry) and held, unless HOLD_LIMIT spins are already held.
 * Returns whether it was held.
 */
export function enterStart(machine: Machine): boolean {
  if (machine.holds.length >= HOLD_LIMIT) {
    machine.overflow += 1;
    return false;
  }
  machine.holds.push(drawSpin(machine.rng, machine.jackpotProbability));
  return true;
}

/**
 * A ball entered the attacker. It counts toward the round if one is open.
 * One taken as the gate closed (or any other time) still pays, but counts
 * for nothing. Returns whether it counted.
 */
export function enterAttacker(machine: Machine): boolean {
  const { phase } = machine;
  if (phase.kind !== 'jackpot' || !phase.open) return false;
  machine.phase = { ...phase, entries: phase.entries + 1 };
  return true;
}

/**
 * Debug: make the next spin a jackpot. It plays as soon as the reel is free,
 * ahead of any held spins, which keep their own results. Ignored (false)
 * during a jackpot or when one is already forced.
 */
export function forceJackpot(machine: Machine): boolean {
  if (machine.phase.kind === 'jackpot' || machine.forced) return false;
  machine.forced = true;
  return true;
}

/** Whether the attacker gate should be open: only while a round is. */
export function attackerOpen(machine: Readonly<Machine>): boolean {
  return machine.phase.kind === 'jackpot' && machine.phase.open;
}

/** Advance one sim step. Call after reporting the step's entries, so a round closes on the step its last ball enters. */
export function stepMachine(machine: Machine): void {
  const { phase } = machine;
  switch (phase.kind) {
    case 'idle':
      startNextSpin(machine);
      return;
    case 'spinning': {
      const elapsedSteps = phase.elapsedSteps + 1;
      if (elapsedSteps < SPIN_STEPS) {
        machine.phase = { ...phase, elapsedSteps };
        return;
      }
      machine.shown = phase.result.digits;
      machine.spins += 1;
      if (phase.result.jackpot) {
        machine.jackpots += 1;
        machine.phase = { kind: 'jackpot', round: 1, open: false, entries: 0, elapsedSteps: 0 };
      } else {
        machine.phase = IDLE;
        startNextSpin(machine);
      }
      return;
    }
    case 'jackpot': {
      const elapsedSteps = phase.elapsedSteps + 1;
      if (!phase.open) {
        machine.phase =
          elapsedSteps < ROUND_INTERVAL_STEPS
            ? { ...phase, elapsedSteps }
            : { ...phase, open: true, entries: 0, elapsedSteps: 0 };
        return;
      }
      if (phase.entries < ROUND_BALLS && elapsedSteps < ROUND_TIMEOUT_STEPS) {
        machine.phase = { ...phase, elapsedSteps };
        return;
      }
      machine.roundsPlayed += 1;
      if (phase.round < ROUNDS) {
        machine.phase = {
          kind: 'jackpot',
          round: phase.round + 1,
          open: false,
          entries: 0,
          elapsedSteps: 0,
        };
      } else {
        machine.phase = IDLE;
        startNextSpin(machine);
      }
      return;
    }
  }
}

/** From idle: start the forced jackpot if there is one, else the oldest held spin, else stay idle. */
function startNextSpin(machine: Machine): void {
  let result: SpinResult | undefined;
  if (machine.forced) {
    machine.forced = false;
    result = jackpotSpin(machine.rng);
  } else {
    result = machine.holds.shift();
  }
  if (result) machine.phase = { kind: 'spinning', result, elapsedSteps: 0 };
}
