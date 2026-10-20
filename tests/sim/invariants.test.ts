// The physics invariants from PLAN.md ("Invariants the tests must check"),
// plus the M1 acceptance scene. Never weaken or delete these: if one looks
// wrong, that is a [BLOCKED] PR, not an edit (CLAUDE.md).

import { describe, expect, it } from 'vitest';
import { type Material, CONTACT_SLOP_M, createCircle, createPolyline } from '../../src/sim/collide';
import { createBoardWorld, parseBoard } from '../../src/sim/board';
import { createRng } from '../../src/sim/rng';
import {
  type Ball,
  type World,
  BALL_RADIUS_M,
  MAX_LAUNCH_SPEED_MPS,
  NAIL_MATERIAL,
  NAIL_RADIUS_M,
  RAIL_MATERIAL,
  SIM_STEP_S,
  addBall,
  ballEnergyJ,
  createWorld,
  overlapsBall,
  setGateOpen,
  stepWorld,
  totalEnergyJ,
} from '../../src/sim/world';
import { TULIP_MOUTH_Y_M, TULIP_X_M, tulipBoardData } from '../fixtures/tulipBoard';
import {
  GRID_DROP_Y_M,
  GRID_EXIT_Y_M,
  GRID_WIDTH_M,
  gridWorld,
  pocketWorld,
  runGridDrop,
} from './scenes';

const steps = (simS: number) => Math.round(simS / SIM_STEP_S);

/** Distance from the ball centre to the nearest nail surface or rail, minus the ball radius. */
function clearanceM(world: World, x: number, y: number): number {
  let min = Infinity;
  for (const c of world.circles) {
    min = Math.min(min, Math.hypot(x - c.x, y - c.y) - c.radiusM - BALL_RADIUS_M);
  }
  for (const s of world.segments) {
    const along = Math.min(s.lengthM, Math.max(0, (x - s.ax) * s.ux + (y - s.ay) * s.uy));
    min = Math.min(
      min,
      Math.hypot(x - (s.ax + s.ux * along), y - (s.ay + s.uy * along)) - BALL_RADIUS_M,
    );
  }
  return min;
}

describe('invariant: mechanical energy never increases without launch input', () => {
  // Every ball, every step, compared exactly: no tolerance. Drag and the
  // integrator's own gravity term make free flight strictly lose energy, and
  // contacts can only dissipate (PHYSICS.md, "Energy and the resting threshold").
  const materials: [string, Material, Material][] = [
    ['default materials', NAIL_MATERIAL, RAIL_MATERIAL],
    [
      'near-elastic, frictionless',
      { restitution: 0.95, friction: 0 },
      { restitution: 0.95, friction: 0 },
    ],
    ['dead and grippy', { restitution: 0, friction: 1 }, { restitution: 0, friction: 1 }],
  ];

  for (const [name, nail, rail] of materials) {
    it(`holds per ball per step through the grid (${name})`, () => {
      const rng = createRng(11);
      let checked = 0;
      for (let trial = 0; trial < 8; trial++) {
        // Closed with a lid and a V floor, so the run covers fast impacts,
        // rolling, and settling, and every ball stays in play throughout.
        const world = gridWorld({ nailMaterial: nail, railMaterial: rail, closed: true });
        for (let k = 0; k < 4; k++) {
          const angle = rng.range(0, 2 * Math.PI);
          const speed = rng.range(0, MAX_LAUNCH_SPEED_MPS);
          addBall(world, {
            x: rng.range(0.02, GRID_WIDTH_M - 0.02),
            y: GRID_DROP_Y_M + rng.range(0, 0.02),
            vx: speed * Math.cos(angle),
            vy: speed * Math.sin(angle),
          });
        }
        for (let i = 0; i < steps(3); i++) {
          const before = world.balls.map(ballEnergyJ);
          stepWorld(world);
          world.balls.forEach((b, j) => {
            const e0 = before[j] as number;
            const e1 = ballEnergyJ(b);
            if (!(e1 <= e0)) {
              throw new Error(`energy rose by ${e1 - e0} J on step ${i}, ball ${b.id} (${name})`);
            }
            checked++;
          });
        }
        expect(world.balls.length).toBe(4);
      }
      expect(checked).toBe(8 * 4 * steps(3));
    });
  }

  it('holds in free flight, where drag and the integrator strictly remove energy', () => {
    const world = createWorld();
    addBall(world, { x: 0, y: 0, vx: MAX_LAUNCH_SPEED_MPS, vy: MAX_LAUNCH_SPEED_MPS });
    let previous = totalEnergyJ(world);
    for (let i = 0; i < steps(2); i++) {
      stepWorld(world);
      const now = totalEnergyJ(world);
      expect(now).toBeLessThan(previous);
      previous = now;
    }
  });

  it('is trivially zero for an empty world', () => {
    const world = gridWorld();
    for (let i = 0; i < 100; i++) stepWorld(world);
    expect(totalEnergyJ(world)).toBe(0);
  });
});

