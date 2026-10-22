// The jackpot celebration (M6): when the screen flashes and the reel
// panel celebrates, timed from the machine.

import { describe, expect, it } from 'vitest';
import {
  ROUNDS,
  ROUND_INTERVAL_STEPS,
  SPIN_STEPS,
  createMachine,
  enterStart,
  forceJackpot,
  stepMachine,
} from '../../src/game/machine';
import {
  FLASH_FADE_S,
  FLASH_PULSES,
  celebrating,
  createFlash,
  flashLevel,
} from '../../src/render/celebration';
import { createRng } from '../../src/sim/rng';
import { SIM_STEP_S } from '../../src/sim/world';

type M = ReturnType<typeof createMachine>;
const run = (m: M, n: number) => {
  for (let i = 0; i < n; i++) stepMachine(m);
};
const steps = (s: number) => Math.round(s / SIM_STEP_S);

/** A machine on the step its reel shows a forced jackpot. */
function atJackpot(): M {
  const m = createMachine(createRng(1));
  forceJackpot(m);
  run(m, 1 + SPIN_STEPS);
  if (m.phase.kind !== 'jackpot' || m.phase.elapsedSteps !== 0) throw new Error('no jackpot');
  return m;
}

/** Flash level on every step from the jackpot until round 1 opens. */
function flashTrace(m: M, reducedMotion = false): number[] {
  const trace: number[] = [];
  while (celebrating(m)) {
    trace.push(flashLevel(m, reducedMotion));
    stepMachine(m);
  }
  return trace;
}

describe('celebrating', () => {
  it('is off on a fresh machine, through ordinary spins, and while idle', () => {
    const m = createMachine(createRng(1), { jackpotProbability: 0 });
    expect(celebrating(m)).toBe(false);
    enterStart(m);
    for (let i = 0; i < SPIN_STEPS + 2; i++) {
      stepMachine(m);
      expect(celebrating(m)).toBe(false);
      expect(flashLevel(m, false)).toBe(0);
    }
  });

  it('runs from the step the reel shows a jackpot until round 1 opens, and not in later intervals', () => {
    const m = atJackpot();
    expect(flashTrace(m)).toHaveLength(ROUND_INTERVAL_STEPS);
    expect(m.phase).toMatchObject({ kind: 'jackpot', round: 1, open: true });
    // Play the rest of the jackpot by timeout: no interval but the first celebrates.
    let seen = 0;
    while (m.phase.kind === 'jackpot') {
      if (celebrating(m)) seen += 1;
      stepMachine(m);
    }
    expect(seen).toBe(0);
    expect(m.roundsPlayed).toBe(ROUNDS);
  });

  it('celebrates every jackpot, not just the first', () => {
    const m = atJackpot();
    while (m.phase.kind === 'jackpot') stepMachine(m);
    forceJackpot(m);
    run(m, 1 + SPIN_STEPS);
    expect(celebrating(m)).toBe(true);
    expect(m.jackpots).toBe(2);
  });
});

describe('flashLevel', () => {
  it('pulses at each start time, fading over FLASH_FADE_S, and is dark between and after', () => {
    const trace = flashTrace(atJackpot());
    const [first, second] = FLASH_PULSES;
    if (!first || !second) throw new Error('expected two pulses');
    expect(trace[steps(first.atS)]).toBe(first.peak);
    expect(trace[steps(second.atS)]).toBe(second.peak);
    expect(trace[steps(first.atS + FLASH_FADE_S / 2)]).toBeCloseTo(first.peak / 2, 9);
    // Dark between the pulses, and from the end of the last one until round 1.
    expect(trace[steps(first.atS + FLASH_FADE_S)]).toBe(0);
    expect(trace.slice(steps(second.atS + FLASH_FADE_S))).toEqual(
      new Array(trace.length - steps(second.atS + FLASH_FADE_S)).fill(0),
    );
    expect(Math.max(...trace)).toBeLessThan(1);
    expect(Math.min(...trace)).toBe(0);
  });

  it('flashes at most three times in any second (WCAG 2.3.1)', () => {
    // A flash starts wherever the level rises after falling or from dark.
    const trace = flashTrace(atJackpot());
    const starts = trace.flatMap((v, i) => (v > 0 && v > (trace[i - 1] ?? 0) ? [i] : []));
    expect(starts).toHaveLength(FLASH_PULSES.length);
    for (const s of starts) {
      expect(starts.filter((t) => t >= s && t < s + steps(1)).length).toBeLessThanOrEqual(3);
    }
  });

  it('never flashes with reduced motion, though the panel still celebrates', () => {
    const m = atJackpot();
    expect(celebrating(m)).toBe(true);
    const trace = flashTrace(m, true);
    expect(trace).toHaveLength(ROUND_INTERVAL_STEPS);
    expect(trace.every((v) => v === 0)).toBe(true);
  });
});

describe('createFlash', () => {
  /** Just enough of an element for the flash layer. */
  const fakeEl = () => {
    let writes = 0;
    const style = { opacity: '' };
    const el = {
      dataset: {} as Record<string, string>,
      style: new Proxy(style, {
        set(target, key, value) {
          writes += 1;
          return Reflect.set(target, key, value);
        },
      }),
    };
    return { el, style, writes: () => writes };
  };

  it('writes the level only when it changes, rounded to two places', () => {
    const { el, style, writes } = fakeEl();
    const flash = createFlash(el as unknown as HTMLElement, () => false);
    const m = createMachine(createRng(1));
    flash.update(m);
    flash.update(m);
    expect(style.opacity).toBe('0');
    expect(writes()).toBe(1);
    const j = atJackpot();
    flash.update(j);
    expect(el.dataset['level']).toBe(String(FLASH_PULSES[0]?.peak));
    stepMachine(j);
    flash.update(j);
    // One step's fade is far below a hundredth: no write.
    expect(writes()).toBe(2);
  });

  it('goes dark at once when reduced motion is turned on mid-flash', () => {
    const { el, style } = fakeEl();
    let reduce = false;
    const flash = createFlash(el as unknown as HTMLElement, () => reduce);
    const j = atJackpot();
    flash.update(j);
    expect(Number(style.opacity)).toBeGreaterThan(0);
    reduce = true;
    flash.update(j);
    expect(style.opacity).toBe('0');
  });
});
