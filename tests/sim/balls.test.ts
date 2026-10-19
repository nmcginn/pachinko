// Ball against ball (M5): the pair impulse, the world moving balls together,
// the spatial hash, and launches waiting for the lane. The physics
// invariants with many balls are in invariants.test.ts.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBoardWorld, launchBall, launcherClear, parseBoard } from '../../src/sim/board';
import {
  CONTACT_SLOP_M,
  createPolyline,
  resolveBallContact,
  restingSpeedMps,
} from '../../src/sim/collide';
import { createRng } from '../../src/sim/rng';
import {
  type World,
  type WorldOptions,
  BALL_RADIUS_M,
  BALL_RESTITUTION,
  IN_PLANE_GRAVITY_MPS2,
  MAX_LAUNCH_SPEED_MPS,
  RAIL_MATERIAL,
  SIM_STEP_S,
  addBall,
  createWorld,
  overlapsBall,
  stepWorld,
} from '../../src/sim/world';
import { GRID_DROP_Y_M, GRID_WIDTH_M, gridWorld } from './scenes';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
const steps = (simS: number) => Math.round(simS / SIM_STEP_S);
const GRAVITY_DV = IN_PLANE_GRAVITY_MPS2 * SIM_STEP_S;
const TOUCH_M = 2 * BALL_RADIUS_M;

/** Closest any two balls in play come, centre to centre, minus a ball's diameter. */
function minPairGapM(world: World): number {
  let min = Infinity;
  const bs = world.balls;
  for (let a = 0; a < bs.length; a++) {
    for (let b = a + 1; b < bs.length; b++) {
      const p = bs[a];
      const q = bs[b];
      if (p && q) min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y) - TOUCH_M);
    }
  }
  return min;
}

/** Every ball's state, flattened, for bit-for-bit comparison. */
function snapshot(world: World): number[] {
  return world.balls.flatMap((b) => [b.id, b.x, b.y, b.vx, b.vy]);
}

function expectSameBits(a: readonly number[], b: readonly number[]): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) throw new Error(`differ at index ${i}: ${a[i]} vs ${b[i]}`);
  }
}

/** The closed 10×10 grid with balls colliding, filled with `count` balls at random speeds up to max launch. */
function busyGrid(seed: number, count: number, options: WorldOptions = {}): World {
  const scene = gridWorld({ closed: true });
  const world = createWorld({
    circles: scene.circles,
    segments: scene.segments,
    ballCollisions: true,
    ...options,
  });
  const rng = createRng(seed);
  while (world.balls.length < count) {
    const x = rng.range(0.02, GRID_WIDTH_M - 0.02);
    const y = GRID_DROP_Y_M + rng.range(-0.01, 0.05);
    const angle = rng.range(0, 2 * Math.PI);
    const speed = rng.range(0, MAX_LAUNCH_SPEED_MPS);
    if (overlapsBall(world, x, y)) continue;
    addBall(world, { x, y, vx: speed * Math.cos(angle), vy: speed * Math.sin(angle) });
  }
  return world;
}

