// Fixed-step integrator and ball lifecycle.
//
// Coordinates: SI metres in the board plane, x to the right, y up (gravity
// pulls toward -y). Rendering flips y; nothing in sim/ knows about pixels.
//
// One step, per ball:
//   1. velocity += in-plane gravity × dt, then backboard drag (implicit)
//   2. sweep the step's displacement against all geometry, stop at the
//      earliest impact, apply the impulse, and sweep the rest of the step
//   3. capture the ball if its path entered a sensor (a pocket), stopping it
//      at the point of entry
//   4. remove the ball if it was captured or has left the world bounds
// Every constant here is derived or justified in PHYSICS.md.

import {
  type BallState,
  type CircleShape,
  type Material,
  type SegmentShape,
  CONTACT_SLOP_M,
  createHit,
  resolveContact,
  sweepCapsule,
  sweepDisc,
} from './collide';
import { type Candidates, type StaticGrid, createStaticGrid, queryGrid } from './broadphase';
import { type SensorShape, sensorEntryT } from './sensor';

/** Sim timestep. PLAN.md: 1/2000 s or finer, so a ball at max launch speed moves less than its radius per step. */
export const SIM_STEP_S = 1 / 2000;

/** Standard gravity. */
export const GRAVITY_MPS2 = 9.80665;
/** Board lean back from vertical. */
export const BOARD_TILT_RAD = (3 * Math.PI) / 180;
/** Gravity component in the board plane: g·cos(tilt). */
export const IN_PLANE_GRAVITY_MPS2 = GRAVITY_MPS2 * Math.cos(BOARD_TILT_RAD);
/** Velocity-proportional drag from the ball rolling against the backboard. */
export const BACKBOARD_DRAG_PER_S = 0.1;

/** Steel ball: 11 mm diameter. */
export const BALL_RADIUS_M = 0.0055;
/** Steel ball mass. */
export const BALL_MASS_KG = 0.0055;
/** Brass nail: about 2 mm diameter. */
export const NAIL_RADIUS_M = 0.001;
/** Fastest launch the handle can produce. Provisional until M2 tunes it against the real board. */
export const MAX_LAUNCH_SPEED_MPS = 5;

export const NAIL_MATERIAL: Material = Object.freeze({ restitution: 0.6, friction: 0.1 });
export const RAIL_MATERIAL: Material = Object.freeze({ restitution: 0.4, friction: 0.05 });

/**
 * Most impacts one ball may resolve in a single step. Only a ball wedged
 * between surfaces (say, resting in a V) uses them all; it then stops for
 * the step, which removes energy and never adds it.
 */
export const MAX_IMPACTS_PER_STEP = 8;

/** Speed in-plane gravity adds in one step. */
const GRAVITY_DV_MPS = IN_PLANE_GRAVITY_MPS2 * SIM_STEP_S;
/** Per-step velocity factor for backboard drag, integrated implicitly: 1 / (1 + k·dt). */
const DRAG_FACTOR = 1 / (1 + BACKBOARD_DRAG_PER_S * SIM_STEP_S);

export interface Ball extends BallState {
  readonly id: number;
  /** Position at the start of the latest step, for render interpolation. Equal to x, y until the first step. */
  prevX: number;
  prevY: number;
}

/** A ball that entered a sensor this step. */
export interface Capture {
  readonly ball: Ball;
  readonly sensorId: string;
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface WorldOptions {
  /** Nails. Ball centres stay at least BALL_RADIUS_M + radius away from each. */
  readonly circles?: readonly CircleShape[];
  /** Rails, as straight pieces. Ball centres stay at least BALL_RADIUS_M away from each. */
  readonly segments?: readonly SegmentShape[];
  /** Pockets. A ball whose centre enters one is captured and removed. */
  readonly sensors?: readonly SensorShape[];
  /** A ball whose centre leaves this box is removed. Unbounded if omitted. */
  readonly bounds?: Bounds;
  /**
   * Index nails and rails in a spatial hash (default true). Results are
   * identical either way; false tests every shape, for checking exactly that.
   */
  readonly broadphase?: boolean;
}

export interface World {
  /** Total sim time advanced, in seconds. Equals steps × SIM_STEP_S. */
  timeS: number;
  /** Number of fixed steps taken since creation. */
  steps: number;
  /** Balls in play, in the order they were added. */
  readonly balls: Ball[];
  readonly circles: readonly CircleShape[];
  readonly segments: readonly SegmentShape[];
  readonly sensors: readonly SensorShape[];
  readonly bounds: Bounds | null;
  /** Balls captured by sensors during the latest step, in ball order. Replaced every step. */
  captures: readonly Capture[];
  /** Spatial hash over circles and segments, or null to test every shape. */
  readonly grid: StaticGrid | null;
  /** Id the next added ball will get. Ids are never reused. */
  nextBallId: number;
}

export function createWorld(options: WorldOptions = {}): World {
  const { bounds } = options;
  if (bounds) {
    const finite = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite);
    if (!finite || !(bounds.minX < bounds.maxX && bounds.minY < bounds.maxY)) {
      throw new RangeError('world bounds must be finite with min < max');
    }
  }
  const circles = options.circles ?? [];
  const segments = options.segments ?? [];
  return {
    timeS: 0,
    steps: 0,
    balls: [],
    circles,
    segments,
    sensors: options.sensors ?? [],
    bounds: bounds ?? null,
    captures: NO_CAPTURES,
    grid:
      options.broadphase === false
        ? null
        : createStaticGrid(circles, segments, BALL_RADIUS_M + GRID_REACH_SLOP_M),
    nextBallId: 1,
  };
}

