import { describe, expect, it } from 'vitest';
import { createSensor, polygonProblem, sensorContains, sensorEntryT } from '../../src/sim/sensor';
import { addBall, createWorld, stepWorld } from '../../src/sim/world';

const square = createSensor('sq', [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]);

// An L: the square minus its top-right quarter. Concave, so it catches a
// test that only works for convex polygons.
const ell = createSensor('L', [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 0.5, y: 1 },
  { x: 0, y: 1 },
]);

describe('createSensor', () => {
  it('records the bounding box and flattened points, in either winding', () => {
    expect(square).toMatchObject({ kind: 'sensor', id: 'sq', minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(square.points).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    const cw = createSensor('cw', [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ]);
    expect(sensorContains(cw, 0.5, 0.5)).toBe(true);
  });

  it('rejects polygons that are not simple with nonzero area', () => {
    expect(() =>
      createSensor('two', [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toThrow(/at least 3/);
    expect(() =>
      createSensor('line', [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
    ).toThrow(/zero area/);
    // Bow tie: edges 0 and 2 cross.
    expect(() =>
      createSensor('bowtie', [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ]),
    ).toThrow(/edges 0 and 2 cross/);
    expect(() =>
      createSensor('nan', [
        { x: 0, y: 0 },
        { x: NaN, y: 0 },
        { x: 0, y: 1 },
      ]),
    ).toThrow(/finite/);
  });

  it('reports a polygon problem without throwing, for the board validator', () => {
    expect(polygonProblem([{ x: 0, y: 0 }])).toMatch(/at least 3/);
    expect(
      polygonProblem([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ]),
    ).toBeNull();
  });
});

describe('sensorContains', () => {
  it('is true inside and false outside a square', () => {
    expect(sensorContains(square, 0.5, 0.5)).toBe(true);
    expect(sensorContains(square, 1.5, 0.5)).toBe(false);
    expect(sensorContains(square, 0.5, -0.1)).toBe(false);
  });

  it('handles a concave polygon', () => {
    expect(sensorContains(ell, 0.25, 0.75)).toBe(true);
    expect(sensorContains(ell, 0.75, 0.25)).toBe(true);
    // The cut-out corner is inside the bounding box but outside the polygon.
    expect(sensorContains(ell, 0.75, 0.75)).toBe(false);
  });
});

describe('sensorEntryT', () => {
  it('is 0 for a move that starts inside', () => {
    expect(sensorEntryT(square, 0.5, 0.5, 1, 0)).toBe(0);
    expect(sensorEntryT(square, 0.5, 0.5, 0, 0)).toBe(0);
  });

  it('is the fraction of the move at which the edge is crossed', () => {
    expect(sensorEntryT(square, -1, 0.5, 2, 0)).toBeCloseTo(0.5, 12);
    expect(sensorEntryT(square, 0.5, 2, 0, -4)).toBeCloseTo(0.25, 12);
  });

  it('catches a fast move straight through a thin sensor', () => {
    const thin = createSensor('thin', [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.001 },
      { x: 0, y: 0.001 },
    ]);
    // Starts above, ends below: never inside at either end.
    const t = sensorEntryT(thin, 0.5, 0.1, 0, -0.2);
    expect(t).toBeCloseTo(0.495, 12);
    expect(sensorContains(thin, 0.5, 0.1)).toBe(false);
    expect(sensorContains(thin, 0.5, -0.1)).toBe(false);
  });

  it('is Infinity for a move that misses, stops short, or passes the notch of a concave polygon', () => {
    expect(sensorEntryT(square, -1, 2, 3, 0)).toBe(Infinity);
    expect(sensorEntryT(square, -1, 0.5, 0.5, 0)).toBe(Infinity);
    expect(sensorEntryT(square, 2, 2, 0, 0)).toBe(Infinity);
    // Through the L's missing corner, inside its bounding box the whole way.
    expect(sensorEntryT(ell, 0.75, 0.99, 0.2, -0.2)).toBe(Infinity);
  });

  it('takes the first crossing when a move enters a concave polygon twice', () => {
    // Left to right along y = 0.75: enters the L's upright at x = 0.
    expect(sensorEntryT(ell, -0.5, 0.75, 2, 0)).toBeCloseTo(0.25, 12);
  });
});

describe('sensors in a world: skipping them above the highest one', () => {
  /** A 100 mm wide, 20 mm deep pocket from x0, its top at `top`. */
  const pocket = (id: string, x0: number, top: number) =>
    createSensor(id, [
      { x: x0, y: top },
      { x: x0 + 0.1, y: top },
      { x: x0 + 0.1, y: top - 0.02 },
      { x: x0, y: top - 0.02 },
    ]);
  const twoPockets = () =>
    createWorld({ sensors: [pocket('high', 0, 0.12), pocket('low', 0.2, 0.05)] });

  /** Step until a sensor takes a ball; returns its id, or null. */
  const run = (world: ReturnType<typeof createWorld>, maxSteps: number): string | null => {
    for (let i = 0; i < maxSteps; i++) {
      stepWorld(world);
      const taken = world.captures[0]?.sensorId;
      if (taken) return taken;
    }
    return null;
  };

  it('records the highest sensor top, or -Infinity with none', () => {
    expect(twoPockets().sensorsTopY).toBe(0.12);
    expect(createWorld().sensorsTopY).toBe(-Infinity);
  });

  it('still captures balls falling from far above into a high and a low sensor', () => {
    const high = twoPockets();
    addBall(high, { x: 0.05, y: 0.4 });
    expect(run(high, 4000)).toBe('high');
    const low = twoPockets();
    addBall(low, { x: 0.25, y: 0.4 });
    expect(run(low, 4000)).toBe('low');
  });

  it('captures a fast ball whose single step crosses the highest top into the sensor', () => {
    const world = twoPockets();
    // 10 m/s: 5 mm a step, so one step starts above the top and ends inside.
    addBall(world, { x: 0.05, y: 0.1225, vy: -10 });
    expect(run(world, 5)).toBe('high');
  });

  it('captures a ball moving up into a sensor from below', () => {
    const world = twoPockets();
    addBall(world, { x: 0.05, y: 0.06, vy: 2 });
    expect(run(world, 200)).toBe('high');
  });
});
