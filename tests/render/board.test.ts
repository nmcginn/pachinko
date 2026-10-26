import { describe, expect, it } from 'vitest';
import { interpolate, spriteSizePx } from '../../src/render/balls';
import { boardPointM, fitBoard } from '../../src/render/board';
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

  it('fits below a top band, centred in the space left', () => {
    const v = fitBoard(1280, 800, 0.5, 0.53, 16, 84);
    expect(v.scale).toBeCloseTo((800 - 84 - 32) / 0.53, 9);
    // Top of the board sits just under the band, bottom at the bottom margin.
    expect(v.oy - 0.53 * v.scale).toBeCloseTo(84 + 16, 9);
    expect(v.oy).toBeCloseTo(800 - 16, 9);
    // On a tall narrow canvas, width-limited: the board centres in what's below the band.
    const p = fitBoard(390, 844, 0.5, 0.53, 16, 84);
    expect(p.scale).toBeCloseTo(358 / 0.5, 9);
    expect((p.oy + (p.oy - 0.53 * p.scale)) / 2).toBeCloseTo(84 + (844 - 84) / 2, 9);
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

describe('spriteSizePx', () => {
  it('fits the ball at the device ratio, with a pixel spare each side', () => {
    expect(spriteSizePx(8, 1)).toBe(18);
    expect(spriteSizePx(8, 2)).toBe(34);
    // Rounds up, so a fractional radius never clips the rim.
    expect(spriteSizePx(7.97, 2)).toBe(34);
    expect(spriteSizePx(1.5, 1.25)).toBe(6);
  });
});

describe('boardPointM', () => {
  it('inverts the view: a board point drawn at (px, py) maps back to itself', () => {
    const bv = fitBoard(1280, 800, 0.5, 0.53, 16, 84);
    for (const [x, y] of [
      [0, 0],
      [0.5, 0.53],
      [0.2573, 0.178],
    ] as const) {
      const p = boardPointM(bv, bv.ox + x * bv.scale, bv.oy - y * bv.scale);
      expect(p.x).toBeCloseTo(x, 12);
      expect(p.y).toBeCloseTo(y, 12);
    }
    // Above the board on screen is higher y; outside it, outside the board.
    expect(boardPointM(bv, bv.ox, bv.oy - 10).y).toBeGreaterThan(0);
    expect(boardPointM(bv, 0, 0).x).toBeLessThan(0);
  });
});
