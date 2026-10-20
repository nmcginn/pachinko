// Gates: a lid that can be switched off, over a pocket. The attacker (M4).

import { describe, expect, it } from 'vitest';
import { createPolyline } from '../../src/sim/collide';
import { createSensor } from '../../src/sim/sensor';
import {
  type World,
  BALL_RADIUS_M,
  RAIL_MATERIAL,
  SIM_STEP_S,
  addBall,
  createWorld,
  setGateOpen,
  stepWorld,
  totalEnergyJ,
} from '../../src/sim/world';

const steps = (simS: number) => Math.round(simS / SIM_STEP_S);
const pts = (...xy: [number, number][]) => xy.map(([x, y]) => ({ x, y }));

/** Lid height: the top of a 100 mm wide, 30 mm deep box. */
const LID_Y = 0.1;

/**
 * A box (walls and floor are rails) with a sensor filling it below the lid,
 * and a flat lid across the top as gate "g". Funnel walls above guide a
 * dropped ball onto the lid.
 */
function boxWorld(options: { open?: boolean; broadphase?: boolean } = {}): World {
  return createWorld({
    segments: [...createPolyline(pts([0, 0.2], [0, 0.07], [0.1, 0.07], [0.1, 0.2]), RAIL_MATERIAL)],
    sensors: [
      createSensor(
        'pocket',
        pts([0.0005, LID_Y - 0.0005], [0.0995, LID_Y - 0.0005], [0.0995, 0.0705], [0.0005, 0.0705]),
      ),
    ],
    gates: [
      {
        id: 'g',
        segments: createPolyline(pts([0, LID_Y], [0.1, LID_Y]), RAIL_MATERIAL),
        sensorId: 'pocket',
        ...(options.open === undefined ? {} : { open: options.open }),
      },
    ],
    ...(options.broadphase === undefined ? {} : { broadphase: options.broadphase }),
  });
}

/** Step until the world's balls are gone or the time is up; returns every capture seen. */
function runUntilEmpty(world: World, maxS: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < steps(maxS) && world.balls.length > 0; i++) {
    stepWorld(world);
    for (const c of world.captures) seen.push(c.sensorId);
  }
  return seen;
}

