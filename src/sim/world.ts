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
// With ball collisions on (board worlds; M5), balls also collide with each
// other. Balls that could meet within the step are found with a spatial hash
// and moved together, earliest event first, so a ball never passes through
// or ends inside another. A ball nobody can reach moves exactly as above.
// Gates are rail segments switched by an open/closed state: the attacker's
// lid is solid only while closed; a tulip's wings have one shape while
// closed and another while open (M5). Segments of the other state are
// skipped. Opening and closing is input, like a launch; only setGateOpen
// does it, never the step.
// Every constant here is derived or justified in PHYSICS.md.

import {
  type BallState,
  type CircleShape,
  type Material,
  type SegmentShape,
  CONTACT_SLOP_M,
  createHit,
  resolveBallContact,
  resolveContact,
  restingSpeedMps,
  sweepCapsule,
  sweepDisc,
} from './collide';
import { type Candidates, type StaticGrid, createStaticGrid, queryGrid } from './broadphase';
import { type SensorShape, sensorEntryT } from './sensor';

// The functions the step's inner loops call, read once. Under tsx (the
// Monte Carlo CLI, its worker threads, and the tests) each module's exports
// are getters, so every call through an import pays one; in findStaticEvent
// that was about 7% of a Monte Carlo run. They never change, so the copies
// are the same functions.
const queryGridFn = queryGrid;
const sweepDiscFn = sweepDisc;
const sweepCapsuleFn = sweepCapsule;
const sensorEntryTFn = sensorEntryT;

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
 * Ball–ball normal restitution: hardened steel on hardened steel. The
 * contact is frictionless. Tuning knob; see PHYSICS.md ("Ball against ball").
 */
export const BALL_RESTITUTION = 0.9;

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

/**
 * A gate as passed to createWorld: geometry over a pocket that changes with
 * an open/closed state. The attacker's lid has only closed segments; a
 * tulip's wings have both.
 */
export interface GateOptions {
  readonly id: string;
  /** Solid while the gate is closed, absent while it is open: the attacker's lid, a tulip's closed wings. */
  readonly segments: readonly SegmentShape[];
  /** Solid while the gate is open, absent while it is closed: a tulip's open wings. Default none. */
  readonly openSegments?: readonly SegmentShape[];
  /** Sensor that takes a ball the gate's geometry switches on over (see setGateOpen). */
  readonly sensorId: string;
  /** Default false: closed. */
  readonly open?: boolean;
}

export interface Gate {
  readonly id: string;
  readonly sensorId: string;
  /** Indices in world.segments of the segments solid while closed. */
  readonly segments: readonly number[];
  /** Indices in world.segments of the segments solid while open. */
  readonly openSegments: readonly number[];
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
  /** Gates. Their segments are appended to `segments`, after the rails: each gate's closed ones, then its open ones. */
  readonly gates?: readonly GateOptions[];
  /**
   * Balls collide with each other (default false: they pass through each
   * other, as in M1–M4). Board worlds turn it on.
   */
  readonly ballCollisions?: boolean;
  /**
   * Index nails and rails, and each step's balls, in spatial hashes (default
   * true). Results are identical either way; false tests every shape and
   * every pair of balls, for checking exactly that.
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
  /**
   * Highest top of any sensor (-Infinity with none). A move that stays above
   * it can't enter one, so the step skips testing them: on a board, balls
   * spend most of their flight above every pocket.
   */
  readonly sensorsTopY: number;
  readonly bounds: Bounds | null;
  readonly gates: readonly Gate[];
  /** Per segment, 1 if it belongs to a gate in the other state and is skipped. Kept by setGateOpen. */
  readonly segmentOff: Uint8Array;
  /** Balls captured by sensors during the latest step, in ball order. Replaced every step. */
  captures: readonly Capture[];
  /** Spatial hash over circles and segments, or null to test every shape (and every pair of balls). */
  readonly grid: StaticGrid | null;
  /** Balls collide with each other. */
  readonly ballCollisions: boolean;
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
    const openShape = g.openSegments ?? [];
    if (g.segments.length + openShape.length === 0) {
      throw new RangeError(`gate "${g.id}" has no segments`);
    }
    const append = (shapes: readonly SegmentShape[]): number[] =>
      shapes.map((shape) => segments.push(shape) - 1);
    gates.push({
      id: g.id,
      sensorId: g.sensorId,
      segments: append(g.segments),
      openSegments: append(openShape),
      open: g.open ?? false,
    });
  }
  const segmentOff = new Uint8Array(segments.length);
  for (const g of gates) for (const i of g.open ? g.segments : g.openSegments) segmentOff[i] = 1;
  return {
    timeS: 0,
    steps: 0,
    balls: [],
    circles,
    segments,
    sensors,
    sensorsTopY: Math.max(-Infinity, ...sensors.map((s) => s.maxY)),
    bounds: bounds ?? null,
    gates,
    segmentOff,
    captures: NO_CAPTURES,
    grid:
      options.broadphase === false
        ? null
        : createStaticGrid(circles, segments, BALL_RADIUS_M + GRID_REACH_SLOP_M),
    ballCollisions: options.ballCollisions ?? false,
    nextBallId: 1,
  };
}

