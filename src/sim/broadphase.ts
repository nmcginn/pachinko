// Spatial hash over static geometry: a uniform grid of cells, each listing
// the nails and rail segments that a ball centre inside the cell could touch.
//
// The step sweeps a ball only against the shapes in the cells its move
// overlaps. Candidate lists are in ascending shape index, the same order a
// brute-force pass visits them, and the world keeps the first earliest hit,
// so results are bit-for-bit identical to testing every shape (checked by
// test). Reused for ball–ball in M5.

import type { CircleShape, SegmentShape } from './collide';

/** Grid cell edge. A ball moves at most a few mm per step, so a move rarely spans two cells. */
export const GRID_CELL_M = 0.02;

export interface StaticGrid {
  readonly cellM: number;
  readonly minX: number;
  readonly minY: number;
  readonly cols: number;
  readonly rows: number;
  /** Per cell (row-major), ascending circle indices. */
  readonly circleCells: readonly (readonly number[])[];
  /** Per cell (row-major), ascending segment indices. */
  readonly segmentCells: readonly (readonly number[])[];
}

/** Candidate shapes for one query. Arrays may be a cell's own lists: read, don't mutate. */
export interface Candidates {
  circles: readonly number[];
  segments: readonly number[];
}

const EMPTY: readonly number[] = Object.freeze([]);

/**
 * Build the grid. `reachM` is how far beyond a shape's own extent a ball
 * centre can be and still touch it: the ball radius plus contact slop.
 * Returns null when there is no geometry to index.
 */
export function createStaticGrid(
  circles: readonly CircleShape[],
  segments: readonly SegmentShape[],
  reachM: number,
  cellM = GRID_CELL_M,
): StaticGrid | null {
  if (!(cellM > 0)) throw new RangeError(`cellM must be > 0, got ${cellM}`);
  // Inflated bounding box of every shape: [minX, minY, maxX, maxY].
  const circleBoxes = circles.map((c) => {
    const r = c.radiusM + reachM;
    return [c.x - r, c.y - r, c.x + r, c.y + r] as const;
  });
  const segmentBoxes = segments.map(
    (s) =>
      [
        Math.min(s.ax, s.bx) - reachM,
        Math.min(s.ay, s.by) - reachM,
        Math.max(s.ax, s.bx) + reachM,
        Math.max(s.ay, s.by) + reachM,
      ] as const,
  );
  const all = [...circleBoxes, ...segmentBoxes];
  if (all.length === 0) return null;

  const minX = Math.min(...all.map((b) => b[0]));
  const minY = Math.min(...all.map((b) => b[1]));
  const maxX = Math.max(...all.map((b) => b[2]));
  const maxY = Math.max(...all.map((b) => b[3]));
  const cols = Math.max(1, Math.ceil((maxX - minX) / cellM));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cellM));
  if (cols * rows > 4_000_000) {
    throw new RangeError(`geometry spans ${cols} × ${rows} grid cells; too large to index`);
  }
  const circleCells: number[][] = Array.from({ length: cols * rows }, () => []);
  const segmentCells: number[][] = Array.from({ length: cols * rows }, () => []);

  const fill = (cells: number[][], boxes: readonly (readonly number[])[]) => {
    // Shapes are added in index order, so every cell list comes out sorted.
    boxes.forEach((b, i) => {
      const c0 = clampCell(Math.floor(((b[0] as number) - minX) / cellM), cols);
      const c1 = clampCell(Math.floor(((b[2] as number) - minX) / cellM), cols);
      const r0 = clampCell(Math.floor(((b[1] as number) - minY) / cellM), rows);
      const r1 = clampCell(Math.floor(((b[3] as number) - minY) / cellM), rows);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) (cells[r * cols + c] as number[]).push(i);
      }
    });
  };
  fill(circleCells, circleBoxes);
  fill(segmentCells, segmentBoxes);
  return { cellM, minX, minY, cols, rows, circleCells, segmentCells };
}

function clampCell(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

// Scratch for multi-cell queries. `stamp` marks shapes already collected in
// the current query, so a shape spanning cells is listed once.
const circleScratch: number[] = [];
const segmentScratch: number[] = [];
let circleStamp: Uint32Array = new Uint32Array(0);
let segmentStamp: Uint32Array = new Uint32Array(0);
let query = 0;

/**
 * Shapes a point moving from (x0, y0) to (x1, y1) could touch, written into
 * `out`. A move whose box lies outside the grid touches nothing.
 */
export function queryGrid(
  grid: StaticGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: Candidates,
): void {
  const { cellM, minX, minY, cols, rows } = grid;
  const c0 = Math.floor((Math.min(x0, x1) - minX) / cellM);
  const c1 = Math.floor((Math.max(x0, x1) - minX) / cellM);
  const r0 = Math.floor((Math.min(y0, y1) - minY) / cellM);
  const r1 = Math.floor((Math.max(y0, y1) - minY) / cellM);
  // Also catches NaN: every comparison with it is false.
  if (!(c1 >= 0 && r1 >= 0 && c0 < cols && r0 < rows)) {
    out.circles = EMPTY;
    out.segments = EMPTY;
    return;
  }
  const ca = Math.max(c0, 0);
  const cb = Math.min(c1, cols - 1);
  const ra = Math.max(r0, 0);
  const rb = Math.min(r1, rows - 1);
  if (ca === cb && ra === rb) {
    const cell = ra * cols + ca;
    out.circles = grid.circleCells[cell] as readonly number[];
    out.segments = grid.segmentCells[cell] as readonly number[];
    return;
  }
  query = (query + 1) >>> 0;
  if (query === 0) {
    // Wrapped after 2^32 queries: clear the stamps so old marks can't match.
    circleStamp.fill(0);
    segmentStamp.fill(0);
    query = 1;
  }
  circleStamp = collect(grid.circleCells, ca, cb, ra, rb, cols, circleScratch, circleStamp);
  segmentStamp = collect(grid.segmentCells, ca, cb, ra, rb, cols, segmentScratch, segmentStamp);
  out.circles = circleScratch;
  out.segments = segmentScratch;
}

function collect(
  cells: readonly (readonly number[])[],
  ca: number,
  cb: number,
  ra: number,
  rb: number,
  cols: number,
  into: number[],
  stamp: Uint32Array,
): Uint32Array {
  into.length = 0;
  for (let r = ra; r <= rb; r++) {
    for (let c = ca; c <= cb; c++) {
      for (const i of cells[r * cols + c] as readonly number[]) {
        if (i >= stamp.length) {
          const grown = new Uint32Array(Math.max(i + 1, stamp.length * 2));
          grown.set(stamp);
          stamp = grown;
        }
        if (stamp[i] === query) continue;
        stamp[i] = query;
        into.push(i);
      }
    }
  }
  // Ascending, to match brute-force order. Lists are short; insertion sort.
  for (let i = 1; i < into.length; i++) {
    const v = into[i] as number;
    let j = i - 1;
    while (j >= 0 && (into[j] as number) > v) {
      into[j + 1] = into[j] as number;
      j--;
    }
    into[j + 1] = v;
  }
  return stamp;
}
