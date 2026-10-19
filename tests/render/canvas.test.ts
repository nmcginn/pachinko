import { describe, expect, it } from 'vitest';
import { backingStoreSize } from '../../src/render/canvas';

describe('backingStoreSize', () => {
  it('matches CSS size at DPR 1', () => {
    expect(backingStoreSize(800, 600, 1)).toEqual({ width: 800, height: 600 });
  });

  it('doubles at DPR 2', () => {
    expect(backingStoreSize(800, 600, 2)).toEqual({ width: 1600, height: 1200 });
  });

  it('rounds fractional device pixels', () => {
    expect(backingStoreSize(333, 333, 1.5)).toEqual({ width: 500, height: 500 });
    expect(backingStoreSize(100.4, 100.6, 1)).toEqual({ width: 100, height: 101 });
  });

  it('never returns a zero-sized store', () => {
    expect(backingStoreSize(0, 0, 2)).toEqual({ width: 1, height: 1 });
  });

  it('falls back to DPR 1 for a bogus ratio', () => {
    for (const dpr of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(backingStoreSize(320, 240, dpr)).toEqual({ width: 320, height: 240 });
    }
  });
});
