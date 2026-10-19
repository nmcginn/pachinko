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
// Gates (the attacker's lid) are rail segments that can be switched off:
// an open gate's segments are skipped. Opening and closing is input, like a
// launch; only setGateOpen does it, never the step.
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
/** Fastest launch the handle can produce. Confirmed against boards/classic.json in M2. */
export const MAX_LAUNCH_SPEED_MPS = 5;
/**
 * Shot-to-shot spread of launch speed, as a fraction of the nominal speed
 * (one standard deviation). The hammer spring never strikes twice exactly
 * alike. Without it every shot at one power follows the same path. See
 * PHYSICS.md ("Launch spread").
 */
export const LAUNCH_SPEED_SPREAD = 0.01;

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

/** A gate as passed to createWorld: a lid that closes over a pocket. */
export interface GateOptions {
  readonly id: string;
  /** The lid. Solid while the gate is closed, absent while it is open. */
  readonly segments: readonly SegmentShape[];
  /** Sensor that takes a ball caught in the gate's mouth when it closes. */
  readonly sensorId: string;
  /** Default false: closed. */
  readonly open?: boolean;
}

export interface Gate {
  readonly id: string;
  readonly sensorId: string;
  /** Indices of the lid's segments in world.segments. */
  readonly segments: readonly number[];
  /** Read it; change it only through setGateOpen. */
  readonly open: boolean;
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
  /** Gates. Their lid segments are appended to `segments`, after the rails. */
  readonly gates?: readonly GateOptions[];
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
  readonly gates: readonly Gate[];
  /** Per segment, 1 if it belongs to an open gate and is skipped. Kept by setGateOpen. */
  readonly segmentOff: Uint8Array;
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
  const segments = [...(options.segments ?? [])];
  const sensors = options.sensors ?? [];
  const gates: Gate[] = [];
  for (const g of options.gates ?? []) {
    if (gates.some((other) => other.id === g.id))
      throw new RangeError(`duplicate gate id "${g.id}"`);
    if (!sensors.some((s) => s.id === g.sensorId)) {
      throw new RangeError(`gate "${g.id}" names sensor "${g.sensorId}", which isn't in the world`);
    }
    if (g.segments.length === 0) throw new RangeError(`gate "${g.id}" has no lid segments`);
    const first = segments.length;
    segments.push(...g.segments);
    gates.push({
      id: g.id,
      sensorId: g.sensorId,
      segments: g.segments.map((_, k) => first + k),
      open: g.open ?? false,
    });
  }
  const segmentOff = new Uint8Array(segments.length);
  for (const g of gates) if (g.open) for (const i of g.segments) segmentOff[i] = 1;
  return {
    timeS: 0,
    steps: 0,
    balls: [],
    circles,
    segments,
    sensors,
    bounds: bounds ?? null,
    gates,
    segmentOff,
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

/**
 * Open or close a gate. Opening just removes the lid. Closing puts it back,
 * and a ball the lid would close on (one already in the gate's mouth,
 * overlapping the lid) is taken by the gate's sensor, as if it had dropped
 * in: the lid can't close through it, and nothing ever pushes a ball out of
 * geometry. Returns those captures, in ball order; they are removed from
 * play but not added to `world.captures`, which belongs to the step.
 */
export function setGateOpen(world: World, id: string, open: boolean): readonly Capture[] {
  const gate = world.gates.find((g) => g.id === id);
  if (!gate) throw new RangeError(`no gate "${id}"`);
  if (gate.open === open) return NO_CAPTURES;
  (gate as { open: boolean }).open = open;
  for (const i of gate.segments) world.segmentOff[i] = open ? 1 : 0;
  if (open) return NO_CAPTURES;
  const caught: Capture[] = [];
  for (const ball of world.balls) {
    const onLid = gate.segments.some(
      (i) => segmentDistanceM(world.segments[i] as SegmentShape, ball.x, ball.y) < BALL_CLEARANCE_M,
    );
    if (onLid) caught.push({ ball, sensorId: gate.sensorId });
  }
  for (const c of caught) removeBall(world, c.ball.id);
  return caught.length > 0 ? caught : NO_CAPTURES;
}

/** Closer than this to a rail, a ball centre overlaps it. */
const BALL_CLEARANCE_M = BALL_RADIUS_M - CONTACT_SLOP_M;

function segmentDistanceM(s: SegmentShape, x: number, y: number): number {
  const along = Math.min(s.lengthM, Math.max(0, (x - s.ax) * s.ux + (y - s.ay) * s.uy));
  return Math.hypot(x - (s.ax + s.ux * along), y - (s.ay + s.uy * along));
}

function overlappingShape(world: World, x: number, y: number): string | null {
  for (const c of world.circles) {
    if (Math.hypot(x - c.x, y - c.y) < BALL_CLEARANCE_M + c.radiusM) return 'nail';
  }
  for (let i = 0; i < world.segments.length; i++) {
    if (world.segmentOff[i]) continue;
    if (segmentDistanceM(world.segments[i] as SegmentShape, x, y) < BALL_CLEARANCE_M) return 'rail';
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

/**
 * Every circle and segment as candidates. Grows the shared list to cover
 * both before handing it out: growing it after would lengthen a list
 * already handed out as the shorter kind's.
 */
function everyShape(world: World, out: Candidates): void {
  const n = Math.max(world.circles.length, world.segments.length);
  while (allIndices.length < n) allIndices.push(allIndices.length);
  const take = (k: number) => (allIndices.length === k ? allIndices : allIndices.slice(0, k));
  out.circles = take(world.circles.length);
  out.segments = take(world.segments.length);
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
      everyShape(world, candidates);
    }
    const { segmentOff } = world;
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
      if (segmentOff[si]) continue;
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
