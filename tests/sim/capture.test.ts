// Sensors (pockets) in the world step, and the previous-position record
// rendering interpolates from.

import { describe, expect, it } from 'vitest';
import { createPolyline } from '../../src/sim/collide';
import { createSensor } from '../../src/sim/sensor';
import {
  BALL_RADIUS_M,
  MAX_LAUNCH_SPEED_MPS,
  RAIL_MATERIAL,
  SIM_STEP_S,
  addBall,
  createWorld,
  stepWorld,
} from '../../src/sim/world';

const box = (id: string, x0: number, y0: number, x1: number, y1: number) =>
  createSensor(id, [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]);

const steps = (simS: number) => Math.round(simS / SIM_STEP_S);

describe('sensor capture', () => {
  it('captures a ball falling into a pocket, at the point its centre crossed in', () => {
    const world = createWorld({ sensors: [box('cup', -0.05, -0.1, 0.05, 0)] });
    const ball = addBall(world, { x: 0.01, y: 0.05 });
    let removed: readonly unknown[] = [];
    let n = 0;
    while (removed.length === 0 && n++ < steps(1)) removed = stepWorld(world);
    expect(removed).toEqual([ball]);
    expect(world.captures).toEqual([{ ball, sensorId: 'cup' }]);
    expect(world.balls).toEqual([]);
    // Stopped on the sensor's top edge, not wherever the step would have ended.
    expect(ball.y).toBeCloseTo(0, 12);
    expect(ball.x).toBe(0.01);
  });

  it('clears captures on the next step', () => {
    const world = createWorld({ sensors: [box('cup', -1, -1, 1, 0)] });
    addBall(world, { x: 0, y: 0.0001 });
    for (let i = 0; i < steps(0.1) && world.captures.length === 0; i++) stepWorld(world);
    expect(world.captures).toHaveLength(1);
    stepWorld(world);
    expect(world.captures).toEqual([]);
  });

  it('catches a ball crossing a 0.1 mm sensor at well past max launch speed', () => {
    for (const speed of [1, MAX_LAUNCH_SPEED_MPS, 4 * MAX_LAUNCH_SPEED_MPS]) {
      const world = createWorld({ sensors: [box('thin', 0.0101, -1, 0.0102, 1)] });
      addBall(world, { x: 0, y: 0, vx: speed });
      for (let i = 0; i < steps(0.1) && world.captures.length === 0; i++) stepWorld(world);
      expect(
        world.captures.map((c) => c.sensorId),
        `${speed} m/s`,
      ).toEqual(['thin']);
    }
  });

  it('captures a ball that reaches a pocket before a rail behind it', () => {
    // The rail is just below the sensor's top edge: the step's sweep reaches
    // both, and the sensor comes first.
    const world = createWorld({
      segments: createPolyline(
        [
          { x: -1, y: -0.002 - BALL_RADIUS_M },
          { x: 1, y: -0.002 - BALL_RADIUS_M },
        ],
        RAIL_MATERIAL,
      ),
      sensors: [box('cup', -1, -0.5, 1, 0)],
    });
    addBall(world, { x: 0, y: 0.0005, vy: -MAX_LAUNCH_SPEED_MPS });
    stepWorld(world);
    expect(world.captures.map((c) => c.sensorId)).toEqual(['cup']);
  });

  it('does not capture a ball bouncing off a rail short of a pocket', () => {
    // Floor rail above the sensor: the ball rests on it and never enters.
    const world = createWorld({
      segments: createPolyline(
        [
          { x: -1, y: 0 },
          { x: 1, y: 0 },
        ],
        RAIL_MATERIAL,
      ),
      sensors: [box('below', -1, -1, 1, -0.001)],
    });
    addBall(world, { x: 0, y: 0.05 });
    for (let i = 0; i < steps(2); i++) {
      stepWorld(world);
      expect(world.captures).toEqual([]);
    }
    expect(world.balls).toHaveLength(1);
  });

  it('gives the first sensor in order a ball that enters two at once', () => {
    const world = createWorld({ sensors: [box('a', -1, -1, 1, 0), box('b', -1, -1, 1, 0)] });
    addBall(world, { x: 0, y: -0.5 });
    stepWorld(world);
    expect(world.captures.map((c) => c.sensorId)).toEqual(['a']);
  });

  it('gives a ball to whichever sensor its path enters first', () => {
    const world = createWorld({
      sensors: [box('far', 0.002, -1, 0.003, 1), box('near', 0.001, -1, 0.0015, 1)],
    });
    addBall(world, { x: 0, y: 0, vx: 10 });
    stepWorld(world);
    expect(world.captures.map((c) => c.sensorId)).toEqual(['near']);
  });

  it('reports captures in ball order, and keeps uncaptured balls in play', () => {
    const world = createWorld({ sensors: [box('cup', -1, -1, 1, 0)] });
    const a = addBall(world, { x: -0.5, y: 0.0001 });
    const b = addBall(world, { x: 0, y: 1 });
    const c = addBall(world, { x: 0.5, y: 0.0001 });
    for (let i = 0; i < steps(0.1) && world.captures.length === 0; i++) stepWorld(world);
    expect(world.captures.map((x) => x.ball)).toEqual([a, c]);
    expect(world.balls).toEqual([b]);
  });
});

describe('previous position', () => {
  it('starts at the spawn point and tracks the start of each step', () => {
    const world = createWorld();
    const ball = addBall(world, { x: 0.1, y: 0.2, vx: 1 });
    expect([ball.prevX, ball.prevY]).toEqual([0.1, 0.2]);
    stepWorld(world);
    expect([ball.prevX, ball.prevY]).toEqual([0.1, 0.2]);
    const [x1, y1] = [ball.x, ball.y];
    expect(x1).toBeGreaterThan(0.1);
    stepWorld(world);
    expect([ball.prevX, ball.prevY]).toEqual([x1, y1]);
  });
});