/**
 * Put a ball into play. Throws if the state is not finite or the ball would
 * overlap a nail or rail, or, with ball collisions on, another ball: a ball
 * that starts inside something has no valid way out, since the sim never
 * pushes balls apart. `overlapsBall` checks for the last.
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
  const overlap = overlappingShape(world, ball.x, ball.y) ?? overlappingBall(world, ball.x, ball.y);
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
 * Open or close a gate: the segments of the old state go, those of the new
 * one appear. A ball a new segment would land on (one overlapping it, such
 * as a ball in the attacker's mouth as its lid closes) is taken by the
 * gate's sensor, as if it had dropped in: geometry can't switch on through
 * a ball, and nothing ever pushes a ball out of geometry. Returns those
 * captures, in ball order; they are removed from play but not added to
 * `world.captures`, which belongs to the step.
 */
export function setGateOpen(world: World, id: string, open: boolean): readonly Capture[] {
  const gate = world.gates.find((g) => g.id === id);
  if (!gate) throw new RangeError(`no gate "${id}"`);
  if (gate.open === open) return NO_CAPTURES;
  (gate as { open: boolean }).open = open;
  const on = open ? gate.openSegments : gate.segments;
  for (const i of gate.segments) world.segmentOff[i] = open ? 1 : 0;
  for (const i of gate.openSegments) world.segmentOff[i] = open ? 0 : 1;
  if (on.length === 0) return NO_CAPTURES;
  const caught: Capture[] = [];
  for (const ball of world.balls) {
    const landsOn = on.some(
      (i) => segmentDistanceM(world.segments[i] as SegmentShape, ball.x, ball.y) < BALL_CLEARANCE_M,
    );
    if (landsOn) caught.push({ ball, sensorId: gate.sensorId });
  }
  for (const c of caught) removeBall(world, c.ball.id);
  return caught.length > 0 ? caught : NO_CAPTURES;
}

/** Closer than this to a rail, a ball centre overlaps it. */
const BALL_CLEARANCE_M = BALL_RADIUS_M - CONTACT_SLOP_M;
/** Two ball centres this far apart touch. */
const PAIR_CONTACT_M = 2 * BALL_RADIUS_M;
/** Closer than this, two ball centres overlap. */
const BALL_PAIR_CLEARANCE_M = PAIR_CONTACT_M - CONTACT_SLOP_M;

/** Whether a ball at (x, y) would overlap a ball in play. Always false with ball collisions off. */
export function overlapsBall(world: World, x: number, y: number): boolean {
  return overlappingBall(world, x, y) !== null;
}

function overlappingBall(world: World, x: number, y: number): string | null {
  if (!world.ballCollisions) return null;
  const clearSq = BALL_PAIR_CLEARANCE_M * BALL_PAIR_CLEARANCE_M;
  for (const b of world.balls) {
    if ((x - b.x) ** 2 + (y - b.y) ** 2 < clearSq) return `ball (id ${b.id})`;
  }
  return null;
}

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
  const n = balls.length;

  if (stepSensors.length < n) stepSensors.length = n;
  if (world.ballCollisions && n > 1) {
    stepBallsTogether(world);
  } else {
    for (let i = 0; i < n; i++) stepSensors[i] = stepBall(world, balls[i] as Ball);
  }
  for (let i = 0; i < n; i++) {
    const ball = balls[i] as Ball;
    const sensor = stepSensors[i];
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
  stepSensors.fill(null, 0, n);
  if (removed) {
    for (const ball of removed) removeBall(world, ball.id);
  }

  world.captures = captures ?? NO_CAPTURES;
  world.steps += 1;
  // Derive time from the step count so it never accumulates float error.
  world.timeS = world.steps * SIM_STEP_S;
  return removed ?? NO_BALLS;
}