describe('invariant: no tunnelling at launch speed', () => {
  it('keeps max launch speed under one ball radius per step (PLAN.md)', () => {
    expect(MAX_LAUNCH_SPEED_MPS * SIM_STEP_S).toBeLessThan(BALL_RADIUS_M);
  });

  // Sweep past max launch speed: the collision test is swept, so even a
  // ball covering several radii per step must not get through.
  const speeds = [0.25, 0.5, 1, 2, 3, 4, MAX_LAUNCH_SPEED_MPS, 2 * MAX_LAUNCH_SPEED_MPS, 50];

  it('never lets a ball through or into a single nail, across speeds and offsets', () => {
    for (const speed of speeds) {
      for (let k = -10; k <= 10; k++) {
        const offset = (k / 10) * (BALL_RADIUS_M + NAIL_RADIUS_M);
        const world = createWorld({
          circles: [createCircle({ x: 0, y: 0 }, NAIL_RADIUS_M, NAIL_MATERIAL)],
        });
        // Fired horizontally from 1 mm short of contact, so gravity barely
        // bends the path even at the slowest speed.
        const ball = addBall(world, {
          x: -(BALL_RADIUS_M + NAIL_RADIUS_M + 0.001),
          y: offset,
          vx: speed,
        });
        for (let i = 0; i < steps(0.1); i++) {
          stepWorld(world);
          expect(clearanceM(world, ball.x, ball.y)).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
        }
        if (Math.abs(offset) < 0.5 * (BALL_RADIUS_M + NAIL_RADIUS_M)) {
          // A near head-on shot must bounce back, not come out the far side.
          expect(ball.x).toBeLessThan(0);
        }
      }
    }
  });

  it('never lets a ball through a zero-thickness rail, across speeds and angles', () => {
    for (const speed of speeds) {
      for (let deg = 5; deg <= 175; deg += 10) {
        const world = createWorld({
          segments: createPolyline(
            [
              { x: -1, y: 0 },
              { x: 1, y: 0 },
            ],
            RAIL_MATERIAL,
          ),
        });
        const a = (-deg * Math.PI) / 180;
        // Start just above the rail, heading down into it.
        const ball = addBall(world, {
          x: 0,
          y: BALL_RADIUS_M + 0.002,
          vx: speed * Math.cos(a),
          vy: speed * Math.sin(a),
        });
        for (let i = 0; i < steps(0.05); i++) {
          stepWorld(world);
          expect(ball.y).toBeGreaterThanOrEqual(BALL_RADIUS_M - CONTACT_SLOP_M);
        }
      }
    }
  });

  it('never overlaps a nail when fired through the grid at max launch speed', () => {
    const rng = createRng(5);
    for (let trial = 0; trial < 40; trial++) {
      // Closed, so a ball bouncing high off a nail can't leave over the walls.
      const world = gridWorld({ closed: true });
      const angle = rng.range(-Math.PI, 0); // downward into the grid
      const ball = addBall(world, {
        x: rng.range(0.02, GRID_WIDTH_M - 0.02),
        y: GRID_DROP_Y_M,
        vx: MAX_LAUNCH_SPEED_MPS * Math.cos(angle),
        vy: MAX_LAUNCH_SPEED_MPS * Math.sin(angle),
      });
      for (let i = 0; i < steps(1); i++) {
        stepWorld(world);
        expect(clearanceM(world, ball.x, ball.y)).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
        expect(ball.x).toBeGreaterThan(0);
        expect(ball.x).toBeLessThan(GRID_WIDTH_M);
        expect(ball.y).toBeGreaterThan(GRID_EXIT_Y_M - 0.03);
        expect(ball.y).toBeLessThan(GRID_DROP_Y_M + 0.06);
      }
      expect(world.balls).toEqual([ball]);
    }
  });
});

