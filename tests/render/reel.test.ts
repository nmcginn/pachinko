import { describe, expect, it } from 'vitest';
import { HOLD_LIMIT } from '../../src/game/lottery';
import {
  ROUND_INTERVAL_STEPS,
  SPIN_STEPS,
  createMachine,
  enterAttacker,
  enterStart,
  forceJackpot,
  stepMachine,
} from '../../src/game/machine';
import { REEL_STOP_AT, reelView } from '../../src/render/reel';
import { createRng } from '../../src/sim/rng';

const run = (m: ReturnType<typeof createMachine>, n: number) => {
  for (let i = 0; i < n; i++) stepMachine(m);
};

describe('reelView', () => {
  it('shows 000 and nothing held on a fresh machine', () => {
    expect(reelView(createMachine(createRng(1)))).toEqual({
      digits: [0, 0, 0],
      spinning: [false, false, false],
      phase: 'idle',
      status: '',
      holds: 0,
      round: 0,
      entries: 0,
    });
  });

  it('stops the reels left, then right, then centre, landing on the drawn result', () => {
    const m = createMachine(createRng(1), { jackpotProbability: 0 });
    enterStart(m);
    stepMachine(m);
    if (m.phase.kind !== 'spinning') throw new Error('not spinning');
    const result = m.phase.result.digits;
    const at = (fraction: number) => {
      const view = reelView({
        ...m,
        phase: { ...m.phase, elapsedSteps: Math.round(fraction * SPIN_STEPS) },
      } as typeof m);
      return view;
    };
    expect(REEL_STOP_AT).toEqual([0.5, 1, 0.75]);
    expect(at(0.1).spinning).toEqual([true, true, true]);
    expect(at(0.6).spinning).toEqual([false, true, true]);
    expect(at(0.6).digits[0]).toBe(result[0]);
    expect(at(0.8).spinning).toEqual([false, true, false]);
    expect(at(0.8).digits[2]).toBe(result[2]);
    // Spinning digits are always real symbols, and they change as the reel turns.
    const seen = new Set<number>();
    for (let f = 0; f < 0.5; f += 0.002) {
      const d = at(f).digits[1];
      expect(Number.isInteger(d) && d >= 0 && d <= 9).toBe(true);
      seen.add(d);
    }
    expect(seen.size).toBe(10);
    // Once the spin ends, the machine shows the result.
    run(m, SPIN_STEPS);
    expect(reelView(m)).toMatchObject({
      digits: result,
      phase: 'idle',
      spinning: [false, false, false],
    });
  });

  it('counts held spins, up to the limit', () => {
    const m = createMachine(createRng(1));
    for (let i = 0; i < HOLD_LIMIT + 2; i++) enterStart(m);
    expect(reelView(m).holds).toBe(HOLD_LIMIT);
  });

  it('announces the jackpot, then shows the round and its count', () => {
    const m = createMachine(createRng(1));
    forceJackpot(m);
    run(m, 1 + SPIN_STEPS);
    expect(reelView(m)).toMatchObject({ phase: 'interval', status: 'JACKPOT!', round: 1 });
    run(m, ROUND_INTERVAL_STEPS);
    enterAttacker(m);
    enterAttacker(m);
    expect(reelView(m)).toMatchObject({
      phase: 'round',
      status: 'ROUND 1/10 · IN 2/10',
      round: 1,
      entries: 2,
    });
    for (let i = 0; i < 8; i++) enterAttacker(m);
    stepMachine(m);
    expect(reelView(m)).toMatchObject({
      phase: 'interval',
      status: 'ROUND 2/10 next',
      round: 2,
      entries: 0,
    });
  });
});