/** Per ball (indexed like world.balls), the sensor that captured it this step. */
const stepSensors: (SensorShape | null)[] = [];

/**
 * Start a ball's step: remember where it was, for render interpolation, and
 * apply gravity and drag to its velocity (semi-implicit Euler: velocity
 * first, then position with the new velocity). Returns its specific energy
 * before the step, for the energy guard.
 */
function startStep(ball: Ball): number {
  ball.prevX = ball.x;
  ball.prevY = ball.y;
  const energy0 = specificEnergy(ball);
  ball.vy -= GRAVITY_DV_MPS;
  ball.vx *= DRAG_FACTOR;
  ball.vy *= DRAG_FACTOR;
  return energy0;
}

/** Step one ball that no other ball can reach. Returns the sensor that captured it, if any. */
function stepBall(world: World, ball: Ball): SensorShape | null {
  const x0 = ball.x;
  const y0 = ball.y;
  const energy0 = startStep(ball);
  return moveAlone(world, ball, x0, y0, energy0);
}

/** The next thing a ball's move meets among nails, rails, and pockets. */
interface StaticEvent {
  /** Fraction of the move at which it happens. */
  t: number;
  /** Contact normal, for an impact. */
  nx: number;
  ny: number;
  /** Set for an impact. */
  material: Material | null;
  /** Set when a pocket takes the ball. Neither set: the move is clear. */
  sensor: SensorShape | null;
  /** For an impact, the nail's index in world.circles, or −1. */
  circle: number;
  /** For an impact, the rail segment's index in world.segments, or −1. */
  segment: number;
}

const event: StaticEvent = {
  t: 1,
  nx: 0,
  ny: 0,
  material: null,
  sensor: null,
  circle: -1,
  segment: -1,
};

/** Sweep the move from (x, y) by (dx, dy) against every nail, rail, and pocket. */
function findStaticEvent(
  world: World,
  x: number,
  y: number,
  dx: number,
  dy: number,
  out: StaticEvent,
): void {
  let material: Material | null = null;
  let circle = -1;
  let segment = -1;
  best.t = Infinity;

  if (world.grid) {
    queryGridFn(world.grid, x, y, x + dx, y + dy, candidates);
  } else {
    everyShape(world, candidates);
  }
  const { segmentOff } = world;
  for (const ci of candidates.circles) {
    const c = world.circles[ci] as CircleShape;
    if (sweepDiscFn(x, y, dx, dy, c.x, c.y, BALL_RADIUS_M + c.radiusM, hit)) {
      if (hit.t < best.t) {
        best.t = hit.t;
        best.nx = hit.nx;
        best.ny = hit.ny;
        material = c.material;
        circle = ci;
      }
    }
  }
  for (const si of candidates.segments) {
    if (segmentOff[si]) continue;
    const s = world.segments[si] as SegmentShape;
    if (sweepCapsuleFn(x, y, dx, dy, s, BALL_RADIUS_M, hit)) {
      if (hit.t < best.t) {
        best.t = hit.t;
        best.nx = hit.nx;
        best.ny = hit.ny;
        material = s.material;
        circle = -1;
        segment = si;
      }
    }
  }

  // A pocket entered before the next impact (or, with no impact, within
  // the move) takes the ball where its centre crossed in.
  let sensor: SensorShape | null = null;
  let sensorT = material ? best.t : 1;
  // Above every sensor, sensorEntryT would return Infinity for each.
  if (Math.min(y, y + dy) <= world.sensorsTopY) {
    for (const p of world.sensors) {
      const t = sensorEntryTFn(p, x, y, dx, dy);
      if (t <= sensorT && (!sensor || t < sensorT)) {
        sensor = p;
        sensorT = t;
      }
    }
  }
  out.sensor = sensor;
  out.material = sensor ? null : material;
  out.t = sensor ? sensorT : best.t;
  out.nx = best.nx;
  out.ny = best.ny;
  out.circle = circle;
  out.segment = segment;
}