describe('invariant: a resting ball stays put, with no jitter or creep', () => {
  /** Let the ball settle, then require it to be exactly still for 10 s of sim time. */
  function expectRests(world: World, settleS = 3): void {
    const ball = world.balls[0];
    if (!ball) throw new Error('scene has no ball');
    for (let i = 0; i < steps(settleS); i++) stepWorld(world);
    const x = ball.x;
    const y = ball.y;
    for (let i = 0; i < steps(10); i++) {
      stepWorld(world);
      expect(ball.x).toBe(x);
      expect(ball.y).toBe(y);
      expect(ball.vx).toBe(0);
      expect(ball.vy).toBe(0);
    }
  }

  it('on a flat ledge', () => {
    const world = createWorld({
      segments: createPolyline(
        [
          { x: -0.05, y: 0 },
          { x: 0.05, y: 0 },
        ],
        RAIL_MATERIAL,
      ),
    });
    addBall(world, { x: 0.001, y: BALL_RADIUS_M + 0.01 });
    expectRests(world);
  });

  it('in a V pocket, dropped in off-centre', () => {
    const world = pocketWorld();
    addBall(world, { x: 0.008, y: 0.025, vx: -0.2 });
    expectRests(world);
    const ball = world.balls[0];
    // Settled at the bottom of the V, touching both sides.
    expect(Math.abs(ball?.x ?? NaN)).toBeLessThan(1e-3);
  });

  it('cradled on two nails closer together than a ball', () => {
    const gap = 0.008; // centre spacing; the 11 mm ball cannot pass
    const world = createWorld({
      circles: [
        createCircle({ x: -gap / 2, y: 0 }, NAIL_RADIUS_M, NAIL_MATERIAL),
        createCircle({ x: gap / 2, y: 0 }, NAIL_RADIUS_M, NAIL_MATERIAL),
      ],
    });
    // Set down just off-centre, a hair above where it will sit.
    const sitY = Math.sqrt((BALL_RADIUS_M + NAIL_RADIUS_M) ** 2 - (gap / 2) ** 2);
    addBall(world, { x: 0.0005, y: sitY + 0.001 });
    expectRests(world);
    expect(world.balls[0]?.y).toBeCloseTo(sitY, 6);
  });

  it('in a pocket, with every material from dead to near-elastic', () => {
    for (const restitution of [0, 0.4, 0.8, 0.95]) {
      const world = pocketWorld({ restitution, friction: 0.05 });
      addBall(world, { x: -0.01, y: 0.03 });
      expectRests(world, 8);
    }
  });
});

describe('invariant: determinism', () => {
  function runBusyGrid(seed: number): number[] {
    const rng = createRng(seed);
    const world = gridWorld();
    for (let k = 0; k < 5; k++) {
      addBall(world, {
        x: rng.range(0.02, GRID_WIDTH_M - 0.02),
        y: GRID_DROP_Y_M + rng.range(0, 0.05),
        vx: rng.range(-1, 1),
      });
    }
    const out: number[] = [];
    for (let i = 0; i < steps(2); i++) {
      stepWorld(world);
      for (const b of world.balls) out.push(b.id, b.x, b.y, b.vx, b.vy);
    }
    return out;
  }

  it('gives identical trajectories for the same seed', () => {
    const a = runBusyGrid(42);
    const b = runBusyGrid(42);
    expect(a.length).toBeGreaterThan(0);
    // Bit-for-bit: Object.is distinguishes even -0 from 0.
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) throw new Error(`runs diverge at index ${i}: ${a[i]} vs ${b[i]}`);
    }
  });

  it('gives different trajectories for different seeds', () => {
    expect(runBusyGrid(42)).not.toEqual(runBusyGrid(43));
  });
});

