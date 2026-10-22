// Nail glints (M6): which nail a ball just struck, worked out from the
// world after each step without changing it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTable, stepTable } from '../../src/game/table';
import {
  GLINT_FULL_KICK_MPS,
  GLINT_STEPS,
  collectGlints,
  createGlints,
  glintLevel,
} from '../../src/render/glints';
import { parseBoard } from '../../src/sim/board';
import { createCircle } from '../../src/sim/collide';
import { createRng } from '../../src/sim/rng';
import {
  BALL_RADIUS_M,
  MAX_LAUNCH_SPEED_MPS,
  NAIL_MATERIAL,
  NAIL_RADIUS_M,
  type World,
  addBall,
  createWorld,
  stepWorld,
} from '../../src/sim/world';
import { dropBall, gridWorld } from '../sim/scenes';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
/** The classic board's best power (PLAN.md Status). */
const BEST_POWER = 0.2;

const nail = (x: number, y: number) => createCircle({ x, y }, NAIL_RADIUS_M, NAIL_MATERIAL);
const contact = BALL_RADIUS_M + NAIL_RADIUS_M;

/** Step the world `n` times, collecting glints; returns, per step, the nails that started glinting. */
function run(world: World, n: number, glints = createGlints(world)): number[][] {
  const started: number[][] = [];
  for (let s = 0; s < n; s++) {
    stepWorld(world);
    collectGlints(glints, world);
    const now: number[] = [];
    glints.startStep.forEach((step, i) => {
      if (step === world.steps) now.push(i);
    });
    started.push(now);
  }
  return started;
}

describe('collectGlints', () => {
  it('glints the nail a dropped ball strikes, at the step it strikes, then fades out', () => {
    // Nails 0 and 2 are decoys either side; the ball falls onto nail 1, just off centre.
    const world = createWorld({ circles: [nail(-0.03, 0), nail(0, 0), nail(0.03, 0)] });
    const glints = createGlints(world);
    const ball = addBall(world, { x: 0.002, y: 0.05 });
    let hitStep = -1;
    for (let s = 0; s < 400 && hitStep < 0; s++) {
      const vyBefore = ball.vy;
      stepWorld(world);
      collectGlints(glints, world);
      if (ball.vy > vyBefore) hitStep = world.steps;
    }
    expect(hitStep).toBeGreaterThan(0);
    expect(glints.startStep[1]).toBe(hitStep);
    expect(glints.startStep[0]).toBe(-Infinity);
    expect(glints.startStep[2]).toBe(-Infinity);
    // About 1 m/s at impact, from 5 cm up: a strong glint, not a full one.
    const level = glintLevel(glints, 1, hitStep);
    expect(level).toBeGreaterThan(0.3);
    expect(level).toBeLessThan(1);
    expect(glintLevel(glints, 1, hitStep - 1)).toBe(0);
    expect(glintLevel(glints, 1, hitStep + GLINT_STEPS / 2)).toBeCloseTo(level / 2, 9);
    expect(glintLevel(glints, 1, hitStep + GLINT_STEPS)).toBe(0);
    expect(glintLevel(glints, 0, hitStep)).toBe(0);
  });

  it('glints at full strength for a ball at max launch speed', () => {
    const world = createWorld({ circles: [nail(0.05, 0)] });
    const glints = createGlints(world);
    addBall(world, { x: 0, y: 0.0005, vx: MAX_LAUNCH_SPEED_MPS });
    const started = run(world, 40, glints).flat();
    expect(started).toEqual([0]);
    expect(glints.strength[0]).toBe(1);
    // Well over full strength: max launch speed into a nail at e = 0.6.
    expect(MAX_LAUNCH_SPEED_MPS * 1.6).toBeGreaterThan(GLINT_FULL_KICK_MPS);
  });

  it('never glints for a ball at rest on nails', () => {
    // Two nails closer than a ball's width cradle it.
    const gap = 1.2 * BALL_RADIUS_M;
    const world = createWorld({ circles: [nail(-gap / 2, 0), nail(gap / 2, 0)] });
    const y = Math.sqrt(contact ** 2 - (gap / 2) ** 2);
    addBall(world, { x: 0, y });
    expect(run(world, 4000).flat()).toEqual([]);
  });

  it('does nothing with no balls, or no nails', () => {
    const empty = createWorld({ circles: [nail(0, 0)] });
    expect(run(empty, 100).flat()).toEqual([]);
    const bare = createWorld();
    const glints = createGlints(bare);
    addBall(bare, { x: 0, y: 0, vx: 1 });
    expect(() => run(bare, 100, glints)).not.toThrow();
    expect(glints.startStep).toHaveLength(0);
    expect(glintLevel(glints, 0, 0)).toBe(0);
  });

  it('ignores a ball added since the last step until it has a velocity to compare', () => {
    const world = createWorld({ circles: [nail(0, 0)] });
    const glints = createGlints(world);
    // Already touching the nail and moving away fast: as if it had just bounced.
    addBall(world, { x: 0, y: contact + 1e-6, vy: 2 });
    stepWorld(world);
    collectGlints(glints, world);
    expect(glints.startStep[0]).toBe(-Infinity);
  });

  it('only glints on steps that had an impact, and catches most nail impacts', () => {
    // The M1 grid: nails and two side walls, one ball at a time.
    const rng = createRng(5);
    let impactSteps = 0;
    let caught = 0;
    for (let drop = 0; drop < 20; drop++) {
      const world = gridWorld();
      const glints = createGlints(world);
      const ball = dropBall(world, rng);
      for (let s = 0; s < 20000 && world.balls.includes(ball); s++) {
        stepWorld(world);
        collectGlints(glints, world);
        const glinted = glints.startStep.some((step) => step === world.steps);
        if (glinted) expect(world.impactSpeedMps).toBeGreaterThan(0);
        if (world.impactSpeedMps >= 0.5) {
          impactSteps += 1;
          if (glinted) caught += 1;
        }
      }
    }
    expect(impactSteps).toBeGreaterThan(50);
    // Misses are wall hits and the odd step with two impacts at once.
    expect(caught / impactSteps).toBeGreaterThan(0.9);
  });

  it('is the same with and without the broadphase grid', () => {
    const glintsOf = (broadphase: boolean) => {
      const base = gridWorld();
      const world = createWorld({ circles: base.circles, segments: base.segments, broadphase });
      dropBall(world, createRng(9));
      return run(world, 6000);
    };
    const withGrid = glintsOf(true);
    expect(withGrid.flat().length).toBeGreaterThan(5);
    expect(glintsOf(false)).toEqual(withGrid);
  });

  it('is deterministic on the classic board, and forgets balls that leave', () => {
    const play = () => {
      const table = createTable(classic, { seed: 3 });
      table.fire.power = BEST_POWER;
      table.fire.held = true;
      const glints = createGlints(table.world);
      const log: number[] = [];
      for (let s = 0; s < 20000; s++) {
        stepTable(table);
        collectGlints(glints, table.world);
        glints.startStep.forEach((step, i) => {
          if (step === table.world.steps) log.push(table.world.steps, i);
        });
        expect(glints.velocity.size).toBe(table.world.balls.length);
      }
      return log;
    };
    const first = play();
    // Ten seconds of play: balls bounce down the field, striking many nails.
    expect(new Set(first.filter((_, i) => i % 2 === 1)).size).toBeGreaterThan(30);
    expect(play()).toEqual(first);
  });
});