/**
 * Move a ball through its step against nails, rails, and pockets only:
 * sweep to the earliest impact, resolve it, sweep the rest. Returns the
 * sensor that captured it, if any.
 */
function moveAlone(
  world: World,
  ball: Ball,
  x0: number,
  y0: number,
  energy0: number,
): SensorShape | null {
  let remainingS = SIM_STEP_S;
  let touched = false;
  for (let impacts = 0; impacts < MAX_IMPACTS_PER_STEP; impacts++) {
    const dx = ball.vx * remainingS;
    const dy = ball.vy * remainingS;
    findStaticEvent(world, ball.x, ball.y, dx, dy, event);
    if (event.sensor) {
      ball.x += dx * event.t;
      ball.y += dy * event.t;
      return event.sensor;
    }
    if (!event.material) {
      ball.x += dx;
      ball.y += dy;
      remainingS = 0;
      break;
    }
    ball.x += dx * event.t;
    ball.y += dy * event.t;
    remainingS *= 1 - event.t;
    resolveContact(ball, event.nx, event.ny, event.material, GRAVITY_DV_MPS);
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

// Scratch for stepping balls together, indexed like world.balls (pairs by
// pair). Grown on demand and never shrunk, so a step allocates nothing.
let startX = new Float64Array(0);
let startY = new Float64Array(0);
let startEnergy = new Float64Array(0);
/** Step time each ball has left, in s. Where it is now is where it is at SIM_STEP_S − remaining. */
let remaining = new Float64Array(0);
let impactCount = new Int32Array(0);
/** 0: not near another ball (moved alone). 1: moving with others. 2: captured this step. */
let mode = new Uint8Array(0);
let touchedAny = new Uint8Array(0);
/** Union-find over ball contacts this step, for the energy guard. */
let contactRoot = new Int32Array(0);
let revert = new Uint8Array(0);
/** Each ball's next nail, rail, or pocket event, as the step time left when it happens; −1 for none. */
let eventRemaining = new Float64Array(0);
let eventT = new Float64Array(0);
let eventNx = new Float64Array(0);
let eventNy = new Float64Array(0);
let eventCircle = new Int32Array(0);
let eventSegment = new Int32Array(0);
/**
 * The nail (circle index) or rail segment a ball last came to rest against
 * this step and may be sliding along, or −1: see resolveBallContact.
 */
let slideCircle = new Int32Array(0);
let slideSegment = new Int32Array(0);
const eventMaterial: (Material | null)[] = [];
const eventSensor: (SensorShape | null)[] = [];
let cellX = new Float64Array(0);
let cellY = new Float64Array(0);
let hashNext = new Int32Array(0);
let hashHead = new Int32Array(0);
/** Pairs of balls (indices, a < b) that could meet this step, sorted by a then b. */
const pairA: number[] = [];
const pairB: number[] = [];
let pairRemaining = new Float64Array(0);
let pairNx = new Float64Array(0);
let pairNy = new Float64Array(0);

const CAPTURED = 2;
const TOGETHER = 1;
/** Margin on how far apart two balls may start and still meet: rounding only. */
const PAIR_REACH_SLOP_M = 1e-6;

function growScratch(n: number): void {
  if (startX.length >= n) return;
  const size = Math.max(n, 2 * startX.length, 8);
  startX = new Float64Array(size);
  startY = new Float64Array(size);
  startEnergy = new Float64Array(size);
  remaining = new Float64Array(size);
  impactCount = new Int32Array(size);
  mode = new Uint8Array(size);
  touchedAny = new Uint8Array(size);
  contactRoot = new Int32Array(size);
  revert = new Uint8Array(size);
  eventRemaining = new Float64Array(size);
  eventT = new Float64Array(size);
  eventNx = new Float64Array(size);
  eventNy = new Float64Array(size);
  eventCircle = new Int32Array(size);
  eventSegment = new Int32Array(size);
  slideCircle = new Int32Array(size);
  slideSegment = new Int32Array(size);
  cellX = new Float64Array(size);
  cellY = new Float64Array(size);
  hashNext = new Int32Array(size);
}

/**
 * Step every ball with ball collisions on. Balls that could meet another this
 * step move together (moveTogether); the rest move alone, exactly as with
 * ball collisions off.
 */
function stepBallsTogether(world: World): void {
  const { balls } = world;
  const n = balls.length;
  growScratch(n);
  let speedSqSum = 0;
  for (let i = 0; i < n; i++) {
    const ball = balls[i] as Ball;
    revert[i] = 0;
    startX[i] = ball.x;
    startY[i] = ball.y;
    startEnergy[i] = startStep(ball);
    speedSqSum += ball.vx * ball.vx + ball.vy * ball.vy;
    mode[i] = 0;
  }
  // Contacts never add kinetic energy, so within the step no ball moves
  // faster than the root-sum-square of every ball's speed. Two balls further
  // apart than this at the start can't meet.
  const reachM = 2 * BALL_RADIUS_M + 2 * Math.sqrt(speedSqSum) * SIM_STEP_S + PAIR_REACH_SLOP_M;
  findPairs(world, reachM);
  for (let p = 0; p < pairA.length; p++) {
    mode[pairA[p] as number] = TOGETHER;
    mode[pairB[p] as number] = TOGETHER;
  }
  for (let i = 0; i < n; i++) {
    if (mode[i] === 0) {
      stepSensors[i] = moveAlone(
        world,
        balls[i] as Ball,
        startX[i] as number,
        startY[i] as number,
        startEnergy[i] as number,
      );
    }
  }
  if (pairA.length > 0) moveTogether(world);
}

/** Hash bucket of grid cell (cx, cy), in a table of mask + 1 buckets. */
function hashCell(cx: number, cy: number, mask: number): number {
  return (Math.imul(cx | 0, 0x9e3779b1) ^ Math.imul(cy | 0, 0x85ebca77)) & mask;
}

/**
 * Up to this many balls, testing every pair's distance is cheaper than
 * building the hash, and gives the same pairs. A board in play has two or
 * three balls in flight.
 */
const HASH_MIN_BALLS = 8;

/**
 * Every pair of balls whose centres are within `reachM` at the start of the
 * step, into pairA/pairB sorted by a then b. Hashes ball centres into cells
 * `reachM` wide, so a pair always shares or neighbours a cell. Without a
 * broadphase, every pair, near or not.
 */
function findPairs(world: World, reachM: number): void {
  const { balls } = world;
  const n = balls.length;
  pairA.length = 0;
  pairB.length = 0;
  if (!world.grid) {
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pushPair(a, b);
    return;
  }
  const reachSq = reachM * reachM;
  if (n < HASH_MIN_BALLS) {
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const dx = (startX[b] as number) - (startX[a] as number);
        const dy = (startY[b] as number) - (startY[a] as number);
        if (dx * dx + dy * dy <= reachSq) pushPair(a, b);
      }
    }
    return;
  }
  let size = 16;
  while (size < 2 * n) size *= 2;
  if (hashHead.length < size) hashHead = new Int32Array(size);
  hashHead.fill(-1, 0, size);
  const mask = size - 1;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor((startX[i] as number) / reachM);
    const cy = Math.floor((startY[i] as number) / reachM);
    cellX[i] = cx;
    cellY[i] = cy;
    const h = hashCell(cx, cy, mask);
    hashNext[i] = hashHead[h] as number;
    hashHead[h] = i;
  }
  for (let a = 0; a < n; a++) {
    const first = pairA.length;
    const ax = startX[a] as number;
    const ay = startY[a] as number;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cx = (cellX[a] as number) + ox;
        const cy = (cellY[a] as number) + oy;
        for (
          let b = hashHead[hashCell(cx, cy, mask)] as number;
          b >= 0;
          b = hashNext[b] as number
        ) {
          if (b <= a || cellX[b] !== cx || cellY[b] !== cy) continue;
          const dx = (startX[b] as number) - ax;
          const dy = (startY[b] as number) - ay;
          if (dx * dx + dy * dy <= reachSq) pushPair(a, b);
        }
      }
    }
    // Sort this ball's partners ascending, so ties break the same way as
    // without the hash. Lists are short; insertion sort.
    for (let i = first + 1; i < pairB.length; i++) {
      const v = pairB[i] as number;
      let j = i - 1;
      while (j >= first && (pairB[j] as number) > v) {
        pairB[j + 1] = pairB[j] as number;
        j--;
      }
      pairB[j + 1] = v;
    }
  }
}

