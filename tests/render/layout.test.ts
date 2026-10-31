import { describe, expect, it } from 'vitest';
import { fitBoardIn } from '../../src/render/board';
import {
  MAX_OBSTACLES,
  type Rect,
  freeArea,
  overlaps,
  rectHeight,
  rectWidth,
  scaleIn,
} from '../../src/render/layout';

const W_M = 0.5;
const H_M = 0.53;
const M = 16;
const rect = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
});
const screen = (w: number, h: number) => rect(0, 0, w, h);

describe('rect helpers', () => {
  it('measure sizes, never negative', () => {
    expect(rectWidth(rect(10, 0, 30, 5))).toBe(20);
    expect(rectHeight(rect(0, 10, 5, 4))).toBe(0);
  });

  it('count shared area as overlap, touching edges not', () => {
    expect(overlaps(rect(0, 0, 10, 10), rect(5, 5, 15, 15))).toBe(true);
    expect(overlaps(rect(0, 0, 10, 10), rect(10, 0, 20, 10))).toBe(false);
    expect(overlaps(rect(0, 0, 10, 10), rect(0, 10, 10, 20))).toBe(false);
  });

  it('scaleIn keeps the margin and is never negative', () => {
    expect(scaleIn(screen(390, 844), W_M, H_M, M)).toBeCloseTo(358 / W_M, 9);
    expect(scaleIn(screen(10, 10), W_M, H_M, M)).toBe(0);
    expect(scaleIn(rect(50, 50, 10, 10), W_M, H_M, M)).toBe(0);
  });
});

describe('freeArea', () => {
  it('is the whole viewport with no obstacles', () => {
    expect(freeArea(screen(390, 844), [], W_M, H_M, M)).toEqual(screen(390, 844));
  });

  it('ignores obstacles of no size or off the screen', () => {
    const area = freeArea(
      screen(390, 844),
      [rect(10, 10, 10, 50), rect(400, 0, 500, 100), rect(0, -80, 100, 0)],
      W_M,
      H_M,
      M,
    );
    expect(area).toEqual(screen(390, 844));
  });

  it('portrait: fits between the top bar and the bottom controls', () => {
    // 375×667 phone: reel and ball count at the top, buttons and handle at the bottom.
    const reel = rect(103, 8, 235, 80);
    const hud = rect(253, 8, 359, 49);
    const buttons = rect(16, 503, 130, 651);
    const handle = rect(247, 539, 359, 651);
    const area = freeArea(screen(375, 667), [reel, hud, buttons, handle], W_M, H_M, M);
    expect(area).toEqual(rect(0, 80, 375, 503));
    // The board is as wide as the screen allows: the bands don't shrink it.
    expect(scaleIn(area, W_M, H_M, M)).toBeCloseTo((375 - 32) / W_M, 9);
  });

  it('landscape: fits between the side columns at full height', () => {
    const panel = rect(16, 16, 296, 700);
    const buttons = rect(16, 716, 296, 784);
    const reel = rect(1132, 16, 1264, 88);
    const handle = rect(1152, 672, 1264, 784);
    const area = freeArea(screen(1280, 800), [panel, buttons, reel, handle], W_M, H_M, M);
    expect(area).toEqual(rect(296, 0, 1132, 800));
    expect(scaleIn(area, W_M, H_M, M)).toBeCloseTo((800 - 32) / H_M, 9);
  });

  it('picks whichever side of an obstacle leaves the bigger board', () => {
    // A box in the top-left corner: going below it costs 100 px of height;
    // going right of it costs 40 px of width on a width-limited screen.
    const box = rect(0, 0, 40, 100);
    const area = freeArea(screen(400, 1000), [box], W_M, H_M, M);
    // Width-limited either way below it (400 wide, 900 tall): below wins.
    expect(area).toEqual(rect(0, 100, 400, 1000));
    // On a squat screen, height is what counts: right of it wins.
    const squat = freeArea(screen(1000, 400), [box], W_M, H_M, M);
    expect(squat).toEqual(rect(40, 0, 1000, 400));
  });

  it('finds the best of several cuts, not just the greedy first one', () => {
    // A strip across the top and a block low on the right. Clearing the
    // block by going above it would also have to clear the strip; going
    // left of it keeps the height.
    const strip = rect(0, 0, 600, 30);
    const block = rect(500, 300, 600, 600);
    const area = freeArea(screen(600, 600), [strip, block], W_M, H_M, M);
    const best = scaleIn(area, W_M, H_M, M);
    expect(area).toEqual(rect(0, 30, 500, 600));
    for (const other of [rect(0, 30, 600, 300), rect(0, 0, 500, 600)]) {
      const clear = [strip, block].every((o) => !overlaps(o, other));
      if (clear) expect(scaleIn(other, W_M, H_M, M)).toBeLessThanOrEqual(best);
    }
  });

  it('never returns an area that overlaps an obstacle', () => {
    // Deterministic pseudo-random boxes round the edges of many screens.
    let s = 12345;
    const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32;
    for (let trial = 0; trial < 200; trial++) {
      const w = 300 + Math.floor(rnd() * 1200);
      const h = 300 + Math.floor(rnd() * 1200);
      const obstacles: Rect[] = [];
      for (let k = 0; k < 8; k++) {
        const bw = 20 + rnd() * 200;
        const bh = 20 + rnd() * 150;
        const x = rnd() < 0.5 ? rnd() * 40 : w - bw - rnd() * 40;
        const y = rnd() * (h - bh);
        obstacles.push(rect(x, y, x + bw, y + bh));
      }
      const area = freeArea(screen(w, h), obstacles, W_M, H_M, M);
      for (const o of obstacles) expect(overlaps(o, area)).toBe(false);
      const bv = fitBoardIn(area, W_M, H_M, M);
      const board = rect(bv.ox, bv.oy - H_M * bv.scale, bv.ox + W_M * bv.scale, bv.oy);
      for (const o of obstacles) expect(overlaps(o, board)).toBe(false);
    }
  });

  it('copes with obstacles covering the whole screen: a board of no size', () => {
    const area = freeArea(screen(400, 400), [screen(400, 400)], W_M, H_M, M);
    expect(scaleIn(area, W_M, H_M, M)).toBe(0);
  });

  it('ignores obstacles past MAX_OBSTACLES', () => {
    const many = Array.from({ length: MAX_OBSTACLES }, (_, i) => rect(0, i, 1, i + 1));
    const late = rect(0, 0, 400, 500);
    const area = freeArea(screen(400, 1000), [...many, late], W_M, H_M, M);
    expect(overlaps(area, late)).toBe(true);
  });

  it('is fast enough to run on every resize with a page of controls', () => {
    const obstacles = Array.from({ length: 12 }, (_, i) =>
      rect(i % 2 ? 1180 : 0, i * 60, i % 2 ? 1280 : 100, i * 60 + 50),
    );
    const t0 = performance.now();
    freeArea(screen(1280, 800), obstacles, W_M, H_M, M);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('fitBoardIn', () => {
  it('centres the board in the area', () => {
    const bv = fitBoardIn(rect(100, 80, 475, 503), W_M, H_M, M);
    expect(bv.scale).toBeCloseTo(343 / W_M, 9);
    expect(bv.ox + (W_M * bv.scale) / 2).toBeCloseTo(287.5, 9);
    expect(bv.oy - (H_M * bv.scale) / 2).toBeCloseTo(291.5, 9);
  });
});
