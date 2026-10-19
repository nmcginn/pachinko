import { describe, expect, it } from 'vitest';
import { HOLD_LIMIT } from '../../src/game/lottery';
import {
  type Machine,
  ROUNDS,
  ROUND_BALLS,
  ROUND_INTERVAL_STEPS,
  ROUND_TIMEOUT_STEPS,
  SPIN_STEPS,
  attackerOpen,
  createMachine,
  enterAttacker,
  enterStart,
  forceJackpot,
  stepMachine,
} from '../../src/game/machine';
import { createRng } from '../../src/sim/rng';
import { SIM_STEP_S } from '../../src/sim/world';

const run = (m: Machine, n: number) => {
  for (let i = 0; i < n; i++) stepMachine(m);
};
/** A machine whose every spin is a jackpot (p = 1) or a miss (p = 0). */
const always = (jackpotProbability: number) => createMachine(createRng(1), { jackpotProbability });

/** From the step a jackpot's reel stops: through the fanfare interval to round 1 open. */
const openFirstRound = (m: Machine) => run(m, ROUND_INTERVAL_STEPS);

describe('machine: timing constants', () => {
  it('counts sim steps: 5 s spins, 30 s rounds, 2 s between rounds', () => {
    expect(SPIN_STEPS * SIM_STEP_S).toBeCloseTo(5, 9);
    expect(ROUND_TIMEOUT_STEPS * SIM_STEP_S).toBeCloseTo(30, 9);
    expect(ROUND_INTERVAL_STEPS * SIM_STEP_S).toBeCloseTo(2, 9);
    expect([ROUNDS, ROUND_BALLS]).toEqual([10, 10]);
  });
});

describe('machine: spins and the hold queue', () => {
  it('sits idle with no entries', () => {
    const m = always(0);
    run(m, 10 * SPIN_STEPS);
    expect(m.phase.kind).toBe('idle');
    expect(m).toMatchObject({ spins: 0, jackpots: 0, holds: [] });
    expect(attackerOpen(m)).toBe(false);
  });

  it('spins a held entry on the next step, for exactly SPIN_STEPS, then shows its digits', () => {
    const m = always(0);
    expect(enterStart(m)).toBe(true);
    const result = m.holds[0];
    expect(m.holds).toHaveLength(1);
    stepMachine(m);
    expect(m.phase).toMatchObject({ kind: 'spinning', result, elapsedSteps: 0 });
    expect(m.holds).toHaveLength(0);
    run(m, SPIN_STEPS - 1);
    expect(m.phase.kind).toBe('spinning');
    stepMachine(m);
    expect(m.phase.kind).toBe('idle');
    expect(m.spins).toBe(1);
    expect(m.shown).toEqual(result?.digits);
  });

  it('holds up to 4 spins while the reel is busy; more entries overflow and never spin', () => {
    const m = always(0);
    enterStart(m);
    stepMachine(m); // Spinning: the first entry has left the queue.
    for (let i = 0; i < HOLD_LIMIT; i++) expect(enterStart(m)).toBe(true);
    expect(enterStart(m)).toBe(false);
    expect(enterStart(m)).toBe(false);
    expect(m.holds).toHaveLength(HOLD_LIMIT);
    expect(m.overflow).toBe(2);
    // The four held spins play back to back, oldest first, then nothing more.
    const held = [...m.holds];
    const played = [];
    for (let i = 0; i < 6 * SPIN_STEPS; i++) {
      const before = m.spins;
      stepMachine(m);
      if (m.spins > before) played.push(m.shown);
    }
    expect(played.slice(1)).toEqual(held.map((h) => h.digits));
    expect(m.spins).toBe(1 + HOLD_LIMIT);
    expect(m.phase.kind).toBe('idle');
  });

  it('frees a hold slot as each spin starts, not as it ends', () => {
    const m = always(0);
    for (let i = 0; i < HOLD_LIMIT; i++) enterStart(m);
    expect(enterStart(m)).toBe(false);
    stepMachine(m);
    expect(m.holds).toHaveLength(HOLD_LIMIT - 1);
    expect(enterStart(m)).toBe(true);
  });

  it('decides each spin at entry: later draws do not change a held result', () => {
    const a = createMachine(createRng(7), { jackpotProbability: 0.5 });
    const b = createMachine(createRng(7), { jackpotProbability: 0.5 });
    enterStart(a);
    enterStart(b);
    const first = a.holds[0];
    for (let i = 0; i < 3; i++) enterStart(b);
    expect(b.holds[0]).toEqual(first);
  });

  it('is deterministic: same seed and same entries, same spins', () => {
    const play = () => {
      const m = createMachine(createRng(42), { jackpotProbability: 0.3 });
      const shown = [];
      for (let step = 0; step < 40 * SPIN_STEPS; step++) {
        if (step % 3000 === 0) enterStart(m);
        if (step % 777 === 0) enterAttacker(m);
        stepMachine(m);
        shown.push(m.shown.join(''), m.phase.kind);
      }
      return { shown, jackpots: m.jackpots, spins: m.spins };
    };
    expect(play()).toEqual(play());
  });

  it('rejects a jackpot probability outside [0, 1]', () => {
    for (const p of [-1, 2, NaN]) {
      expect(() => createMachine(createRng(0), { jackpotProbability: p })).toThrow(RangeError);
    }
  });
});