describe('resolveBallContact', () => {
  const e = BALL_RESTITUTION;

  it('bounces a head-on pair apart with restitution, conserving momentum', () => {
    const a = { x: 0, y: 0, vx: -1, vy: 0 };
    const b = { x: -TOUCH_M, y: 0, vx: 0.5, vy: 0 };
    resolveBallContact(a, b, 1, 0, e, GRAVITY_DV);
    expect(a.vx + b.vx).toBeCloseTo(-0.5, 15);
    // Separating at e times the approach speed.
    expect(a.vx - b.vx).toBeCloseTo(e * 1.5, 15);
  });

  it('takes (1 − e²)·vn²/4 of kinetic energy per unit mass, and keeps tangential speed', () => {
    const a = { x: 0, y: 0, vx: -2, vy: 0.7 };
    const b = { x: -TOUCH_M, y: 0, vx: 0, vy: -0.3 };
    const ke = () => 0.5 * (a.vx ** 2 + a.vy ** 2 + b.vx ** 2 + b.vy ** 2);
    const before = ke();
    resolveBallContact(a, b, 1, 0, e, GRAVITY_DV);
    expect(before - ke()).toBeCloseTo(((1 - e * e) * 4) / 4, 12);
    expect(a.vy).toBe(0.7);
    expect(b.vy).toBe(-0.3);
  });

  it('does nothing to balls already moving apart, or sliding past', () => {
    for (const [vx, vy] of [
      [1, 0],
      [0, 1],
      [0, 0],
    ] as const) {
      const a = { x: 0, y: 0, vx, vy };
      const b = { x: -TOUCH_M, y: 0, vx: 0, vy: 0 };
      resolveBallContact(a, b, 1, 0, e, GRAVITY_DV);
      expect([a.vx, a.vy, b.vx, b.vy]).toEqual([vx, vy, 0, 0]);
    }
  });

  it('moves a ball pushed into the surface it slides on only along that surface', () => {
    // b lies on a floor (normal +y); a comes down onto it from up and to the
    // right, along the 45° line between their centres.
    const n = Math.SQRT1_2;
    const a = { x: n * TOUCH_M, y: n * TOUCH_M, vx: 0, vy: -1 };
    const b = { x: 0, y: 0, vx: 0, vy: 0 };
    resolveBallContact(a, b, n, n, 0.5, GRAVITY_DV, 0, 0, 0, 1);
    // The floor takes b's downward share: b slides off to the left, flat.
    expect(b.vy).toBe(0);
    expect(b.vx).toBeLessThan(0);
    // And the pair separates at e times the approach speed, along n.
    const vn = (a.vx - b.vx) * n + (a.vy - b.vy) * n;
    expect(vn).toBeCloseTo(0.5 * n, 12);
    // The surface only pushes: pulled away from it, b moves freely.
    const c = { x: 0, y: 0, vx: 0, vy: 0 };
    const d = { x: n * TOUCH_M, y: -n * TOUCH_M, vx: 0, vy: 1 };
    resolveBallContact(d, c, n, -n, 0.5, GRAVITY_DV, 0, 0, 0, 1);
    expect(c.vy).toBeGreaterThan(0);
  });

  it('gives exactly the free impulse when no surface is given', () => {
    const run = (withZeros: boolean) => {
      const a = { x: 0, y: 0, vx: -1.3, vy: 0.2 };
      const b = { x: -TOUCH_M, y: 0, vx: 0.4, vy: -0.1 };
      if (withZeros) resolveBallContact(a, b, 1, 0, e, GRAVITY_DV, 0, 0, 0, 0);
      else resolveBallContact(a, b, 1, 0, e, GRAVITY_DV);
      return [a.vx, a.vy, b.vx, b.vy];
    };
    expect(run(true)).toEqual(run(false));
    expect(run(false)[0]).toBeCloseTo(-1.3 + ((1 + e) * 1.7) / 2, 15);
  });

  it('is perfectly inelastic below the resting threshold', () => {
    const slow = 0.9 * restingSpeedMps(e, GRAVITY_DV);
    const a = { x: 0, y: 0, vx: 0, vy: -slow };
    const b = { x: 0, y: -TOUCH_M, vx: 0, vy: 0 };
    resolveBallContact(a, b, 0, 1, e, GRAVITY_DV);
    expect(a.vy).toBeCloseTo(b.vy, 15);
    expect(a.vy).toBeCloseTo(-slow / 2, 15);
  });
});