describe('M1 acceptance: one ball dropped through a 10×10 nail grid', () => {
  it('completes, and completes identically on a second run with the same seed', () => {
    const first = runGridDrop(1);
    const second = runGridDrop(1);
    expect(first.exitStep).not.toBeNull();
    expect(second.exitStep).toBe(first.exitStep);
    expect(second.trajectory).toEqual(first.trajectory);
  });

  it('completes for every one of 50 seeds, so no drop point gets stuck', () => {
    const exits = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      const run = runGridDrop(seed);
      expect(run.exitStep, `seed ${seed}`).not.toBeNull();
      exits.add(run.exitStep as number);
    }
    // The nails scatter the balls: different drop points take different paths.
    expect(exits.size).toBeGreaterThan(10);
  });
});

// M5: the same invariants with balls colliding with each other. Energy moves
// between balls in a collision, so the energy invariant is on the total, as
// PLAN.md states it; it is still checked every step with no tolerance.

/** The scene's nails and rails in a world with ball collisions on. */
function withBallCollisions(scene: World): World {
  return createWorld({
    circles: scene.circles,
    segments: scene.segments,
    ballCollisions: true,
    ...(scene.bounds ? { bounds: scene.bounds } : {}),
  });
}

/** Fill the world with `count` balls above the grid, at random speeds up to `maxSpeedMps` in any direction. */
function addManyBalls(world: World, seed: number, count: number, maxSpeedMps: number): void {
  const rng = createRng(seed);
  while (world.balls.length < count) {
    const x = rng.range(0.02, GRID_WIDTH_M - 0.02);
    const y = GRID_DROP_Y_M + rng.range(-0.01, 0.05);
    const angle = rng.range(0, 2 * Math.PI);
    const speed = rng.range(0, maxSpeedMps);
    if (overlapsBall(world, x, y)) continue;
    addBall(world, { x, y, vx: speed * Math.cos(angle), vy: speed * Math.sin(angle) });
  }
}

/** Closest any two balls come, centre to centre, minus a ball's diameter. */
function minPairGapM(world: World): number {
  let min = Infinity;
  const bs = world.balls;
  for (let a = 0; a < bs.length; a++) {
    for (let b = a + 1; b < bs.length; b++) {
      const p = bs[a] as Ball;
      const q = bs[b] as Ball;
      min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y) - 2 * BALL_RADIUS_M);
    }
  }
  return min;
}

describe('invariant with many balls colliding: total mechanical energy never increases', () => {
  const materials: [string, Material, Material][] = [
    ['default materials', NAIL_MATERIAL, RAIL_MATERIAL],
    [
      'near-elastic, frictionless',
      { restitution: 0.95, friction: 0 },
      { restitution: 0.95, friction: 0 },
    ],
    ['dead and grippy', { restitution: 0, friction: 1 }, { restitution: 0, friction: 1 }],
  ];

  for (const [name, nail, rail] of materials) {
    it(`holds every step for 30 balls in the closed grid (${name})`, () => {
      // Closed, so nothing leaves: the balls fly, collide, pile up in the V
      // floor, and settle, and the total covers every one of them throughout.
      const world = withBallCollisions(
        gridWorld({ nailMaterial: nail, railMaterial: rail, closed: true }),
      );
      addManyBalls(world, 11, 30, MAX_LAUNCH_SPEED_MPS);
      let previous = totalEnergyJ(world);
      for (let i = 0; i < steps(3); i++) {
        stepWorld(world);
        const now = totalEnergyJ(world);
        if (!(now <= previous)) {
          throw new Error(`total energy rose by ${now - previous} J on step ${i} (${name})`);
        }
        previous = now;
      }
      expect(world.balls.length).toBe(30);
    });
  }
});

