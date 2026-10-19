import { describe, expect, it } from 'vitest';
import { createCircle, createPolyline } from '../../src/sim/collide';
import {
  BACKBOARD_DRAG_PER_S,
  BALL_MASS_KG,
  BALL_RADIUS_M,
  BOARD_TILT_RAD,
  GRAVITY_MPS2,
  IN_PLANE_GRAVITY_MPS2,
  MAX_LAUNCH_SPEED_MPS,
  NAIL_MATERIAL,
  NAIL_RADIUS_M,
  RAIL_MATERIAL,
  SIM_STEP_S,
  addBall,
  ballEnergyJ,
  createWorld,
  removeBall,
  stepWorld,
  totalEnergyJ,
} from '../../src/sim/world';

const steps = (simS: number) => Math.round(simS / SIM_STEP_S);

describe('world clock', () => {
  it('uses a step of 1/2000 s or finer (PLAN.md)', () => {
    expect(SIM_STEP_S).toBeLessThanOrEqual(1 / 2000);
  });

  it('starts at zero, empty', () => {
    const world = createWorld();
    expect(world.timeS).toBe(0);
    expect(world.steps).toBe(0);
    expect(world.balls).toEqual([]);
    expect(world.circles).toEqual([]);
    expect(world.segments).toEqual([]);
    expect(world.bounds).toBeNull();
  });

  it('derives time from the step count with no accumulated drift', () => {
    const world = createWorld();
    for (let i = 0; i < 2_000_000; i++) stepWorld(world);
    expect(world.steps).toBe(2_000_000);
    expect(world.timeS).toBe(2_000_000 * SIM_STEP_S);
    expect(world.timeS).toBeCloseTo(1000, 9);
  });
});

describe('physical constants (PHYSICS.md)', () => {
  it('match the anchors in PLAN.md', () => {
    expect(BALL_RADIUS_M * 2).toBe(0.011);
    expect(BALL_MASS_KG).toBe(0.0055);
    expect(NAIL_RADIUS_M * 2).toBe(0.002);
    expect(NAIL_MATERIAL.restitution).toBe(0.6);
    expect(RAIL_MATERIAL.restitution).toBe(0.4);
  });

  it('take in-plane gravity as g·cos(tilt), with a tilt of a few degrees', () => {
    expect(BOARD_TILT_RAD).toBeGreaterThan(0);
    expect(BOARD_TILT_RAD).toBeLessThan((10 * Math.PI) / 180);
    expect(IN_PLANE_GRAVITY_MPS2).toBeCloseTo(GRAVITY_MPS2 * Math.cos(BOARD_TILT_RAD), 15);
  });

  it('keep materials frozen so a scene cannot retune them by accident', () => {
    expect(Object.isFrozen(NAIL_MATERIAL)).toBe(true);
    expect(Object.isFrozen(RAIL_MATERIAL)).toBe(true);
  });
});

describe('free flight', () => {
  it('follows the semi-implicit Euler parabola under in-plane gravity', () => {
    const world = createWorld();
    const ball = addBall(world, { x: 0, y: 0 });
    const n = steps(0.5);
    for (let i = 0; i < n; i++) stepWorld(world);
    // Drag is small; compare against the drag-free closed form with a loose bound.
    const dropM = (IN_PLANE_GRAVITY_MPS2 * SIM_STEP_S ** 2 * n * (n + 1)) / 2;
    expect(ball.y).toBeLessThan(0);
    expect(Math.abs(ball.y + dropM) / dropM).toBeLessThan(0.05);
    expect(ball.x).toBe(0);
    expect(ball.vx).toBe(0);
  });

  it('decays horizontal speed by the backboard drag', () => {
    const world = createWorld();
    const ball = addBall(world, { x: 0, y: 0, vx: 2 });
    for (let i = 0; i < steps(1); i++) stepWorld(world);
    expect(ball.vx).toBeCloseTo(2 * Math.exp(-BACKBOARD_DRAG_PER_S * 1), 4);
  });
});