describe('gates', () => {
  it('appends lid segments after the rails and starts closed', () => {
    const world = boxWorld();
    expect(world.segments).toHaveLength(4);
    expect(world.gates).toEqual([
      { id: 'g', sensorId: 'pocket', segments: [3], openSegments: [], open: false },
    ]);
    expect([...world.segmentOff]).toEqual([0, 0, 0, 0]);
    expect(boxWorld({ open: true }).segmentOff[3]).toBe(1);
  });

  it('closed: a ball dropped on the lid comes to rest on it, never entering, never creeping', () => {
    const world = boxWorld();
    addBall(world, { x: 0.05, y: 0.15 });
    let energy = totalEnergyJ(world);
    for (let i = 0; i < steps(3); i++) {
      stepWorld(world);
      expect(world.captures).toEqual([]);
      const e = totalEnergyJ(world);
      expect(e).toBeLessThanOrEqual(energy);
      energy = e;
    }
    const ball = world.balls[0];
    expect(ball?.y).toBeCloseTo(LID_Y + BALL_RADIUS_M, 6);
    const at = { x: ball?.x, y: ball?.y };
    for (let i = 0; i < steps(1); i++) stepWorld(world);
    expect({ x: ball?.x, y: ball?.y }).toEqual(at);
  });

  it('open: a dropped ball falls through into the pocket', () => {
    const world = boxWorld({ open: true });
    addBall(world, { x: 0.05, y: 0.15 });
    expect(runUntilEmpty(world, 2)).toEqual(['pocket']);
  });

  it('opening under a resting ball drops it in', () => {
    const world = boxWorld();
    addBall(world, { x: 0.05, y: 0.15 });
    for (let i = 0; i < steps(2); i++) stepWorld(world);
    expect(world.balls).toHaveLength(1);
    expect(setGateOpen(world, 'g', true)).toEqual([]);
    expect(runUntilEmpty(world, 1)).toEqual(['pocket']);
  });

  it('closing on a ball in the mouth takes it into the pocket; one clear of the lid stays', () => {
    const world = boxWorld({ open: true });
    // Centre just above the lid line (overlapping it), just below (overlapping
    // it, not yet in the sensor), and one exactly a radius above (touching, clear).
    const above = addBall(world, { x: 0.02, y: LID_Y + 0.004 });
    const below = addBall(world, { x: 0.05, y: LID_Y - 0.0003 });
    const clear = addBall(world, { x: 0.08, y: LID_Y + BALL_RADIUS_M });
    const caught = setGateOpen(world, 'g', false);
    expect(caught.map((c) => [c.ball.id, c.sensorId])).toEqual([
      [above.id, 'pocket'],
      [below.id, 'pocket'],
    ]);
    expect(world.balls).toEqual([clear]);
    // The step's captures are the step's own; the gate's aren't added to them.
    expect(world.captures).toEqual([]);
    expect(world.gates[0]?.open).toBe(false);
    expect(world.segmentOff[3]).toBe(0);
  });

  it('does nothing when set to the state it is already in', () => {
    const world = boxWorld({ open: true });
    addBall(world, { x: 0.05, y: LID_Y });
    expect(setGateOpen(world, 'g', true)).toEqual([]);
    expect(world.balls).toHaveLength(1);
    const closed = boxWorld();
    addBall(closed, { x: 0.05, y: 0.15 });
    expect(setGateOpen(closed, 'g', false)).toEqual([]);
    expect(closed.balls).toHaveLength(1);
  });

  it('lets addBall place a ball where the lid is only while the gate is open', () => {
    const world = boxWorld();
    expect(() => addBall(world, { x: 0.05, y: LID_Y })).toThrow(/overlaps a rail/);
    setGateOpen(world, 'g', true);
    expect(() => addBall(world, { x: 0.05, y: LID_Y })).not.toThrow();
  });

  it('gives identical results with and without the broadphase, gate opening mid-run', () => {
    const trace = (broadphase: boolean) => {
      const world = boxWorld({ broadphase });
      addBall(world, { x: 0.03, y: 0.18, vx: 0.4 });
      addBall(world, { x: 0.07, y: 0.16, vx: -0.3 });
      const out: number[] = [];
      for (let i = 0; i < steps(2); i++) {
        if (i === steps(1)) setGateOpen(world, 'g', true);
        stepWorld(world);
        for (const b of world.balls) out.push(b.x, b.y);
      }
      return out;
    };
    expect(trace(true)).toEqual(trace(false));
  });

  it('rejects an unknown gate, a duplicate id, a missing sensor, or a gate with no segments', () => {
    expect(() => setGateOpen(boxWorld(), 'nope', true)).toThrow(/no gate "nope"/);
    const lid = createPolyline(pts([0, 0], [1, 0]), RAIL_MATERIAL);
    const sensors = [createSensor('s', pts([0, 0], [1, 0], [1, -1]))];
    expect(() =>
      createWorld({
        sensors,
        gates: [
          { id: 'a', segments: lid, sensorId: 's' },
          { id: 'a', segments: lid, sensorId: 's' },
        ],
      }),
    ).toThrow(/duplicate gate id "a"/);
    expect(() =>
      createWorld({ sensors, gates: [{ id: 'a', segments: lid, sensorId: 'x' }] }),
    ).toThrow(/sensor "x"/);
    expect(() =>
      createWorld({ sensors, gates: [{ id: 'a', segments: [], sensorId: 's' }] }),
    ).toThrow(/has no segments/);
  });
});

// A gate with an open shape too: a tulip's wings (M5). Here the box's lid is
// the closed shape and a shelf higher up the box is the open one, so which
// is solid shows in where a dropped ball comes to rest.

/** Shelf height: solid only while gate "g" is open. */
const SHELF_Y = 0.15;

function shelfWorld(options: { open?: boolean; broadphase?: boolean } = {}): World {
  return createWorld({
    segments: [...createPolyline(pts([0, 0.2], [0, 0.07], [0.1, 0.07], [0.1, 0.2]), RAIL_MATERIAL)],
    sensors: [
      createSensor(
        'pocket',
        pts([0.0005, LID_Y - 0.0005], [0.0995, LID_Y - 0.0005], [0.0995, 0.0705], [0.0005, 0.0705]),
      ),
    ],
    gates: [
      {
        id: 'g',
        segments: createPolyline(pts([0, LID_Y], [0.1, LID_Y]), RAIL_MATERIAL),
        openSegments: createPolyline(pts([0, SHELF_Y], [0.1, SHELF_Y]), RAIL_MATERIAL),
        sensorId: 'pocket',
        ...(options.open === undefined ? {} : { open: options.open }),
      },
    ],
    ...(options.broadphase === undefined ? {} : { broadphase: options.broadphase }),
  });
}

/** Drop a ball from high in the box and let it settle; returns its height, or null if a pocket took it. */
function restingY(world: World): number | null {
  const ball = addBall(world, { x: 0.05, y: 0.19 });
  for (let i = 0; i < steps(2); i++) stepWorld(world);
  return world.balls.includes(ball) ? ball.y : null;
}