function pushPair(a: number, b: number): void {
  pairA.push(a);
  pairB.push(b);
}

/**
 * Move the balls in pairs together through the step, earliest event first.
 * An event is one ball meeting a nail, rail, or pocket (exactly as when it
 * moves alone) or two balls meeting. Every ball's position is kept at its
 * own time, SIM_STEP_S − remaining[i], and only advanced to the time of its
 * own next event, so a ball that meets no other ball takes exactly the same
 * path, to the bit, as it would alone. Ties go to the lowest ball index, and
 * nail, rail and pocket events before ball contacts.
 */
function moveTogether(world: World): void {
  const { balls } = world;
  const n = balls.length;
  const pairs = pairA.length;
  if (pairRemaining.length < pairs) {
    const size = Math.max(pairs, 2 * pairRemaining.length);
    pairRemaining = new Float64Array(size);
    pairNx = new Float64Array(size);
    pairNy = new Float64Array(size);
  }
  for (let i = 0; i < n; i++) {
    if (mode[i] !== TOGETHER) continue;
    remaining[i] = SIM_STEP_S;
    impactCount[i] = 0;
    touchedAny[i] = 0;
    contactRoot[i] = i;
    slideCircle[i] = -1;
    slideSegment[i] = -1;
    stepSensors[i] = null;
    findBallEvent(world, i);
  }
  for (let p = 0; p < pairs; p++) findPairEvent(balls, p);

  for (;;) {
    // Latest remaining time is the earliest event. Strict comparisons keep
    // the first found on a tie.
    let bestRemaining = -1;
    let bestBall = -1;
    let bestPair = -1;
    for (let i = 0; i < n; i++) {
      if (mode[i] === TOGETHER && (eventRemaining[i] as number) > bestRemaining) {
        bestRemaining = eventRemaining[i] as number;
        bestBall = i;
      }
    }
    for (let p = 0; p < pairs; p++) {
      if ((pairRemaining[p] as number) > bestRemaining) {
        bestRemaining = pairRemaining[p] as number;
        bestPair = p;
        bestBall = -1;
      }
    }
    if (bestRemaining < 0) break;

    if (bestBall >= 0) {
      const i = bestBall;
      const ball = balls[i] as Ball;
      const r = remaining[i] as number;
      const t = eventT[i] as number;
      const dx = ball.vx * r;
      const dy = ball.vy * r;
      ball.x += dx * t;
      ball.y += dy * t;
      const sensor = eventSensor[i] ?? null;
      if (sensor) {
        mode[i] = CAPTURED;
        stepSensors[i] = sensor;
        for (let p = 0; p < pairs; p++) {
          if (pairA[p] === i || pairB[p] === i) pairRemaining[p] = -1;
        }
        continue;
      }
      remaining[i] = r * (1 - t);
      const nx = eventNx[i] as number;
      const ny = eventNy[i] as number;
      const material = eventMaterial[i] as Material;
      // A resting contact leaves the ball sliding along the surface.
      const resting =
        -(ball.vx * nx + ball.vy * ny) < restingSpeedMps(material.restitution, GRAVITY_DV_MPS);
      slideCircle[i] = resting ? (eventCircle[i] as number) : -1;
      slideSegment[i] = resting ? (eventSegment[i] as number) : -1;
      resolveContact(ball, nx, ny, material, GRAVITY_DV_MPS);
      touchedAny[i] = 1;
      countImpact(ball, i);
      findBallEvent(world, i);
      for (let p = 0; p < pairs; p++) {
        if (pairA[p] === i || pairB[p] === i) findPairEvent(balls, p);
      }
    } else {
      const a = pairA[bestPair] as number;
      const b = pairB[bestPair] as number;
      const ballA = balls[a] as Ball;
      const ballB = balls[b] as Ball;
      const at = bestRemaining;
      ballA.x += ballA.vx * ((remaining[a] as number) - at);
      ballA.y += ballA.vy * ((remaining[a] as number) - at);
      ballB.x += ballB.vx * ((remaining[b] as number) - at);
      ballB.y += ballB.vy * ((remaining[b] as number) - at);
      remaining[a] = at;
      remaining[b] = at;
      slidingNormal(world, a, surfaceA);
      slidingNormal(world, b, surfaceB);
      resolveBallContact(
        ballA,
        ballB,
        pairNx[bestPair] as number,
        pairNy[bestPair] as number,
        BALL_RESTITUTION,
        GRAVITY_DV_MPS,
        surfaceA.x,
        surfaceA.y,
        surfaceB.x,
        surfaceB.y,
      );
      touchedAny[a] = 1;
      touchedAny[b] = 1;
      contactRoot[findRoot(a)] = findRoot(b);
      countImpact(ballA, a);
      countImpact(ballB, b);
      findBallEvent(world, a);
      findBallEvent(world, b);
      for (let p = 0; p < pairs; p++) {
        const pa = pairA[p];
        const pb = pairB[p];
        if (pa === a || pa === b || pb === a || pb === b) findPairEvent(balls, p);
      }
    }
  }

  // The rest of the step is clear for every ball still in play.
  for (let i = 0; i < n; i++) {
    if (mode[i] !== TOGETHER) continue;
    const ball = balls[i] as Ball;
    const r = remaining[i] as number;
    ball.x += ball.vx * r;
    ball.y += ball.vy * r;
  }
  guardEnergyTogether(balls);
}