describe('machine: jackpot rounds', () => {
  /** A machine whose reel has just stopped on a jackpot. */
  function jackpot(): Machine {
    const m = always(1);
    enterStart(m);
    run(m, 1 + SPIN_STEPS);
    expect(m.phase).toMatchObject({ kind: 'jackpot', round: 1, open: false });
    expect(m.jackpots).toBe(1);
    return m;
  }

  it('waits the interval with the gate closed, then opens round 1', () => {
    const m = jackpot();
    run(m, ROUND_INTERVAL_STEPS - 1);
    expect(attackerOpen(m)).toBe(false);
    stepMachine(m);
    expect(attackerOpen(m)).toBe(true);
    expect(m.phase).toMatchObject({ kind: 'jackpot', round: 1, open: true, entries: 0 });
  });

  it('ends a round on the step its 10th ball enters', () => {
    const m = jackpot();
    openFirstRound(m);
    for (let i = 0; i < ROUND_BALLS - 1; i++) {
      expect(enterAttacker(m)).toBe(true);
      stepMachine(m);
    }
    expect(m.phase).toMatchObject({ round: 1, open: true, entries: ROUND_BALLS - 1 });
    enterAttacker(m);
    stepMachine(m);
    expect(m.phase).toMatchObject({ kind: 'jackpot', round: 2, open: false, entries: 0 });
    expect(attackerOpen(m)).toBe(false);
    expect(m.roundsPlayed).toBe(1);
  });

  it('counts every ball entering in the step that fills the round', () => {
    const m = jackpot();
    openFirstRound(m);
    for (let i = 0; i < ROUND_BALLS + 2; i++) expect(enterAttacker(m)).toBe(true);
    expect(m.phase).toMatchObject({ entries: ROUND_BALLS + 2 });
    stepMachine(m);
    expect(m.phase).toMatchObject({ round: 2, open: false });
  });

  it('ends a round by timeout after exactly 30 s open, short of 10 balls', () => {
    const m = jackpot();
    openFirstRound(m);
    for (let i = 0; i < ROUND_BALLS - 1; i++) enterAttacker(m);
    run(m, ROUND_TIMEOUT_STEPS - 1);
    expect(m.phase).toMatchObject({ round: 1, open: true });
    stepMachine(m);
    expect(m.phase).toMatchObject({ round: 2, open: false });
  });

  it('ends a round by timeout with no balls at all', () => {
    const m = jackpot();
    openFirstRound(m);
    run(m, ROUND_TIMEOUT_STEPS);
    expect(m.phase).toMatchObject({ round: 2, open: false });
  });

  it('does not count attacker entries while the gate is closed', () => {
    const m = jackpot();
    // In the interval before round 1 (a ball swept in as the gate closed).
    expect(enterAttacker(m)).toBe(false);
    openFirstRound(m);
    expect(m.phase).toMatchObject({ entries: 0 });
    // And outside a jackpot.
    const idle = always(0);
    expect(enterAttacker(idle)).toBe(false);
    expect(idle.phase.kind).toBe('idle');
  });

  it('plays 10 rounds, ended by count or timeout in any mix, then returns to idle', () => {
    const m = jackpot();
    const rounds: number[] = [];
    let openSteps = 0;
    while (m.phase.kind === 'jackpot') {
      const { phase } = m;
      if (phase.open) {
        openSteps += 1;
        if (!rounds.includes(phase.round)) rounds.push(phase.round);
        // Odd rounds fill by count (a ball every second); even rounds time out.
        if (phase.round % 2 === 1 && phase.elapsedSteps % 2000 === 0) enterAttacker(m);
      }
      stepMachine(m);
      expect(openSteps).toBeLessThan(ROUNDS * ROUND_TIMEOUT_STEPS + 1);
    }
    expect(rounds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(m.roundsPlayed).toBe(ROUNDS);
    expect(m.phase.kind).toBe('idle');
    expect(attackerOpen(m)).toBe(false);
    // Five rounds of 10 s (the 10th ball at 9 s, closing on its step) and five of 30 s.
    expect(openSteps).toBe(5 * (9 * 2000 + 1) + 5 * ROUND_TIMEOUT_STEPS);
  });

  it('holds start entries during a jackpot and spins them once it ends', () => {
    // A jackpot while spins were already held, plus more entries during the rounds.
    const machine = createMachine(createRng(3), { jackpotProbability: 1 });
    enterStart(machine);
    stepMachine(machine);
    enterStart(machine);
    enterStart(machine);
    run(machine, SPIN_STEPS);
    expect(machine.phase).toMatchObject({ kind: 'jackpot' });
    expect(machine.holds).toHaveLength(2);
    // Entries in the rounds are held too, up to the limit.
    openFirstRound(machine);
    for (let i = 0; i < 5; i++) enterStart(machine);
    expect(machine.holds).toHaveLength(HOLD_LIMIT);
    expect(machine.overflow).toBe(3);
    // Holds don't spin during the jackpot.
    run(machine, ROUND_TIMEOUT_STEPS);
    expect(machine.holds).toHaveLength(HOLD_LIMIT);
    // Finish the remaining rounds by timeout; the first held spin starts on the step after.
    while (machine.phase.kind === 'jackpot') stepMachine(machine);
    expect(machine.holds).toHaveLength(HOLD_LIMIT - 1);
    expect(machine.phase.kind).toBe('spinning');
    expect(machine.jackpots).toBe(1);
  });

  it('a held jackpot after a jackpot starts a second sequence', () => {
    const m = always(1);
    enterStart(m);
    enterStart(m);
    while (m.jackpots < 2) stepMachine(m);
    expect(m.roundsPlayed).toBe(ROUNDS);
    expect(m.phase).toMatchObject({ kind: 'jackpot', round: 1, open: false });
  });
});

describe('machine: forced jackpot (debug key)', () => {
  it('from idle, spins a jackpot at once and plays all 10 rounds', () => {
    const m = always(0);
    expect(forceJackpot(m)).toBe(true);
    stepMachine(m);
    expect(m.phase).toMatchObject({ kind: 'spinning', result: { jackpot: true } });
    while (m.phase.kind !== 'idle') stepMachine(m);
    expect(m).toMatchObject({ jackpots: 1, roundsPlayed: ROUNDS, spins: 1 });
    const [a, b, c] = m.shown;
    expect(a === b && b === c).toBe(true);
  });

  it('while spinning, goes next, ahead of held spins, which keep their results', () => {
    const m = always(0);
    enterStart(m);
    stepMachine(m);
    enterStart(m);
    const held = m.holds[0];
    expect(forceJackpot(m)).toBe(true);
    expect(forceJackpot(m)).toBe(false); // Already forced.
    run(m, SPIN_STEPS);
    expect(m.phase).toMatchObject({ kind: 'spinning', result: { jackpot: true } });
    expect(m.holds).toEqual([held]);
  });

  it('is ignored during a jackpot', () => {
    const m = always(0);
    forceJackpot(m);
    run(m, 1 + SPIN_STEPS);
    expect(m.phase.kind).toBe('jackpot');
    expect(forceJackpot(m)).toBe(false);
    expect(m.forced).toBe(false);
  });
});
