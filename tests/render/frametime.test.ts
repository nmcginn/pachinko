import { describe, expect, it } from 'vitest';
import { FRAME_TIME_WINDOW, createFrameTimeMeter } from '../../src/render/frametime';

describe('createFrameTimeMeter', () => {
  it('has no stats before the first frame', () => {
    expect(createFrameTimeMeter().stats()).toBeNull();
  });

  it('reports mean, 95th percentile, max and balls over the frames so far', () => {
    const meter = createFrameTimeMeter(100);
    // 1, 2, …, 100 ms, shuffled so the order can't matter.
    for (let i = 0; i < 100; i++) meter.sample(((i * 37) % 100) + 1, 30 - (i % 3));
    expect(meter.stats()).toEqual({
      frames: 100,
      meanMs: 50.5,
      p95Ms: 95,
      maxMs: 100,
      minBalls: 28,
      meanBalls: 30 - 99 / 100,
    });
  });

  it('uses the nearest rank for small windows: one slow frame in ten is the p95', () => {
    const meter = createFrameTimeMeter(10);
    for (let i = 0; i < 9; i++) meter.sample(1, 30);
    meter.sample(20, 30);
    expect(meter.stats()).toMatchObject({ p95Ms: 20, maxMs: 20 });
  });

  it('forgets frames older than the window', () => {
    const meter = createFrameTimeMeter(4);
    for (const ms of [50, 50, 50, 50]) meter.sample(ms, 0);
    for (const ms of [1, 2, 3, 4]) meter.sample(ms, 30);
    expect(meter.stats()).toEqual({
      frames: 4,
      meanMs: 2.5,
      p95Ms: 4,
      maxMs: 4,
      minBalls: 30,
      meanBalls: 30,
    });
  });

  it('counts a frame with no balls in play', () => {
    const meter = createFrameTimeMeter(4);
    meter.sample(0, 0);
    expect(meter.stats()).toEqual({
      frames: 1,
      meanMs: 0,
      p95Ms: 0,
      maxMs: 0,
      minBalls: 0,
      meanBalls: 0,
    });
  });

  it('ignores negative and non-finite times', () => {
    const meter = createFrameTimeMeter(4);
    for (const ms of [-1, Number.NaN, Infinity]) meter.sample(ms, 30);
    expect(meter.stats()).toBeNull();
  });

  it('defaults to about 2 s of frames at 60 Hz', () => {
    const meter = createFrameTimeMeter();
    for (let i = 0; i < 500; i++) meter.sample(1, 1);
    expect(meter.stats()?.frames).toBe(FRAME_TIME_WINDOW);
    expect(FRAME_TIME_WINDOW).toBe(120);
  });

  it('rejects a window that is not a positive whole number', () => {
    for (const n of [0, -1, 1.5, Number.NaN]) {
      expect(() => createFrameTimeMeter(n)).toThrow(RangeError);
    }
  });
});