const surfaceA = { x: 0, y: 0 };
const surfaceB = { x: 0, y: 0 };

/**
 * The unit normal of the nail or rail ball i is sliding along, pointing
 * toward the ball, into `out`; zero if it isn't sliding along one or has
 * since left it.
 */
function slidingNormal(world: World, i: number, out: { x: number; y: number }): void {
  const ball = world.balls[i] as Ball;
  out.x = 0;
  out.y = 0;
  let dx: number;
  let dy: number;
  let reach: number;
  const ci = slideCircle[i] as number;
  const si = slideSegment[i] as number;
  if (ci >= 0) {
    const c = world.circles[ci] as CircleShape;
    dx = ball.x - c.x;
    dy = ball.y - c.y;
    reach = BALL_RADIUS_M + c.radiusM;
  } else if (si >= 0) {
    const s = world.segments[si] as SegmentShape;
    const along = Math.min(s.lengthM, Math.max(0, (ball.x - s.ax) * s.ux + (ball.y - s.ay) * s.uy));
    dx = ball.x - (s.ax + s.ux * along);
    dy = ball.y - (s.ay + s.uy * along);
    reach = BALL_RADIUS_M;
  } else {
    return;
  }
  const dist = Math.hypot(dx, dy);
  if (dist > 0 && dist <= reach + CONTACT_SLOP_M) {
    out.x = dx / dist;
    out.y = dy / dist;
  }
}

