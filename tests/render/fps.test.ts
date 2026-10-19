import { describe, expect, it } from 'vitest';
import { createFpsMeter } from '../../src/render/fps';

describe('createFpsMeter', () => {
  it('reports nothing until a window completes', () => {
    const meter = createFpsMeter(0.5);
    for (let i = 0; i < 29; i++) expect(meter.sample(1 / 60, 33)).toBeNull();
  });

  it('reports frame rate and mean steps per frame over the window', () => {
    const meter = createFpsMeter(0.5);
    let stats = null;
    for (let i = 0; i < 30 && !stats; i++) stats = meter.sample(1 / 60, i % 2 === 0 ? 33 : 34);
    expect(stats).not.toBeNull();
    expect(stats?.fps).toBeCloseTo(60, 6);
    expect(stats?.stepsPerFrame).toBeCloseTo(33.5, 6);
  });

  it('starts a fresh window after reporting', () => {
    const meter = createFpsMeter(0.5);
    for (let i = 0; i < 30; i++) meter.sample(1 / 60, 33);
    expect(meter.sample(0.25, 500)).toBeNull();
    expect(meter.sample(0.25, 500)).toEqual({ fps: 4, stepsPerFrame: 500 });
  });

  it('ignores zero-length and invalid frames', () => {
    const meter = createFpsMeter(0.5);
    expect(meter.sample(0, 0)).toBeNull();
    expect(meter.sample(-1, 0)).toBeNull();
    expect(meter.sample(Number.NaN, 0)).toBeNull();
    expect(meter.sample(0.5, 1000)).toEqual({ fps: 2, stepsPerFrame: 1000 });
  });

  it('rejects a non-positive window', () => {
    expect(() => createFpsMeter(0)).toThrow(RangeError);
  });
});