/**
 * Put a ball into play. Throws if the state is not finite or the ball would
 * overlap a nail or rail: a ball that starts inside geometry has no valid
 * way out, since the sim never pushes balls out of shapes.
 */
export function addBall(
  world: World,
  state: { x: number; y: number; vx?: number; vy?: number },
): Ball {
  const ball: Ball = {
    id: world.nextBallId,
    x: state.x,
    y: state.y,
    vx: state.vx ?? 0,
    vy: state.vy ?? 0,
    prevX: state.x,
    prevY: state.y,
  };
  if (![ball.x, ball.y, ball.vx, ball.vy].every(Number.isFinite)) {
    throw new RangeError('ball position and velocity must be finite');
  }
  const overlap = overlappingShape(world, ball.x, ball.y);
  if (overlap) throw new RangeError(`ball at (${ball.x}, ${ball.y}) overlaps a ${overlap}`);
  world.nextBallId += 1;
  world.balls.push(ball);
  return ball;
}

/** Remove a ball by id. Returns whether it was in play. */
export function removeBall(world: World, id: number): boolean {
  const i = world.balls.findIndex((b) => b.id === id);
  if (i < 0) return false;
  world.balls.splice(i, 1);
  return true;
}

function overlappingShape(world: World, x: number, y: number): string | null {
  const clearance = (r: number) => r - CONTACT_SLOP_M;
  for (const c of world.circles) {
    if (Math.hypot(x - c.x, y - c.y) < clearance(BALL_RADIUS_M + c.radiusM)) return 'nail';
  }
  for (const s of world.segments) {
    const along = Math.min(s.lengthM, Math.max(0, (x - s.ax) * s.ux + (y - s.ay) * s.uy));
    const d = Math.hypot(x - (s.ax + s.ux * along), y - (s.ay + s.uy * along));
    if (d < clearance(BALL_RADIUS_M)) return 'rail';
  }
  return null;
}

const NO_BALLS: readonly Ball[] = Object.freeze([]);
const NO_CAPTURES: readonly Capture[] = Object.freeze([]);
/**
 * Extra reach when indexing shapes, well beyond CONTACT_SLOP_M: a shape is
 * listed in every cell from which a ball could touch it, with room to spare.
 */
const GRID_REACH_SLOP_M = 1e-6;
const hit = createHit();
const best = createHit();
const candidates: Candidates = { circles: [], segments: [] };
/** 0, 1, 2, …: every shape, for a world without a grid. Grown on demand. */
const allIndices: number[] = [];

function everyIndex(n: number): readonly number[] {
  while (allIndices.length < n) allIndices.push(allIndices.length);
  return allIndices.length === n ? allIndices : allIndices.slice(0, n);
}

/**
 * Advance the world by exactly one fixed step. Returns the balls removed this
 * step, captured by a sensor or out of bounds (a shared empty array when there
 * are none). `world.captures` says which sensor took each captured one.
 */
export function stepWorld(world: World): readonly Ball[] {
  let removed: Ball[] | null = null;
  let captures: Capture[] | null = null;
  const { balls, bounds } = world;

  for (let i = 0; i < balls.length; i++) {
    const ball = balls[i] as Ball;
    const sensor = stepBall(world, ball);
    if (sensor) {
      (captures ??= []).push({ ball, sensorId: sensor.id });
      (removed ??= []).push(ball);
    } else if (
      bounds &&
      (ball.x < bounds.minX || ball.x > bounds.maxX || ball.y < bounds.minY || ball.y > bounds.maxY)
    ) {
      (removed ??= []).push(ball);
    }
  }
  if (removed) {
    for (const ball of removed) removeBall(world, ball.id);
  }

  world.captures = captures ?? NO_CAPTURES;
  world.steps += 1;
  // Derive time from the step count so it never accumulates float error.
  world.timeS = world.steps * SIM_STEP_S;
  return removed ?? NO_BALLS;
}

