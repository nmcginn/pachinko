import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBoardWorld, parseBoard } from '../../src/sim/board';
import { type Candidates, createStaticGrid, queryGrid } from '../../src/sim/broadphase';
import { CONTACT_SLOP_M } from '../../src/sim/collide';
import { createRng } from '../../src/sim/rng';
import {
  type World,
  BALL_RADIUS_M,
  MAX_LAUNCH_SPEED_MPS,
  SIM_STEP_S,
  addBall,
  createWorld,
  stepWorld,
} from '../../src/sim/world';
import { GRID_DROP_Y_M, GRID_WIDTH_M, gridWorld } from './scenes';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));

describe('static grid', () => {
  it('is null for a world with no geometry', () => {
    expect(createStaticGrid([], [], BALL_RADIUS_M)).toBeNull();
    expect(createWorld().grid).toBeNull();
  });

  it('is built by default and skipped on request', () => {
    expect(createBoardWorld(classic).grid).not.toBeNull();
    expect(gridWorld().grid).not.toBeNull();
    expect(createWorld({ broadphase: false }).grid).toBeNull();
  });

  it('lists every shape a ball centre within reach could touch, once, in ascending order', () => {
    const world = createBoardWorld(classic);
    const grid = world.grid;
    if (!grid) throw new Error('no grid');
    const reach = BALL_RADIUS_M + CONTACT_SLOP_M;
    const rng = createRng(3);
    const out: Candidates = { circles: [], segments: [] };
    for (let i = 0; i < 20000; i++) {
      const x0 = rng.range(-0.02, classic.widthM + 0.02);
      const y0 = rng.range(-0.02, classic.heightM + 0.02);
      // Moves up to several cells long, so multi-cell queries get exercised.
      const x1 = x0 + rng.range(-0.05, 0.05);
      const y1 = y0 + rng.range(-0.05, 0.05);
      queryGrid(grid, x0, y0, x1, y1, out);
      const circles = [...out.circles];
      const segments = [...out.segments];
      expect(circles).toEqual([...new Set(circles)].sort((a, b) => a - b));
      expect(segments).toEqual([...new Set(segments)].sort((a, b) => a - b));
      // Any shape within reach of either endpoint must be a candidate.
      for (const [x, y] of [
        [x0, y0],
        [x1, y1],
      ] as const) {
        world.circles.forEach((c, k) => {
          if (Math.hypot(x - c.x, y - c.y) <= c.radiusM + reach) expect(circles).toContain(k);
        });
        world.segments.forEach((s, k) => {
          const along = Math.min(s.lengthM, Math.max(0, (x - s.ax) * s.ux + (y - s.ay) * s.uy));
          const d = Math.hypot(x - (s.ax + s.ux * along), y - (s.ay + s.uy * along));
          if (d <= reach) expect(segments).toContain(k);
        });
      }
    }
  });

  it('returns nothing for a move entirely outside the indexed area, or a NaN one', () => {
    const grid = createBoardWorld(classic).grid;
    if (!grid) throw new Error('no grid');
    const out: Candidates = { circles: [0], segments: [0] };
    queryGrid(grid, 5, 5, 5.1, 5.1, out);
    expect([out.circles, out.segments]).toEqual([[], []]);
    queryGrid(grid, NaN, 0.2, 0.2, 0.2, out);
    expect([out.circles, out.segments]).toEqual([[], []]);
  });
});

describe('broadphase gives bit-identical results to testing every shape', () => {
  function trace(world: World): number[] {
    const out: number[] = [];
    for (let i = 0; i < Math.round(3 / SIM_STEP_S); i++) {
      stepWorld(world);
      for (const b of world.balls) out.push(b.id, b.x, b.y, b.vx, b.vy);
      for (const c of world.captures) out.push(-c.ball.id);
    }
    return out;
  }

  function expectIdentical(a: number[], b: number[]): void {
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) throw new Error(`diverged at ${i}: ${a[i]} vs ${b[i]}`);
    }
  }

  function spray(world: World, seed: number, region: [number, number, number, number]): void {
    const rng = createRng(seed);
    for (let tries = 0; world.balls.length < 12 && tries < 200; tries++) {
      const angle = rng.range(0, 2 * Math.PI);
      const speed = rng.range(0, MAX_LAUNCH_SPEED_MPS);
      try {
        addBall(world, {
          x: rng.range(region[0], region[2]),
          y: rng.range(region[1], region[3]),
          vx: speed * Math.cos(angle),
          vy: speed * Math.sin(angle),
        });
      } catch {
        // Landed on a nail; try again. Same seed, same retries, in both worlds.
      }
    }
  }

  it('on the classic board', () => {
    const make = (broadphase: boolean) => {
      const base = createBoardWorld(classic);
      const world = createWorld({
        circles: base.circles,
        segments: base.segments,
        sensors: base.sensors,
        ...(base.bounds ? { bounds: base.bounds } : {}),
        broadphase,
      });
      spray(world, 9, [0.08, 0.1, 0.42, 0.45]);
      return world;
    };
    const fast = make(true);
    const brute = make(false);
    expect(fast.balls.length).toBe(12);
    expectIdentical(trace(fast), trace(brute));
  });

  it('in the closed 10×10 grid', () => {
    const make = (broadphase: boolean) => {
      const base = gridWorld({ closed: true });
      const world = createWorld({ circles: base.circles, segments: base.segments, broadphase });
      spray(world, 4, [0.01, GRID_DROP_Y_M - 0.01, GRID_WIDTH_M - 0.01, GRID_DROP_Y_M + 0.02]);
      return world;
    };
    expectIdentical(trace(make(true)), trace(make(false)));
  });
});