describe('invariant with many balls colliding: no tunnelling at launch speed', () => {
  it('never lets a ball into a nail, a rail, or another ball, 30 balls at max launch speed', () => {
    for (const seed of [5, 6]) {
      const world = withBallCollisions(gridWorld({ closed: true }));
      const rng = createRng(seed);
      while (world.balls.length < 30) {
        const x = rng.range(0.02, GRID_WIDTH_M - 0.02);
        const y = GRID_DROP_Y_M + rng.range(-0.01, 0.05);
        const angle = rng.range(0, 2 * Math.PI);
        if (overlapsBall(world, x, y)) continue;
        addBall(world, {
          x,
          y,
          vx: MAX_LAUNCH_SPEED_MPS * Math.cos(angle),
          vy: MAX_LAUNCH_SPEED_MPS * Math.sin(angle),
        });
      }
      for (let i = 0; i < steps(1); i++) {
        stepWorld(world);
        expect(minPairGapM(world)).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
        for (const ball of world.balls) {
          expect(clearanceM(world, ball.x, ball.y)).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
          expect(ball.x).toBeGreaterThan(0);
          expect(ball.x).toBeLessThan(GRID_WIDTH_M);
        }
      }
      expect(world.balls.length).toBe(30);
    }
  });
});

describe('invariant with many balls colliding: a resting heap stays put', () => {
  it('in a walled V pocket, six balls dropped in come to rest and do not jitter or creep', () => {
    // The V pocket with tall walls on its rims, so no ball bounces out.
    const rim = pocketWorld().segments;
    const left = rim[0];
    const right = rim[rim.length - 1];
    if (!left || !right) throw new Error('pocket has no rails');
    const world = createWorld({
      ballCollisions: true,
      segments: [
        ...rim,
        ...createPolyline(
          [
            { x: left.ax, y: left.ay },
            { x: left.ax, y: 0.3 },
          ],
          RAIL_MATERIAL,
        ),
        ...createPolyline(
          [
            { x: right.bx, y: right.by },
            { x: right.bx, y: 0.3 },
          ],
          RAIL_MATERIAL,
        ),
      ],
    });
    for (let k = 0; k < 6; k++) {
      addBall(world, { x: -0.015 + 0.006 * k, y: 0.03 + 0.015 * k });
    }
    for (let i = 0; i < steps(5); i++) stepWorld(world);
    expect(world.balls).toHaveLength(6);
    // The balls rest against each other, not only on the rails.
    expect(minPairGapM(world)).toBeLessThan(1e-6);
    const settled = snapshotBalls(world);
    for (let i = 0; i < steps(10); i++) {
      stepWorld(world);
      expect(snapshotBalls(world)).toEqual(settled);
    }
    for (const ball of world.balls) {
      expect(ball.vx).toBe(0);
      expect(ball.vy).toBe(0);
    }
    expect(minPairGapM(world)).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
  });
});

describe('invariant with many balls colliding: determinism', () => {
  function runBusyGrid(seed: number): number[] {
    // Open at the bottom, so balls collide on the way down and leave.
    const world = withBallCollisions(gridWorld());
    addManyBalls(world, seed, 30, 1);
    const out: number[] = [];
    for (let i = 0; i < steps(2); i++) {
      stepWorld(world);
      out.push(...snapshotBalls(world));
    }
    return out;
  }

  it('gives identical trajectories for the same seed, with 30 balls', () => {
    const a = runBusyGrid(42);
    const b = runBusyGrid(42);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) throw new Error(`runs diverge at index ${i}: ${a[i]} vs ${b[i]}`);
    }
  });

  it('gives different trajectories for different seeds', () => {
    expect(runBusyGrid(42)).not.toEqual(runBusyGrid(43));
  });
});

function snapshotBalls(world: World): number[] {
  return world.balls.flatMap((b) => [b.id, b.x, b.y, b.vx, b.vy]);
}

// M5 tulips: the invariants with gate geometry switching on as well as off.
// A tulip's wings appear and disappear while balls fly round them; a switch
// may take a ball into the pocket (setGateOpen) but must never leave one
// inside geometry, and never add energy.

/** Clearance as clearanceM, counting only the segments solid now. */
function liveClearanceM(world: World, x: number, y: number): number {
  let min = Infinity;
  for (const c of world.circles) {
    min = Math.min(min, Math.hypot(x - c.x, y - c.y) - c.radiusM - BALL_RADIUS_M);
  }
  world.segments.forEach((s, i) => {
    if (world.segmentOff[i]) return;
    const along = Math.min(s.lengthM, Math.max(0, (x - s.ax) * s.ux + (y - s.ay) * s.uy));
    min = Math.min(
      min,
      Math.hypot(x - (s.ax + s.ux * along), y - (s.ay + s.uy * along)) - BALL_RADIUS_M,
    );
  });
  return min;
}

