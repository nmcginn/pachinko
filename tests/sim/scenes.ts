// Test scenes shared by the sim tests. Built from the public sim API only.

import { type Material, createCircle, createPolyline } from '../../src/sim/collide';
import { type Rng, createRng } from '../../src/sim/rng';
import {
  type Ball,
  type World,
  NAIL_MATERIAL,
  NAIL_RADIUS_M,
  RAIL_MATERIAL,
  SIM_STEP_S,
  addBall,
  createWorld,
  stepWorld,
} from '../../src/sim/world';

/** Nail pitch in the grid scene. Gaps (pitch − nail diameter = 14 mm) pass an 11 mm ball. */
export const GRID_PITCH_M = 0.016;
export const GRID_SIZE = 10;
export const GRID_TOP_Y_M = 0.2;
/** Width between the grid's side walls. Every nail-to-wall gap is wider than a ball, so nothing wedges. */
export const GRID_WIDTH_M = (GRID_SIZE + 1.5) * GRID_PITCH_M;
/** Height balls are dropped from in the grid scene. */
export const GRID_DROP_Y_M = GRID_TOP_Y_M + 0.03;
/** Balls are removed once they fall this far below the lowest row. */
export const GRID_EXIT_Y_M = GRID_TOP_Y_M - GRID_SIZE * GRID_PITCH_M - 0.02;
/** The open grid's side walls stop here, a little above the exit line. */
const GRID_WALL_BOTTOM_Y_M = GRID_EXIT_Y_M + 0.01;

export interface GridOptions {
  nailMaterial?: Material;
  railMaterial?: Material;
  /**
   * Add a lid and a V floor so nothing ever leaves: balls bounce, roll, and
   * finally rest. Used by the energy invariant.
   */
  closed?: boolean;
}

/**
 * 10 × 10 staggered nail grid between two vertical walls, open at the
 * bottom unless `closed`. Odd rows are offset by half a pitch, as on a real board.
 */
export function gridWorld(options: GridOptions = {}): World {
  const { nailMaterial = NAIL_MATERIAL, railMaterial = RAIL_MATERIAL, closed = false } = options;
  const circles = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const x = GRID_PITCH_M * (1 + col + (row % 2) * 0.5);
      const y = GRID_TOP_Y_M - row * GRID_PITCH_M;
      circles.push(createCircle({ x, y }, NAIL_RADIUS_M, nailMaterial));
    }
  }
  const wallTop = GRID_DROP_Y_M + 0.1;
  // Closed: the V floor's rims sit at the exit line, well clear of the last
  // row, and the walls reach down to meet them.
  const wallBottom = closed ? GRID_EXIT_Y_M : GRID_WALL_BOTTOM_Y_M;
  const segments = [
    ...createPolyline(
      [
        { x: 0, y: wallBottom },
        { x: 0, y: wallTop },
      ],
      railMaterial,
    ),
    ...createPolyline(
      [
        { x: GRID_WIDTH_M, y: wallBottom },
        { x: GRID_WIDTH_M, y: wallTop },
      ],
      railMaterial,
    ),
  ];
  if (closed) {
    const lidY = GRID_DROP_Y_M + 0.06;
    const floorY = GRID_EXIT_Y_M - 0.03;
    segments.push(
      ...createPolyline(
        [
          { x: 0, y: lidY },
          { x: GRID_WIDTH_M, y: lidY },
        ],
        railMaterial,
      ),
      ...createPolyline(
        [
          { x: 0, y: floorY + 0.03 },
          { x: GRID_WIDTH_M / 2, y: floorY },
          { x: GRID_WIDTH_M, y: floorY + 0.03 },
        ],
        railMaterial,
      ),
    );
  }
  return createWorld({
    circles,
    segments,
    ...(closed
      ? {}
      : { bounds: { minX: -0.05, maxX: GRID_WIDTH_M + 0.05, minY: GRID_EXIT_Y_M, maxY: 1 } }),
  });
}

/** Drop one ball at a seeded random x across the middle of the grid, at rest. */
export function dropBall(world: World, rng: Rng): Ball {
  const x = rng.range(0.3 * GRID_WIDTH_M, 0.7 * GRID_WIDTH_M);
  return addBall(world, { x, y: GRID_DROP_Y_M });
}

export interface GridRun {
  /** Ball position after every step, flattened as x0, y0, x1, y1, … */
  trajectory: number[];
  /** Step at which the ball left through the bottom, or null if it never did. */
  exitStep: number | null;
}

/** The M1 acceptance scene: one ball dropped through the grid with a seeded drop point. */
export function runGridDrop(seed: number, maxSimS = 10): GridRun {
  const world = gridWorld();
  const ball = dropBall(world, createRng(seed));
  const trajectory: number[] = [];
  const maxSteps = Math.round(maxSimS / SIM_STEP_S);
  for (let i = 0; i < maxSteps; i++) {
    const removed = stepWorld(world);
    trajectory.push(ball.x, ball.y);
    if (removed.includes(ball)) return { trajectory, exitStep: world.steps };
  }
  return { trajectory, exitStep: null };
}

/** Half-width of the V pocket. */
export const POCKET_HALF_WIDTH_M = 0.03;

/** A V-shaped pocket (two rails meeting at the origin) with steep sides, 30° from horizontal. */
export function pocketWorld(material: Material = RAIL_MATERIAL): World {
  const rise = POCKET_HALF_WIDTH_M * Math.tan(Math.PI / 6);
  return createWorld({
    segments: createPolyline(
      [
        { x: -POCKET_HALF_WIDTH_M, y: rise },
        { x: 0, y: 0 },
        { x: POCKET_HALF_WIDTH_M, y: rise },
      ],
      material,
    ),
  });
}