describe('gates with an open shape', () => {
  it('appends the closed segments, then the open ones, and skips the open ones while closed', () => {
    const world = shelfWorld();
    expect(world.gates).toEqual([
      { id: 'g', sensorId: 'pocket', segments: [3], openSegments: [4], open: false },
    ]);
    expect([...world.segmentOff]).toEqual([0, 0, 0, 0, 1]);
    expect([...shelfWorld({ open: true }).segmentOff]).toEqual([0, 0, 0, 1, 0]);
  });

  it('closed: a dropped ball passes where the shelf would be and rests on the lid', () => {
    expect(restingY(shelfWorld())).toBeCloseTo(LID_Y + BALL_RADIUS_M, 6);
  });

  it('open: the shelf is solid and the lid is gone, so a ball rests on the shelf', () => {
    expect(restingY(shelfWorld({ open: true }))).toBeCloseTo(SHELF_Y + BALL_RADIUS_M, 6);
  });

  it('switches shapes back and forth, each time from the right segments', () => {
    const world = shelfWorld();
    setGateOpen(world, 'g', true);
    expect([...world.segmentOff]).toEqual([0, 0, 0, 1, 0]);
    setGateOpen(world, 'g', false);
    expect([...world.segmentOff]).toEqual([0, 0, 0, 0, 1]);
    expect(restingY(world)).toBeCloseTo(LID_Y + BALL_RADIUS_M, 6);
  });

  it('opening on a ball the open shape would land on takes it into the pocket; one clear stays', () => {
    const world = shelfWorld();
    // Overlapping the shelf line from above and from below, and one exactly
    // a radius above it (touching, clear), all in flight.
    const above = addBall(world, { x: 0.02, y: SHELF_Y + 0.003 });
    const below = addBall(world, { x: 0.05, y: SHELF_Y - 0.002 });
    const clear = addBall(world, { x: 0.08, y: SHELF_Y + BALL_RADIUS_M });
    const caught = setGateOpen(world, 'g', true);
    expect(caught.map((c) => [c.ball.id, c.sensorId])).toEqual([
      [above.id, 'pocket'],
      [below.id, 'pocket'],
    ]);
    expect(world.balls).toEqual([clear]);
    expect(world.captures).toEqual([]);
  });

  it('closing on a ball resting on the shelf leaves it to fall onto the lid', () => {
    const world = shelfWorld({ open: true });
    const ball = addBall(world, { x: 0.05, y: 0.19 });
    for (let i = 0; i < steps(2); i++) stepWorld(world);
    expect(ball.y).toBeCloseTo(SHELF_Y + BALL_RADIUS_M, 6);
    // The lid is far below it: nothing to take in.
    expect(setGateOpen(world, 'g', false)).toEqual([]);
    for (let i = 0; i < steps(2); i++) stepWorld(world);
    expect(ball.y).toBeCloseTo(LID_Y + BALL_RADIUS_M, 6);
  });

  it('lets addBall place a ball on the shelf line only while the gate is closed', () => {
    const world = shelfWorld();
    expect(() => addBall(world, { x: 0.05, y: SHELF_Y })).not.toThrow();
    const open = shelfWorld({ open: true });
    expect(() => addBall(open, { x: 0.05, y: SHELF_Y })).toThrow(/overlaps a rail/);
  });

  it('never adds energy when it switches, with balls in flight and at rest', () => {
    const world = shelfWorld();
    addBall(world, { x: 0.03, y: 0.19, vx: 0.4 });
    addBall(world, { x: 0.07, y: 0.17, vx: -0.3 });
    let energy = totalEnergyJ(world);
    for (let i = 0; i < steps(3); i++) {
      if (i % steps(0.25) === 0) setGateOpen(world, 'g', !world.gates[0]?.open);
      stepWorld(world);
      const e = totalEnergyJ(world);
      expect(e).toBeLessThanOrEqual(energy);
      energy = e;
    }
  });

  it('accepts a gate with only an open shape', () => {
    const world = createWorld({
      sensors: [createSensor('s', pts([0, 0], [1, 0], [1, -1]))],
      gates: [
        {
          id: 'a',
          segments: [],
          openSegments: createPolyline(pts([0, 0], [1, 0]), RAIL_MATERIAL),
          sensorId: 's',
        },
      ],
    });
    expect(world.gates[0]).toMatchObject({ segments: [], openSegments: [0] });
    expect([...world.segmentOff]).toEqual([1]);
  });

  it('gives identical results with and without the broadphase, switching both ways mid-run', () => {
    const trace = (broadphase: boolean) => {
      const world = shelfWorld({ broadphase });
      addBall(world, { x: 0.03, y: 0.19, vx: 0.4 });
      addBall(world, { x: 0.07, y: 0.17, vx: -0.3 });
      const out: number[] = [];
      for (let i = 0; i < steps(3); i++) {
        if (i === steps(0.05) || i === steps(1.5)) setGateOpen(world, 'g', i === steps(0.05));
        stepWorld(world);
        for (const b of world.balls) out.push(b.x, b.y);
      }
      return out;
    };
    const a = trace(true);
    expect(a.length).toBeGreaterThan(0);
    expect(trace(false)).toEqual(a);
  });
});