/** Count an impact on ball i; a ball out of impacts with step time left is wedged and held still. */
function countImpact(ball: Ball, i: number): void {
  impactCount[i] = (impactCount[i] as number) + 1;
  if ((impactCount[i] as number) >= MAX_IMPACTS_PER_STEP && (remaining[i] as number) > 0) {
    ball.vx = 0;
    ball.vy = 0;
  }
}

function findRoot(i: number): number {
  while (contactRoot[i] !== i) {
    const up = contactRoot[i] as number;
    contactRoot[i] = contactRoot[up] as number;
    i = up;
  }
  return i;
}

/** Ball i's next nail, rail, or pocket event over the rest of its step. */
function findBallEvent(world: World, i: number): void {
  const ball = world.balls[i] as Ball;
  const r = remaining[i] as number;
  findStaticEvent(world, ball.x, ball.y, ball.vx * r, ball.vy * r, event);
  if (!event.sensor && !event.material) {
    eventRemaining[i] = -1;
    return;
  }
  eventRemaining[i] = r * (1 - event.t);
  eventT[i] = event.t;
  eventNx[i] = event.nx;
  eventNy[i] = event.ny;
  eventMaterial[i] = event.material;
  eventSensor[i] = event.sensor;
  eventCircle[i] = event.circle;
  eventSegment[i] = event.segment;
}

/**
 * When the balls of pair p next meet, if they do: sweep one centre against
 * a disc of twice the ball radius around the other, in the frame moving
 * with it, from the later of the two balls' own times.
 */