describe('ball collisions in the world', () => {
  it('are off for a bare world, where balls pass through each other as before M5', () => {
    const world = createWorld();
    expect(world.ballCollisions).toBe(false);
    addBall(world, { x: 0, y: 0, vx: 1 });
    addBall(world, { x: 0.05, y: 0, vx: -1 });
    addBall(world, { x: 0.05, y: 0 }); // Overlapping is allowed with them off.
    for (let i = 0; i < steps(0.05); i++) stepWorld(world);
    expect(world.balls[0]?.x).toBeGreaterThan(0.045);
    expect(world.balls[1]?.x).toBeLessThan(0.005);
  });

  it('are on for board worlds', () => {
    expect(createBoardWorld(classic).ballCollisions).toBe(true);
  });

  it('refuse a ball placed over another, and say which', () => {
    const world = createWorld({ ballCollisions: true });
    const first = addBall(world, { x: 0, y: 0 });
    expect(overlapsBall(world, 0.01, 0)).toBe(true);
    expect(() => addBall(world, { x: 0.01, y: 0 })).toThrow(`ball (id ${first.id})`);
    // Exactly touching is fine.
    expect(overlapsBall(world, TOUCH_M, 0)).toBe(false);
    addBall(world, { x: TOUCH_M, y: 0 });
    expect(world.balls).toHaveLength(2);
  });

  it('bounce two balls fired at each other apart, without ever overlapping', () => {
    for (const speed of [0.1, 1, MAX_LAUNCH_SPEED_MPS, 2 * MAX_LAUNCH_SPEED_MPS, 50]) {
      for (const offset of [0, 0.3, 0.7, 0.99].map((k) => k * TOUCH_M)) {
        const world = createWorld({ ballCollisions: true });
        const a = addBall(world, { x: -0.02, y: offset / 2, vx: speed });
        const b = addBall(world, { x: 0.02, y: -offset / 2, vx: -speed });
        let minGap = Infinity;
        for (let i = 0; i < steps(0.1); i++) {
          stepWorld(world);
          minGap = Math.min(minGap, minPairGapM(world));
        }
        expect(minGap, `speed ${speed}, offset ${offset}`).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
        if (offset < 0.5 * TOUCH_M) {
          // Near head-on, each turns back: neither went through the other.
          // (A glancing hit deflects them past each other.)
          expect(a.x, `speed ${speed}, offset ${offset}`).toBeLessThan(b.x);
        }
        // Momentum along x is conserved: equal and opposite before, so after.
        expect(a.vx + b.vx).toBeCloseTo(0, 9);
      }
    }
  });

  it('hand a moving ball’s momentum to one at rest on a ledge (Newton’s cradle)', () => {
    const world = createWorld({
      ballCollisions: true,
      segments: createPolyline(
        [
          { x: -0.5, y: 0 },
          { x: 0.5, y: 0 },
        ],
        RAIL_MATERIAL,
      ),
    });
    const y = BALL_RADIUS_M;
    const striker = addBall(world, { x: -0.05, y, vx: 0.5 });
    const middle = addBall(world, { x: 0, y });
    const end = addBall(world, { x: TOUCH_M, y });
    for (let i = 0; i < steps(0.3); i++) stepWorld(world);
    // The far ball takes most of the speed; the striker nearly stops.
    expect(end.vx).toBeGreaterThan(0.35);
    expect(Math.abs(striker.vx)).toBeLessThan(0.1);
    expect(Math.abs(middle.vx)).toBeLessThan(0.1);
    expect(minPairGapM(world)).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
    for (const b of world.balls) expect(b.y).toBeGreaterThanOrEqual(y - CONTACT_SLOP_M);
  });

  it('roll a train of touching balls down a slope together, without stalling', () => {
    // The out-hole floor's slope on the classic board, about 15°.
    const slope = Math.atan2(0.0265, 0.0975);
    const world = createWorld({
      ballCollisions: true,
      segments: createPolyline(
        [
          { x: 0, y: 0 },
          { x: -0.4, y: -0.4 * Math.tan(slope) },
        ],
        RAIL_MATERIAL,
      ),
    });
    const lift = BALL_RADIUS_M / Math.cos(slope) + 1e-4;
    for (let k = 0; k < 3; k++) {
      const x = -0.05 - k * 1.0001 * TOUCH_M * Math.cos(slope);
      addBall(world, { x, y: x * Math.tan(slope) + lift });
    }
    for (let i = 0; i < steps(0.5); i++) stepWorld(world);
    // Frictionless rolling down a 15° slope: about g·sin(15°)·t = 1.3 m/s after 0.5 s.
    for (const b of world.balls) expect(Math.hypot(b.vx, b.vy)).toBeGreaterThan(1);
    expect(minPairGapM(world)).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
  });

  it('roll a ball lying on another down a slope with it, without jamming', () => {
    // The state that once jammed the classic board's out-hole floor: one
    // ball rolling down the 15° floor, a second landing on its upper side.
    // Resolving floor and ball contacts in turn ran both out of impacts
    // every step, and they stopped for good.
    // Recorded from a Monte Carlo run at power 0.2, seed 1 (balls 4270–4271).
    const world = createBoardWorld(classic);
    const lower = addBall(world, {
      x: 0.33751140827174986,
      y: 0.06407269175437895,
      vx: -0.5519081402377676,
      vy: -0.13519167207143715,
    });
    const upper = addBall(world, {
      x: 0.3432766623725731,
      y: 0.07378002989623397,
      vx: -0.36951800002943497,
      vy: -0.28477684764860883,
    });
    let touched = false;
    for (let i = 0; i < steps(0.1); i++) {
      stepWorld(world);
      touched ||= minPairGapM(world) < 1e-6;
      expect(minPairGapM(world)).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
    }
    expect(touched).toBe(true);
    // Both still rolling downhill, faster than they started.
    expect(lower.vx).toBeLessThan(-0.55);
    expect(upper.vx).toBeLessThan(-0.37);
  });

  it('move balls that never touch exactly as with ball collisions off, near misses included', () => {
    // Two balls passing 1 mm apart at speed: close enough to move together
    // every step, never touching. Plus one far away.
    const run = (ballCollisions: boolean) => {
      const world = createWorld({ ballCollisions });
      addBall(world, { x: -0.02, y: TOUCH_M + 0.001, vx: 2, vy: 0 });
      addBall(world, { x: 0.02, y: 0, vx: -2, vy: 0 });
      addBall(world, { x: 1, y: 1, vx: 0.3 });
      const out: number[] = [];
      for (let i = 0; i < steps(0.05); i++) {
        stepWorld(world);
        out.push(...snapshot(world));
      }
      return out;
    };
    expectSameBits(run(true), run(false));
  });

  it('give the same result with the spatial hash as testing every pair, to the bit', () => {
    // 40 balls: above the size where the hash takes over from a direct check.
    const hashed = busyGrid(7, 40);
    const every = busyGrid(7, 40, { broadphase: false });
    expect(every.grid).toBeNull();
    for (let i = 0; i < steps(1); i++) {
      stepWorld(hashed);
      stepWorld(every);
      expectSameBits(snapshot(hashed), snapshot(every));
    }
  });

  it('give the same result with few balls, where pairs are checked directly', () => {
    const few = busyGrid(8, 5);
    const every = busyGrid(8, 5, { broadphase: false });
    for (let i = 0; i < steps(1); i++) {
      stepWorld(few);
      stepWorld(every);
      expectSameBits(snapshot(few), snapshot(every));
    }
  });

  it('keep no state between worlds: stepping two worlds in turn changes neither', () => {
    const alone = busyGrid(3, 12);
    const out: number[] = [];
    for (let i = 0; i < steps(0.5); i++) {
      stepWorld(alone);
      out.push(...snapshot(alone));
    }
    const a = busyGrid(3, 12);
    const other = busyGrid(4, 30);
    const interleaved: number[] = [];
    for (let i = 0; i < steps(0.5); i++) {
      stepWorld(other);
      stepWorld(a);
      interleaved.push(...snapshot(a));
    }
    expectSameBits(interleaved, out);
  });
});

describe('launching with ball collisions on', () => {
  it('waits while a ball sits at the launch point', () => {
    const world = createBoardWorld(classic);
    expect(launcherClear(world, classic)).toBe(true);
    const first = launchBall(world, classic, 0);
    expect(launcherClear(world, classic)).toBe(false);
    expect(() => launchBall(world, classic, 0)).toThrow(RangeError);
    // A few steps later the first ball has moved up the lane, out of the way.
    let waited = 0;
    while (!launcherClear(world, classic)) {
      stepWorld(world);
      waited += 1;
    }
    expect(waited).toBeGreaterThan(0);
    expect(waited).toBeLessThan(10);
    launchBall(world, classic, 0);
    expect(world.balls.map((b) => b.id)).toEqual([first.id, first.id + 1]);
  });
});