/** Returns the sensor that captured the ball this step, if any. */
function stepBall(world: World, ball: Ball): SensorShape | null {
  const x0 = ball.x;
  const y0 = ball.y;
  ball.prevX = x0;
  ball.prevY = y0;
  const energy0 = specificEnergy(ball);

  // Semi-implicit Euler: velocity first, then position with the new velocity.
  ball.vy -= GRAVITY_DV_MPS;
  ball.vx *= DRAG_FACTOR;
  ball.vy *= DRAG_FACTOR;

  let remainingS = SIM_STEP_S;
  let touched = false;
  for (let impacts = 0; impacts < MAX_IMPACTS_PER_STEP; impacts++) {
    const dx = ball.vx * remainingS;
    const dy = ball.vy * remainingS;
    let material: Material | null = null;
    best.t = Infinity;

    if (world.grid) {
      queryGrid(world.grid, ball.x, ball.y, ball.x + dx, ball.y + dy, candidates);
    } else {
      candidates.circles = everyIndex(world.circles.length);
      candidates.segments = everyIndex(world.segments.length);
    }
    for (const ci of candidates.circles) {
      const c = world.circles[ci] as CircleShape;
      if (sweepDisc(ball.x, ball.y, dx, dy, c.x, c.y, BALL_RADIUS_M + c.radiusM, hit)) {
        if (hit.t < best.t) {
          best.t = hit.t;
          best.nx = hit.nx;
          best.ny = hit.ny;
          material = c.material;
        }
      }
    }
    for (const si of candidates.segments) {
      const s = world.segments[si] as SegmentShape;
      if (sweepCapsule(ball.x, ball.y, dx, dy, s, BALL_RADIUS_M, hit)) {
        if (hit.t < best.t) {
          best.t = hit.t;
          best.nx = hit.nx;
          best.ny = hit.ny;
          material = s.material;
        }
      }
    }

    // A pocket entered before the next impact (or, with no impact, within
    // the move) takes the ball where its centre crossed in.
    let sensor: SensorShape | null = null;
    let sensorT = material ? best.t : 1;
    for (const p of world.sensors) {
      const t = sensorEntryT(p, ball.x, ball.y, dx, dy);
      if (t <= sensorT && (!sensor || t < sensorT)) {
        sensor = p;
        sensorT = t;
      }
    }
    if (sensor) {
      ball.x += dx * sensorT;
      ball.y += dy * sensorT;
      return sensor;
    }

    if (!material) {
      ball.x += dx;
      ball.y += dy;
      remainingS = 0;
      break;
    }
    ball.x += dx * best.t;
    ball.y += dy * best.t;
    remainingS *= 1 - best.t;
    resolveContact(ball, best.nx, best.ny, material, GRAVITY_DV_MPS);
    touched = true;
    if (remainingS <= 0) break;
  }
  if (remainingS > 0) {
    // Out of impacts with time left: the ball is wedged. Hold it still for
    // the rest of this step rather than let it press into geometry.
    ball.vx = 0;
    ball.vy = 0;
  }
  if (touched) dissipateContactError(ball, x0, y0, energy0);
  return null;
}

/** Kinetic plus potential energy per unit mass, in J/kg. */
function specificEnergy(ball: Readonly<BallState>): number {
  return 0.5 * (ball.vx * ball.vx + ball.vy * ball.vy) + IN_PLANE_GRAVITY_MPS2 * ball.y;
}

/**
 * Contacts only ever take energy out: restitution < 1 and friction both
 * dissipate. The discrete step can still come out slightly ahead, because
 * gravity's work is taken over a path the impulses redirected mid-step
 * (a ball wedged in a V turns a downward drift into a climb up the other
 * side). That gain is integration error of order g·dt·|v|, not physics, so
 * on a step with contacts we take it back out of the kinetic energy. If the
 * kinetic energy can't cover it, the ball was all but resting: put it back
 * where the step began, at rest. Derivation and measurements in PHYSICS.md.
 */
function dissipateContactError(ball: Ball, x0: number, y0: number, energy0: number): void {
  const excess = specificEnergy(ball) - energy0;
  if (!(excess > 0)) return;
  const kinetic = 0.5 * (ball.vx * ball.vx + ball.vy * ball.vy);
  if (kinetic > excess) {
    const k = Math.sqrt((kinetic - excess) / kinetic);
    ball.vx *= k;
    ball.vy *= k;
    // Rounding in the rescale can leave the last ulp of excess behind.
    if (specificEnergy(ball) <= energy0) return;
  }
  ball.x = x0;
  ball.y = y0;
  ball.vx = 0;
  ball.vy = 0;
}

/** Mechanical energy of one ball in J: kinetic plus in-plane gravitational potential (zero at y = 0). */
export function ballEnergyJ(ball: Readonly<BallState>): number {
  return BALL_MASS_KG * specificEnergy(ball);
}

/** Total mechanical energy of the balls in play, in J. */
export function totalEnergyJ(world: Readonly<World>): number {
  let sum = 0;
  for (const ball of world.balls) sum += ballEnergyJ(ball);
  return sum;
}
