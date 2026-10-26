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
  moveCircle,
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

describe('impact speed (M6 rattle)', () => {
  /** Step until the first impact and return its speed. */
  function firstImpact(world: ReturnType<typeof createWorld>, maxSteps = 4000): number {
    for (let i = 0; i < maxSteps; i++) {
      stepWorld(world);
      if (world.impactSpeedMps > 0) return world.impactSpeedMps;
    }
    throw new Error('no impact');
  }

  it('is 0 in an empty world and in free flight', () => {
    const world = createWorld();
    expect(world.impactSpeedMps).toBe(0);
    stepWorld(world);
    expect(world.impactSpeedMps).toBe(0);
    addBall(world, { x: 0, y: 0, vx: 1, vy: 1 });
    for (let i = 0; i < 100; i++) {
      stepWorld(world);
      expect(world.impactSpeedMps).toBe(0);
    }
  });

  it('reports a head-on strike on a nail at the speed the ball hits it, then resets', () => {
    const world = createWorld({
      circles: [createCircle({ x: 0, y: 0 }, NAIL_RADIUS_M, NAIL_MATERIAL)],
    });
    const dropM = 0.05;
    const startY = BALL_RADIUS_M + NAIL_RADIUS_M + dropM;
    addBall(world, { x: 0, y: startY, vy: -1 });
    // Falling dropM from 1 m/s, less a sliver of backboard drag.
    const expected = Math.sqrt(1 + 2 * IN_PLANE_GRAVITY_MPS2 * dropM);
    expect(firstImpact(world)).toBeCloseTo(expected, 2);
    stepWorld(world);
    expect(world.impactSpeedMps).toBe(0);
  });

  it('counts only the normal component of a glancing strike on a rail', () => {
    const world = createWorld({
      segments: createPolyline(
        [
          { x: -1, y: 0 },
          { x: 1, y: 0 },
        ],
        RAIL_MATERIAL,
      ),
    });
    addBall(world, { x: 0, y: BALL_RADIUS_M + 0.0005, vx: 3, vy: -0.4 });
    const speed = firstImpact(world, 10);
    // 0.4 m/s down plus 0.5 mm of fall; nothing like the ball's 3 m/s along the rail.
    expect(speed).toBeCloseTo(Math.sqrt(0.4 ** 2 + 2 * IN_PLANE_GRAVITY_MPS2 * 0.0005), 2);
    expect(speed).toBeLessThan(0.5);
  });

  it('reports two balls meeting head-on at their closing speed, with collisions on', () => {
    const world = createWorld({ ballCollisions: true });
    addBall(world, { x: -0.02, y: 0, vx: 1 });
    addBall(world, { x: 0.02, y: 0, vx: -1 });
    // Gravity acts on both alike, so the closing speed stays 2 m/s, less 0.15% of drag.
    expect(firstImpact(world)).toBeCloseTo(2, 2);
  });

  it('is the fastest of a step’s impacts', () => {
    const world = createWorld({
      circles: [
        createCircle({ x: 0, y: 0 }, NAIL_RADIUS_M, NAIL_MATERIAL),
        createCircle({ x: 0.1, y: 0 }, NAIL_RADIUS_M, NAIL_MATERIAL),
      ],
    });
    const contactY = BALL_RADIUS_M + NAIL_RADIUS_M;
    // Both balls strike on the same step: one at about 0.5 m/s, one at about 2.
    addBall(world, { x: 0, y: contactY + 0.0002, vy: -0.5 });
    addBall(world, { x: 0.1, y: contactY + 0.0008, vy: -2 });
    expect(firstImpact(world, 1)).toBeCloseTo(2, 2);
  });
});

describe('moving a nail (moveCircle, M7)', () => {
  const nailWorld = (broadphase = true) =>
    createWorld({
      circles: [
        createCircle({ x: 0, y: 0 }, NAIL_RADIUS_M, NAIL_MATERIAL),
        createCircle({ x: 0.1, y: 0 }, NAIL_RADIUS_M, NAIL_MATERIAL),
      ],
      broadphase,
    });
  /** Drop a ball from 50 mm above (x, 0) for 0.15 s; whether anything turned it sideways. */
  const deflected = (world: ReturnType<typeof createWorld>, x: number) => {
    const ball = addBall(world, { x, y: 0.05 });
    for (let i = 0; i < steps(0.15); i++) stepWorld(world);
    removeBall(world, ball.id);
    return ball.vx !== 0;
  };

  it('moves the nail for the step: balls hit it where it is now, not where it was', () => {
    for (const broadphase of [true, false]) {
      const world = nailWorld(broadphase);
      expect(deflected(world, 0.0005)).toBe(true);
      // 40 mm to the right: outside the grid cells it was indexed in.
      moveCircle(world, 0, 0.04, 0);
      expect(world.circles[0]).toMatchObject({ x: 0.04, y: 0, radiusM: NAIL_RADIUS_M });
      expect(world.circles[0]?.material).toBe(NAIL_MATERIAL);
      expect(deflected(world, 0.0005)).toBe(false);
      expect(deflected(world, 0.0405)).toBe(true);
      // The other nail is untouched.
      expect(world.circles[1]).toMatchObject({ x: 0.1, y: 0 });
      expect(deflected(world, 0.1005)).toBe(true);
    }
  });

  it('gives the same trajectories with and without the grid after a move', () => {
    const run = (broadphase: boolean) => {
      const world = nailWorld(broadphase);
      moveCircle(world, 1, 0.0123, -0.0004);
      const ball = addBall(world, { x: 0.0125, y: 0.05, vx: 0.01 });
      const path: number[] = [];
      for (let i = 0; i < steps(0.2); i++) {
        stepWorld(world);
        path.push(ball.x, ball.y);
      }
      return path;
    };
    expect(run(true)).toEqual(run(false));
  });

  it('refuses to move a nail into a ball in play, and changes nothing', () => {
    const world = nailWorld();
    const ball = addBall(world, { x: 0.05, y: 0 });
    const gridBefore = world.grid;
    const touchM = BALL_RADIUS_M + NAIL_RADIUS_M;
    expect(() => moveCircle(world, 0, 0.05 - touchM + 1e-6, 0)).toThrow(
      `would overlap ball (id ${ball.id})`,
    );
    expect(world.circles[0]).toMatchObject({ x: 0, y: 0 });
    expect(world.grid).toBe(gridBefore);
    // Touching is allowed: a ball against a nail is a state the step handles.
    moveCircle(world, 0, 0.05 - touchM, 0);
    expect(world.circles[0]?.x).toBe(0.05 - touchM);
  });

  it('refuses a circle that does not exist and a position that is not finite', () => {
    const world = nailWorld();
    expect(() => moveCircle(world, 2, 0, 0)).toThrow('no circle 2');
    expect(() => moveCircle(world, -1, 0, 0)).toThrow('no circle -1');
    expect(() => moveCircle(world, 0.5, 0, 0)).toThrow('no circle 0.5');
    expect(() => moveCircle(createWorld(), 0, 0, 0)).toThrow('no circle 0; the world has 0');
    expect(() => moveCircle(world, 0, NaN, 0)).toThrow('finite');
    expect(world.circles[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('never changes the array of circles the world was created from', () => {
    const circles = [createCircle({ x: 0, y: 0 }, NAIL_RADIUS_M, NAIL_MATERIAL)];
    const world = createWorld({ circles });
    moveCircle(world, 0, 0.01, 0);
    expect(circles[0]).toMatchObject({ x: 0, y: 0 });
  });
});