describe('ball lifecycle', () => {
  it('stepping an empty world only advances the clock', () => {
    const world = createWorld();
    expect(stepWorld(world)).toEqual([]);
    expect(world.steps).toBe(1);
    expect(totalEnergyJ(world)).toBe(0);
  });

  it('gives each ball a fresh id, never reused after removal', () => {
    const world = createWorld();
    const a = addBall(world, { x: 0, y: 0 });
    const b = addBall(world, { x: 1, y: 0 });
    expect(removeBall(world, a.id)).toBe(true);
    expect(removeBall(world, a.id)).toBe(false);
    const c = addBall(world, { x: 0, y: 0 });
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(world.balls.map((x) => x.id)).toEqual([b.id, c.id]);
  });

  it('rejects a non-finite ball', () => {
    const world = createWorld();
    expect(() => addBall(world, { x: NaN, y: 0 })).toThrow(RangeError);
    expect(() => addBall(world, { x: 0, y: 0, vx: Infinity })).toThrow(RangeError);
    expect(world.balls).toEqual([]);
    expect(world.nextBallId).toBe(1);
  });

  it('rejects a ball placed inside a nail or a rail', () => {
    const world = createWorld({
      circles: [createCircle({ x: 0, y: 0 }, NAIL_RADIUS_M, NAIL_MATERIAL)],
      segments: createPolyline(
        [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        RAIL_MATERIAL,
      ),
    });
    expect(() => addBall(world, { x: 0.005, y: 0 })).toThrow(/nail/);
    expect(() => addBall(world, { x: 1.5, y: 0.003 })).toThrow(/rail/);
    expect(() => addBall(world, { x: 2.004, y: 0 })).toThrow(/rail/);
    // Exactly touching is allowed.
    expect(() => addBall(world, { x: BALL_RADIUS_M + NAIL_RADIUS_M, y: 0 })).not.toThrow();
    expect(() => addBall(world, { x: 1.5, y: BALL_RADIUS_M })).not.toThrow();
  });

  it('rejects inverted or non-finite bounds', () => {
    expect(() => createWorld({ bounds: { minX: 1, minY: 0, maxX: 0, maxY: 1 } })).toThrow(
      RangeError,
    );
    expect(() => createWorld({ bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0 } })).toThrow(
      RangeError,
    );
    expect(() => createWorld({ bounds: { minX: 0, minY: 0, maxX: NaN, maxY: 1 } })).toThrow(
      RangeError,
    );
  });

  it('removes balls that leave the bounds and reports them', () => {
    const world = createWorld({ bounds: { minX: -1, minY: -0.1, maxX: 1, maxY: 1 } });
    const falling = addBall(world, { x: 0, y: 0 });
    const staying = addBall(world, { x: 0, y: 0.9, vy: 1 });
    let removedAt = -1;
    for (let i = 0; i < steps(1); i++) {
      const removed = stepWorld(world);
      if (removed.length > 0) {
        expect(removed).toEqual([falling]);
        removedAt = world.steps;
        break;
      }
    }
    // Falls 0.1 m: about √(2 · 0.1 / g) ≈ 0.143 s.
    expect(removedAt * SIM_STEP_S).toBeCloseTo(Math.sqrt(0.2 / IN_PLANE_GRAVITY_MPS2), 2);
    expect(world.balls).toEqual([staying]);
  });

  it('removes a ball leaving through the side or top too', () => {
    const world = createWorld({ bounds: { minX: -0.1, minY: -10, maxX: 0.1, maxY: 0.1 } });
    addBall(world, { x: 0, y: 0, vx: 1 });
    addBall(world, { x: 0, y: 0, vy: 5 });
    for (let i = 0; i < steps(0.2); i++) stepWorld(world);
    expect(world.balls).toEqual([]);
  });

  it('computes energy as kinetic plus in-plane potential', () => {
    const ball = { x: 0, y: 0.5, vx: 3, vy: 4 };
    expect(ballEnergyJ(ball)).toBeCloseTo(BALL_MASS_KG * (12.5 + IN_PLANE_GRAVITY_MPS2 * 0.5), 15);
  });
});

describe('contact behaviour', () => {
  it('bounces a dropped ball off a rail lower each time', () => {
    const world = createWorld({
      segments: createPolyline(
        [
          { x: -1, y: 0 },
          { x: 1, y: 0 },
        ],
        RAIL_MATERIAL,
      ),
    });
    const ball = addBall(world, { x: 0, y: 0.1 });
    const peaks: number[] = [];
    let rising = false;
    let last = ball.y;
    for (let i = 0; i < steps(2); i++) {
      stepWorld(world);
      if (rising && ball.y < last) peaks.push(last);
      rising = ball.y > last;
      last = ball.y;
    }
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    // Bounce height scales with e²: 0.16 of the drop above the contact height.
    const drop = 0.1 - BALL_RADIUS_M;
    expect((peaks[0] as number) - BALL_RADIUS_M).toBeCloseTo(drop * 0.16, 3);
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i] as number).toBeLessThan(peaks[i - 1] as number);
    }
  });

  it('rolls a ball down a gentle rail instead of letting friction hold it', () => {
    const a = Math.PI / 180; // 1°
    const world = createWorld({
      segments: createPolyline(
        [
          { x: -1, y: Math.sin(a) },
          { x: 1, y: -Math.sin(a) },
        ],
        RAIL_MATERIAL,
      ),
    });
    const ball = addBall(world, { x: 0, y: BALL_RADIUS_M / Math.cos(a) });
    for (let i = 0; i < steps(1); i++) stepWorld(world);
    // Sliding without friction: x ≈ ½ g sin(a) cos(a) t², about 8.5 cm after 1 s.
    const expected = 0.5 * IN_PLANE_GRAVITY_MPS2 * Math.sin(a) * Math.cos(a);
    expect(ball.x).toBeGreaterThan(0.9 * expected);
    expect(ball.x).toBeLessThan(expected);
  });

  it('rolls a ball off the top of a nail when it lands slightly off-centre', () => {
    const world = createWorld({
      circles: [createCircle({ x: 0, y: 0 }, NAIL_RADIUS_M, NAIL_MATERIAL)],
    });
    const ball = addBall(world, { x: 0.0001, y: BALL_RADIUS_M + NAIL_RADIUS_M + 0.002 });
    for (let i = 0; i < steps(1); i++) stepWorld(world);
    expect(ball.y).toBeLessThan(-0.1);
    expect(ball.x).toBeGreaterThan(0);
  });

  it('deflects a ball fired at max launch speed off a nail without slowing it past restitution', () => {
    const world = createWorld({
      circles: [createCircle({ x: 0, y: 0 }, NAIL_RADIUS_M, NAIL_MATERIAL)],
    });
    const ball = addBall(world, { x: -0.01, y: 0, vx: MAX_LAUNCH_SPEED_MPS });
    for (let i = 0; i < 10; i++) stepWorld(world);
    expect(ball.vx).toBeLessThan(0);
    expect(Math.abs(ball.vx)).toBeCloseTo(MAX_LAUNCH_SPEED_MPS * NAIL_MATERIAL.restitution, 1);
  });
});
