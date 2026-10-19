import { describe, expect, it } from 'vitest';
import { interpolate } from '../../src/render/balls';
import { fitBoard } from '../../src/render/board';
import { addBall, createWorld, stepWorld } from '../../src/sim/world';

describe('fitBoard', () => {
  it('fits a portrait board to the height of a landscape canvas, centred', () => {
    const v = fitBoard(1280, 800, 0.5, 0.53, 16);
    expect(v.scale).toBeCloseTo(768 / 0.53, 9);
    // Board bottom-left (0, 0) maps to the bottom margin; top-right to the top margin.
    expect(v.oy).toBeCloseTo(800 - 16, 9);
    expect(v.oy - 0.53 * v.scale).toBeCloseTo(16, 9);
    expect(v.ox + (0.5 * v.scale) / 2).toBeCloseTo(640, 9);
  });

  it('fits to the width of a narrow portrait canvas', () => {
    const v = fitBoard(390, 844, 0.5, 0.53, 16);
    expect(v.scale).toBeCloseTo(358 / 0.5, 9);
    expect(v.ox).toBeCloseTo(16, 9);
  });

  it('never goes negative on a canvas smaller than its margins', () => {
    expect(fitBoard(10, 10, 0.5, 0.53, 16).scale).toBe(0);
  });
});

describe('interpolate', () => {
  it('runs from the previous position at alpha 0 to the current one at alpha 1', () => {
    const world = createWorld();
    const ball = addBall(world, { x: 0, y: 0, vx: 2, vy: 1 });
    stepWorld(world);
    expect(interpolate(ball, 0)).toEqual({ x: ball.prevX, y: ball.prevY });
    const end = interpolate(ball, 1);
    expect(end.x).toBeCloseTo(ball.x, 15);
    expect(end.y).toBeCloseTo(ball.y, 15);
    const mid = interpolate(ball, 0.5);
    expect(mid.x).toBeCloseTo((ball.prevX + ball.x) / 2, 15);
  });

  it('draws a ball that has not stepped yet at its spawn point', () => {
    const ball = addBall(createWorld(), { x: 0.1, y: 0.2, vx: 3 });
    expect(interpolate(ball, 0.7)).toEqual({ x: 0.1, y: 0.2 });
  });
});
