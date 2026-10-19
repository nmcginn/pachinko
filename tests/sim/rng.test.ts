import { describe, expect, it } from 'vitest';
import { createRng, createRngFromState } from '../../src/sim/rng';

// Reference outputs from the xoshiro128** C code (prng.di.unimi.it) and a C
// splitmix32 seeder, compiled and run once to produce these numbers.
describe('rng: xoshiro128**', () => {
  it('matches the reference implementation from a raw state', () => {
    const rng = createRngFromState([1, 2, 3, 4]);
    const out = Array.from({ length: 6 }, () => rng.nextU32());
    expect(out).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492]);
  });

  const seeded: [number, number[], number[]][] = [
    [
      0,
      [1684164658, 3653269916, 2939563536, 2141751570],
      [1789933344, 44971166, 2521387044, 3848737593],
    ],
    [
      1,
      [1580013426, 350525680, 3524174333, 3011703609],
      [393288148, 2174103013, 3814759091, 2092745082],
    ],
    [
      42,
      [551831576, 144025891, 322543647, 3034809370],
      [660444221, 3652823732, 77672526, 910233633],
    ],
  ];
  for (const [seed, state, outputs] of seeded) {
    it(`matches the reference seeding and output for seed ${seed}`, () => {
      const rng = createRng(seed);
      expect(rng.state()).toEqual(state);
      expect(Array.from({ length: 4 }, () => rng.nextU32())).toEqual(outputs);
    });
  }

  it('repeats exactly for the same seed', () => {
    const a = createRng(123);
    const b = createRng(123);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('differs for different seeds', () => {
    const a = createRng(123);
    const b = createRng(124);
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    const sb = Array.from({ length: 8 }, () => b.nextU32());
    expect(sa).not.toEqual(sb);
  });

  it('resumes from a saved state', () => {
    const a = createRng(9);
    for (let i = 0; i < 10; i++) a.next();
    const b = createRngFromState(a.state());
    for (let i = 0; i < 100; i++) expect(b.nextU32()).toBe(a.nextU32());
  });

  it('gives floats in [0, 1) that are roughly uniform', () => {
    const rng = createRng(7);
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
      const i10 = Math.floor(x * 10);
      buckets[i10] = (buckets[i10] ?? 0) + 1;
    }
    expect(sum / n).toBeCloseTo(0.5, 2);
    // Each bucket expects 10 000 with a standard deviation of about 95.
    for (const count of buckets) expect(Math.abs(count - n / 10)).toBeLessThan(500);
  });

  it('maps range() onto [min, max)', () => {
    const rng = createRng(3);
    for (let i = 0; i < 1000; i++) {
      const x = rng.range(-2, 5);
      expect(x).toBeGreaterThanOrEqual(-2);
      expect(x).toBeLessThan(5);
    }
    expect(rng.range(4, 4)).toBe(4);
  });

  it('rejects seeds that are not 32-bit unsigned integers', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, 2 ** 32]) {
      expect(() => createRng(bad)).toThrow(RangeError);
    }
    expect(() => createRng(2 ** 32 - 1)).not.toThrow();
  });

  it('rejects an all-zero or malformed raw state', () => {
    expect(() => createRngFromState([0, 0, 0, 0])).toThrow(RangeError);
    expect(() => createRngFromState([1, 2, 3, -4])).toThrow(RangeError);
    expect(() => createRngFromState([1, 2, 3, 0.5])).toThrow(RangeError);
  });
});
