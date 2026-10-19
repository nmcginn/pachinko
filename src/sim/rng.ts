// Seeded PRNG: xoshiro128** (Blackman & Vigna), seeded through splitmix32.
// The only source of randomness in sim/ and game/. Same seed, same sequence,
// on every platform: everything is 32-bit integer math via Math.imul and >>> 0.

export interface Rng {
  /** Next raw 32-bit output as an unsigned integer in [0, 2^32). */
  nextU32(): number;
  /** Uniform float in [0, 1), with 32 bits of resolution. */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /**
   * Approximately standard normal (mean 0, variance 1): the sum of 12
   * uniforms, minus 6. Bounded to [-6, 6], and built from additions only, so
   * it is bit-for-bit the same on every engine (Box–Muller would need
   * Math.log and Math.cos, whose last bits vary between engines).
   */
  normal(): number;
  /** Copy of the internal state, for snapshots and tests. */
  state(): [number, number, number, number];
}

const U32 = 0x1_0000_0000;

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** splitmix32 step: expands one 32-bit seed into well-mixed state words. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/**
 * Build a generator from a 32-bit seed. Any integer in [0, 2^32) is valid,
 * including 0 (splitmix32 never yields the all-zero xoshiro state).
 */
export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed) || seed < 0 || seed >= U32) {
    throw new RangeError(`rng seed must be an integer in [0, 2^32), got ${seed}`);
  }
  const mix = splitmix32(seed);
  return createRngFromState([mix(), mix(), mix(), mix()]);
}

/**
 * Seed for one independent stream of a run: stream `i` of seed `s`. The
 * Monte Carlo runner gives every ball its own stream, so a ball's draws
 * depend only on the run's seed and the ball's index, never on how the run
 * was split across workers. Both inputs must be integers in [0, 2^32).
 */
export function streamSeed(seed: number, stream: number): number {
  for (const [name, v] of [
    ['seed', seed],
    ['stream', stream],
  ] as const) {
    if (!Number.isInteger(v) || v < 0 || v >= U32) {
      throw new RangeError(`rng ${name} must be an integer in [0, 2^32), got ${v}`);
    }
  }
  // Two rounds of splitmix32 mixing: one for the stream, one combining it with the seed.
  return splitmix32((seed ^ splitmix32(stream)()) >>> 0)();
}

/** Build a generator from an explicit xoshiro128 state. The state must not be all zero. */
export function createRngFromState(init: readonly [number, number, number, number]): Rng {
  if (init.some((w) => !Number.isInteger(w) || w < 0 || w >= U32)) {
    throw new RangeError('rng state words must be integers in [0, 2^32)');
  }
  if (init.every((w) => w === 0)) {
    throw new RangeError('rng state must not be all zero');
  }
  let [s0, s1, s2, s3] = init;

  const nextU32 = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };

  const next = (): number => nextU32() / U32;

  const normal = (): number => {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += next();
    return sum - 6;
  };

  return {
    nextU32,
    next,
    range: (min, max) => min + (max - min) * next(),
    normal,
    state: () => [s0, s1, s2, s3],
  };
}