function findPairEvent(balls: readonly Ball[], p: number): void {
  const a = pairA[p] as number;
  const b = pairB[p] as number;
  if (mode[a] !== TOGETHER || mode[b] !== TOGETHER) {
    pairRemaining[p] = -1;
    return;
  }
  const ballA = balls[a] as Ball;
  const ballB = balls[b] as Ball;
  const ra = remaining[a] as number;
  const rb = remaining[b] as number;
  const r = Math.min(ra, rb);
  const mx = ballA.x + ballA.vx * (ra - r) - (ballB.x + ballB.vx * (rb - r));
  const my = ballA.y + ballA.vy * (ra - r) - (ballB.y + ballB.vy * (rb - r));
  const dx = (ballA.vx - ballB.vx) * r;
  const dy = (ballA.vy - ballB.vy) * r;
  if (!sweepDisc(mx, my, dx, dy, 0, 0, PAIR_CONTACT_M, hit)) {
    pairRemaining[p] = -1;
    return;
  }
  if (hit.t === 0) {
    // Already touching. After a resting contact the balls move on together,
    // and rounding can leave them closing at 1e-20 m/s: an impact the
    // impulse can't remove, which would repeat until the pair ran out of
    // impacts. Ignore an approach that stays within the contact slop for
    // the rest of the step. Moving apart sideways only adds to the gap.
    const dist = Math.hypot(mx, my);
    if (dist + (dx * mx + dy * my) / dist >= PAIR_CONTACT_M - CONTACT_SLOP_M) {
      pairRemaining[p] = -1;
      return;
    }
  }
  pairRemaining[p] = r * (1 - hit.t);
  pairNx[p] = hit.nx;
  pairNy[p] = hit.ny;
}

/**
 * The energy guard (dissipateContactError) for balls that moved together.
 * Balls that touched each other share energy, so it applies to each group
 * of balls joined by contacts as a whole: if the group's energy rose, the
 * excess comes out of its kinetic energy, and if that can't cover it, the
 * group goes back to where it started the step, at rest. A ball that touched
 * no other ball is a group of one, guarded exactly as when it moves alone.
 *
 * A ball sent back must not land on one that has since moved into its
 * starting place (it can't have touched it on the way, or they would be one
 * group), so that one's group goes back too, until nothing overlaps. Balls
 * outside the moving set started too far away to reach any starting place.
 */
function guardEnergyTogether(balls: readonly Ball[]): void {
  const n = balls.length;
  let anyRevert = false;
  for (let root = 0; root < n; root++) {
    if (mode[root] === 0 || findRoot(root) !== root) continue;
    let energy0 = 0;
    let energy1 = 0;
    let kinetic = 0;
    let touched = false;
    for (let i = 0; i < n; i++) {
      if (mode[i] === 0 || findRoot(i) !== root) continue;
      const ball = balls[i] as Ball;
      if (touchedAny[i]) touched = true;
      energy0 += startEnergy[i] as number;
      energy1 += specificEnergy(ball);
      if (mode[i] === TOGETHER) kinetic += 0.5 * (ball.vx * ball.vx + ball.vy * ball.vy);
    }
    if (!touched) continue;
    const excess = energy1 - energy0;
    if (!(excess > 0)) continue;
    if (kinetic > excess) {
      const k = Math.sqrt((kinetic - excess) / kinetic);
      energy1 = 0;
      for (let i = 0; i < n; i++) {
        if (mode[i] === 0 || findRoot(i) !== root) continue;
        const ball = balls[i] as Ball;
        if (mode[i] === TOGETHER) {
          ball.vx *= k;
          ball.vy *= k;
        }
        energy1 += specificEnergy(ball);
      }
      // Rounding in the rescale can leave the last ulp of excess behind.
      if (energy1 <= energy0) continue;
    }
    markGroupRevert(root, n);
    anyRevert = true;
  }
  if (!anyRevert) return;

  for (let grew = true; grew;) {
    grew = false;
    for (let k = 0; k < n; k++) {
      if (mode[k] !== TOGETHER || revert[k]) continue;
      const ball = balls[k] as Ball;
      for (let i = 0; i < n; i++) {
        if (!revert[i]) continue;
        const d = Math.hypot(ball.x - (startX[i] as number), ball.y - (startY[i] as number));
        if (d < BALL_PAIR_CLEARANCE_M) {
          markGroupRevert(findRoot(k), n);
          grew = true;
          break;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (!revert[i]) continue;
    const ball = balls[i] as Ball;
    ball.x = startX[i] as number;
    ball.y = startY[i] as number;
    ball.vx = 0;
    ball.vy = 0;
  }
}

function markGroupRevert(root: number, n: number): void {
  for (let i = 0; i < n; i++) {
    if (mode[i] === TOGETHER && findRoot(i) === root) revert[i] = 1;
  }
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
