import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JACKPOT_PROBABILITY,
  HOLD_LIMIT,
  REEL_SYMBOLS,
  drawSpin,
  jackpotSpin,
} from '../../src/game/lottery';
import { createRng } from '../../src/sim/rng';

const allMatch = (d: readonly number[]) => d[0] === d[1] && d[1] === d[2];

describe('lottery', () => {
  it('has the rules PLAN.md sets: 1/99 jackpots, 4 holds, digits 0–9', () => {
    expect(DEFAULT_JACKPOT_PROBABILITY).toBe(1 / 99);
    expect(HOLD_LIMIT).toBe(4);
    expect(REEL_SYMBOLS).toBe(10);
  });

  it('shows three matching digits on a jackpot and never on a miss', () => {
    const rng = createRng(1);
    for (let i = 0; i < 5000; i++) {
      const spin = drawSpin(rng, 0.2);
      expect(allMatch(spin.digits)).toBe(spin.jackpot);
      for (const d of spin.digits) expect(Number.isInteger(d) && d >= 0 && d <= 9).toBe(true);
    }
  });

  it('hits at the configured rate', () => {
    // 200k draws at 1/99: about 2020 jackpots, s.d. 45. Allow 4.5 s.d.
    const rng = createRng(2);
    const n = 200_000;
    let hits = 0;
    for (let i = 0; i < n; i++) if (drawSpin(rng, DEFAULT_JACKPOT_PROBABILITY).jackpot) hits += 1;
    const expected = n / 99;
    expect(Math.abs(hits - expected)).toBeLessThan(4.5 * Math.sqrt(expected));
  });

  it('never hits at probability 0 and always hits at 1', () => {
    const rng = createRng(3);
    for (let i = 0; i < 1000; i++) {
      expect(drawSpin(rng, 0).jackpot).toBe(false);
      expect(drawSpin(rng, 1).jackpot).toBe(true);
    }
  });

  it('spreads miss digits over every symbol, on every reel', () => {
    const rng = createRng(4);
    const counts = [0, 1, 2].map(() => new Array<number>(REEL_SYMBOLS).fill(0));
    for (let i = 0; i < 30_000; i++) {
      drawSpin(rng, 0).digits.forEach((d, reel) => ((counts[reel] as number[])[d] as number)++);
    }
    // 3000 expected per cell; a cell under 2700 or over 3300 is 5+ s.d. out.
    for (const reel of counts) for (const c of reel) expect(c).toBeGreaterThan(2700);
    for (const reel of counts) for (const c of reel) expect(c).toBeLessThan(3300);
  });

  it('draws the same spins from the same seed', () => {
    const a = createRng(9);
    const b = createRng(9);
    for (let i = 0; i < 100; i++) expect(drawSpin(a, 0.1)).toEqual(drawSpin(b, 0.1));
  });

  it('rejects a probability outside [0, 1]', () => {
    const rng = createRng(0);
    for (const p of [-0.1, 1.5, NaN]) expect(() => drawSpin(rng, p)).toThrow(RangeError);
  });

  it('forces a jackpot of any digit', () => {
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const spin = jackpotSpin(rng);
      expect(spin.jackpot).toBe(true);
      expect(allMatch(spin.digits)).toBe(true);
      seen.add(spin.digits[0]);
    }
    expect(seen.size).toBe(REEL_SYMBOLS);
  });
});