/** The tulip board's world with 30 balls in the field above and round the tulip, at random speeds up to `maxSpeedMps`. */
function tulipScene(seed: number, maxSpeedMps: number): World {
  const world = createBoardWorld(parseBoard(tulipBoardData()));
  const rng = createRng(seed);
  while (world.balls.length < 30) {
    const x = TULIP_X_M + rng.range(-0.035, 0.035);
    const y = TULIP_MOUTH_Y_M + rng.range(0.005, 0.15);
    const angle = rng.range(0, 2 * Math.PI);
    const speed = rng.range(0, maxSpeedMps);
    if (liveClearanceM(world, x, y) < 0 || overlapsBall(world, x, y)) continue;
    addBall(world, { x, y, vx: speed * Math.cos(angle), vy: speed * Math.sin(angle) });
  }
  return world;
}

/** Toggle the tulip every 20 ms, far more often than play does, so wings switch round balls in flight. */
const TOGGLE_STEPS = steps(0.02);

// The tunnelling check walks every ball every step: a few seconds, so a longer timeout.
describe(
  'invariant with tulips switching: energy, no tunnelling, determinism',
  { timeout: 30_000 },
  () => {
    it('never raises total energy, a switch included, 30 balls round a tulip', () => {
      for (const seed of [1, 2]) {
        const world = tulipScene(seed, 1);
        let previous = totalEnergyJ(world);
        for (let i = 0; i < steps(2); i++) {
          if (i % TOGGLE_STEPS === 0) {
            setGateOpen(world, 'tulip', !world.gates.find((g) => g.id === 'tulip')?.open);
            const now = totalEnergyJ(world);
            if (!(now <= previous))
              throw new Error(`a switch raised energy by ${now - previous} J`);
            previous = now;
          }
          stepWorld(world);
          const now = totalEnergyJ(world);
          if (!(now <= previous)) {
            throw new Error(`total energy rose by ${now - previous} J on step ${i} (seed ${seed})`);
          }
          previous = now;
        }
      }
    });

    it('never leaves a ball inside a wing, a nail, a rail or a ball, 30 balls at max launch speed', () => {
      let swept = 0;
      for (const seed of [3, 4]) {
        const world = tulipScene(seed, MAX_LAUNCH_SPEED_MPS);
        for (let i = 0; i < steps(1); i++) {
          if (i % TOGGLE_STEPS === 0) {
            swept += setGateOpen(
              world,
              'tulip',
              !world.gates.find((g) => g.id === 'tulip')?.open,
            ).length;
            for (const ball of world.balls) {
              expect(liveClearanceM(world, ball.x, ball.y)).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
            }
          }
          stepWorld(world);
          expect(minPairGapM(world)).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
          for (const ball of world.balls) {
            expect(liveClearanceM(world, ball.x, ball.y)).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
          }
        }
      }
      // The scene is busy enough that switching does land on balls, and takes them in.
      expect(swept).toBeGreaterThan(0);
    });

    it('gives identical trajectories for the same seed, wings switching', () => {
      const run = (seed: number) => {
        const world = tulipScene(seed, 1);
        const out: number[] = [];
        for (let i = 0; i < steps(1); i++) {
          if (i % TOGGLE_STEPS === 0) {
            for (const c of setGateOpen(world, 'tulip', !world.gates[world.gates.length - 1]?.open))
              out.push(-c.ball.id);
          }
          stepWorld(world);
          out.push(...snapshotBalls(world));
        }
        return out;
      };
      const a = run(9);
      const b = run(9);
      expect(a.length).toBeGreaterThan(0);
      expect(b.length).toBe(a.length);
      for (let i = 0; i < a.length; i++) {
        if (!Object.is(a[i], b[i]))
          throw new Error(`runs diverge at index ${i}: ${a[i]} vs ${b[i]}`);
      }
      expect(run(10)).not.toEqual(a);
    });
  },
);
