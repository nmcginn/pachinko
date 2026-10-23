// Ball vs circle (nails) and ball vs segment (rails), M1; ball vs ball, M5.
//
// Collisions are swept, not overlap-and-push: each test takes the ball's
// motion for the rest of the step and returns the earliest time of impact.
// The world moves the ball to that point, resolves the impulse, and sweeps
// again with what is left of the step. A ball therefore never ends a step
// inside geometry, at any speed, and nothing ever pushes a ball out of a
// shape. Pushing out would add potential energy from nowhere; see PHYSICS.md.
//
// Hot-path functions take numbers and write into a caller-owned Hit so the
// step allocates nothing.

import type { Vec2 } from './vec';

/** Surface response parameters for one kind of geometry. Tuning knobs; see PHYSICS.md. */
export interface Material {
  /** Normal restitution, in [0, 1). 1 is excluded on purpose; see PHYSICS.md. */
  readonly restitution: number;
  /** Coulomb coefficient on the tangential impulse, ≥ 0. */
  readonly friction: number;
}

export interface CircleShape {
  readonly kind: 'circle';
  readonly x: number;
  readonly y: number;
  readonly radiusM: number;
  readonly material: Material;
}

/** A straight piece of rail, zero thickness. Rails are polylines of these. */
export interface SegmentShape {
  readonly kind: 'segment';
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  /** Unit direction a → b. */
  readonly ux: number;
  readonly uy: number;
  readonly lengthM: number;
  readonly material: Material;
}

/** Earliest impact found by a sweep. Written in place by the sweep functions. */
export interface Hit {
  /** Fraction of the swept displacement at impact, in [0, 1]. */
  t: number;
  /** Unit contact normal at impact, pointing from the shape toward the ball. */
  nx: number;
  ny: number;
}

/** Mutable ball kinematics. Position in m, velocity in m/s, y up. */
export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * A ball within this distance of a surface counts as touching it. Covers
 * floating-point error after the ball is placed exactly at a time of impact.
 */
export const CONTACT_SLOP_M = 1e-9;

/**
 * A touching ball whose approach direction is within this angle (rad) of
 * tangent is treated as sliding along the surface, not into it. Without it,
 * rounding left over from the previous impulse looks like a fresh impact.
 */
const GRAZE_EPS = 1e-9;

export function createHit(): Hit {
  return { t: 1, nx: 0, ny: 0 };
}

export function validateMaterial(m: Material): void {
  if (!(m.restitution >= 0 && m.restitution < 1)) {
    throw new RangeError(`restitution must be in [0, 1), got ${m.restitution}`);
  }
  if (!(m.friction >= 0 && Number.isFinite(m.friction))) {
    throw new RangeError(`friction must be finite and ≥ 0, got ${m.friction}`);
  }
}

export function createCircle(center: Vec2, radiusM: number, material: Material): CircleShape {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    throw new RangeError('circle center must be finite');
  }
  if (!(radiusM > 0 && Number.isFinite(radiusM))) {
    throw new RangeError(`circle radius must be finite and > 0, got ${radiusM}`);
  }
  validateMaterial(material);
  return { kind: 'circle', x: center.x, y: center.y, radiusM, material };
}

export function createSegment(a: Vec2, b: Vec2, material: Material): SegmentShape {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) {
    throw new RangeError('segment endpoints must be finite');
  }
  const lengthM = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(lengthM > 0)) throw new RangeError('segment endpoints must differ');
  validateMaterial(material);
  return {
    kind: 'segment',
    ax: a.x,
    ay: a.y,
    bx: b.x,
    by: b.y,
    ux: (b.x - a.x) / lengthM,
    uy: (b.y - a.y) / lengthM,
    lengthM,
    material,
  };
}

/** Consecutive segments along a polyline. Needs at least two points. */
export function createPolyline(points: readonly Vec2[], material: Material): SegmentShape[] {
  if (points.length < 2) throw new RangeError('a polyline needs at least two points');
  const segments: SegmentShape[] = [];
  for (let i = 1; i < points.length; i++) {
    // Indexes are in range by the loop bounds.
    segments.push(createSegment(points[i - 1] as Vec2, points[i] as Vec2, material));
  }
  return segments;
}

/**
 * Sweep a point from (px, py) by (dx, dy) against a disc of radius rM
 * centred at (cx, cy). For a ball of radius R against a nail of radius r,
 * pass rM = R + r. Writes the impact into `hit` and returns true if the
 * point reaches the disc boundary within the sweep while moving inward.
 */
export function sweepDisc(
  px: number,
  py: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  rM: number,
  hit: Hit,
): boolean {
  const mx = px - cx;
  const my = py - cy;
  const distSq = mx * mx + my * my;
  const b = mx * dx + my * dy;
  const touch = rM + CONTACT_SLOP_M;

  if (distSq <= touch * touch) {
    // Already touching (or inside, which only rounding can cause): an
    // impact now if moving inward, nothing otherwise.
    const dist = Math.sqrt(distSq);
    const dLen = Math.hypot(dx, dy);
    if (!(b < -GRAZE_EPS * dist * dLen)) return false;
    hit.t = 0;
    hit.nx = mx / dist;
    hit.ny = my / dist;
    return true;
  }

  const a = dx * dx + dy * dy;
  if (a === 0 || b >= 0) return false;
  const c = distSq - rM * rM;
  const disc = b * b - a * c;
  if (disc < 0) return false;
  // Smaller root of a t² + 2 b t + c = 0, written to avoid cancellation (b < 0).
  const t = c / (-b + Math.sqrt(disc));
  if (t > 1) return false;
  const hx = mx + dx * t;
  const hy = my + dy * t;
  const hLen = Math.hypot(hx, hy);
  hit.t = t;
  hit.nx = hx / hLen;
  hit.ny = hy / hLen;
  return true;
}

/**
 * Margin on moveOutOfReach. The sweeps' rounding is around 1e-15 m at board
 * scale and their contact slop 1e-9 m; this is far beyond both.
 */
export const REACH_SLOP_M = 1e-6;

/**
 * Whether a point moving from (px, py) by (dx, dy) stays out of reach of the
 * box [minX, maxX] × [minY, maxY]: along x or along y, every point of the move
 * is more than rM + REACH_SLOP_M from it. If so, sweepDisc against a disc of
 * radius rM centred in the box, and sweepCapsule of radius rM against a
 * segment inside it, both report no hit, so a caller may skip them. Cheaper
 * than either sweep; the world culls most of a grid cell's shapes with it.
 */
export function moveOutOfReach(
  px: number,
  py: number,
  dx: number,
  dy: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  rM: number,
): boolean {
  const reach = rM + REACH_SLOP_M;
  return (
    Math.min(px, px + dx) > maxX + reach ||
    Math.max(px, px + dx) < minX - reach ||
    Math.min(py, py + dy) > maxY + reach ||
    Math.max(py, py + dy) < minY - reach
  );
}

const capHit = createHit();

/**
 * Sweep a point against the capsule of radius rM around a segment: the set of
 * points within rM of it. For a ball of radius R against a rail, pass rM = R.
 */
export function sweepCapsule(
  px: number,
  py: number,
  dx: number,
  dy: number,
  seg: SegmentShape,
  rM: number,
  hit: Hit,
): boolean {
  const { ax, ay, ux, uy, lengthM } = seg;
  // Normal to the segment (u rotated 90° counter-clockwise).
  const nx = -uy;
  const ny = ux;
  const relX = px - ax;
  const relY = py - ay;
  const along = relX * ux + relY * uy;
  const h = relX * nx + relY * ny;

  // Closest point on the segment, to decide whether we already touch it.
  const s = Math.min(lengthM, Math.max(0, along));
  const mx = relX - ux * s;
  const my = relY - uy * s;
  const distSq = mx * mx + my * my;
  const touch = rM + CONTACT_SLOP_M;

  if (distSq <= touch * touch) {
    const dist = Math.sqrt(distSq);
    const dLen = Math.hypot(dx, dy);
    if (dist > 0) {
      const b = mx * dx + my * dy;
      if (!(b < -GRAZE_EPS * dist * dLen)) return false;
      hit.t = 0;
      hit.nx = mx / dist;
      hit.ny = my / dist;
      return true;
    }
    // Exactly on the segment line (only rounding gets a ball here): push
    // back against whichever side it is moving toward.
    const dn = dx * nx + dy * ny;
    if (!(Math.abs(dn) > GRAZE_EPS * dLen)) return false;
    const sign = dn > 0 ? -1 : 1;
    hit.t = 0;
    hit.nx = nx * sign;
    hit.ny = ny * sign;
    return true;
  }

  let found = false;
  let bestT = Infinity;

  // Flat side facing the ball.
  const side = h >= 0 ? 1 : -1;
  const approach = side * (dx * nx + dy * ny);
  if (approach < 0) {
    const t = (side * h - rM) / -approach;
    if (t >= 0 && t <= 1) {
      const q = along + t * (dx * ux + dy * uy);
      if (q >= 0 && q <= lengthM) {
        found = true;
        bestT = t;
        hit.t = t;
        hit.nx = nx * side;
        hit.ny = ny * side;
      }
    }
  }

  // Rounded ends. Only needed when the flat side wasn't hit first.
  if (!found || bestT > 0) {
    if (sweepDisc(px, py, dx, dy, ax, ay, rM, capHit) && capHit.t < bestT) {
      found = true;
      bestT = capHit.t;
      hit.t = capHit.t;
      hit.nx = capHit.nx;
      hit.ny = capHit.ny;
    }
    if (sweepDisc(px, py, dx, dy, seg.bx, seg.by, rM, capHit) && capHit.t < bestT) {
      found = true;
      hit.t = capHit.t;
      hit.nx = capHit.nx;
      hit.ny = capHit.ny;
    }
  }
  return found;
}

/**
 * Below this approach speed an impact is treated as perfectly inelastic.
 * Derivation in PHYSICS.md ("Energy and the resting threshold"): at or above
 * it, a bounce cannot hand back more energy than the step's gravity term
 * takes, so total energy never increases. Below it, bouncing would add a
 * little energy every step and a resting ball would jitter.
 *
 * @param gravityDvMps in-plane gravity × timestep: the speed gravity adds per step.
 */
export function restingSpeedMps(restitution: number, gravityDvMps: number): number {
  return (2 * gravityDvMps) / (1 - restitution);
}

/**
 * Most tangential speed one impact can take from a solid sphere with no
 * spin: friction spins it up until it rolls, at 5/7 of its sliding speed.
 */
export const MAX_FRICTION_LOSS = 2 / 7;

/**
 * Apply the contact impulse for unit normal (nx, ny) to the ball's velocity.
 * Does nothing if the ball is separating.
 *
 * An impact (approach speed at or above the resting threshold) bounces with
 * the material's restitution, and Coulomb friction removes up to
 * `friction × normal impulse` of tangential speed, capped at
 * MAX_FRICTION_LOSS of it. A resting contact (slower approach) only cancels
 * the approach: the ball is rolling along the surface, and a rolling ball
 * feels no sliding friction. Without that split a ball would perch on top of
 * a nail, or stall on a gentle rail, held by friction it does not have.
 */
export function resolveContact(
  ball: BallState,
  nx: number,
  ny: number,
  material: Material,
  gravityDvMps: number,
): void {
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn >= 0) return;
  const resting = -vn < restingSpeedMps(material.restitution, gravityDvMps);
  const e = resting ? 0 : material.restitution;
  const jn = -(1 + e) * vn;

  const tx = ball.vx - vn * nx;
  const ty = ball.vy - vn * ny;
  const vt = Math.hypot(tx, ty);
  const drop = resting ? 0 : Math.min(material.friction * jn, MAX_FRICTION_LOSS * vt);
  const keep = vt > 0 ? (vt - drop) / vt : 0;

  const vnAfter = -e * vn;
  ball.vx = tx * keep + vnAfter * nx;
  ball.vy = ty * keep + vnAfter * ny;
}

/**
 * Apply the contact impulse between two balls of equal mass, for unit
 * normal (nx, ny) pointing from b toward a. Does nothing if they are
 * separating.
 *
 * Normal restitution only: the contact is frictionless (PHYSICS.md, "Ball
 * against ball"). Below the resting threshold on their approach speed the
 * impact is perfectly inelastic, so a ball lying on another one sits still
 * instead of bouncing every step, as on a rail. Momentum is conserved, and
 * kinetic energy falls by (1 − e²)·vn²/4 per unit mass, so the pair never
 * gains energy.
 *
 * A ball sliding along a nail or rail can be given that surface's normal
 * (pointing toward the ball; zero for none). If the impulse pushes the ball
 * into it, the ball only moves along it and the surface takes the rest, in
 * the same impulse. Without that, a ball lying on a ball that lies on a rail
 * would need the two contacts resolved in turn, over and over, each undoing
 * a little of the other, and the pair would run out of impacts and stop.
 */
export function resolveBallContact(
  a: BallState,
  b: BallState,
  nx: number,
  ny: number,
  restitution: number,
  gravityDvMps: number,
  aSurfaceNx = 0,
  aSurfaceNy = 0,
  bSurfaceNx = 0,
  bSurfaceNy = 0,
): void {
  const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (vn >= 0) return;
  const e = -vn < restingSpeedMps(restitution, gravityDvMps) ? 0 : restitution;
  // The impulse pushes a along +n and b along −n. Into its surface (a
  // negative component along the surface normal), a ball keeps only the part
  // along the surface, and the pair's effective mass along n rises to match.
  const intoA = Math.min(0, nx * aSurfaceNx + ny * aSurfaceNy);
  const intoB = Math.min(0, -(nx * bSurfaceNx + ny * bSurfaceNy));
  const k = 2 - intoA * intoA - intoB * intoB;
  if (!(k > 0)) return; // Both held along n by their surfaces: neither can move.
  // Each ball's share of the change in relative normal speed.
  const j = (-(1 + e) * vn) / k;
  a.vx += j * (nx - intoA * aSurfaceNx);
  a.vy += j * (ny - intoA * aSurfaceNy);
  b.vx -= j * (nx + intoB * bSurfaceNx);
  b.vy -= j * (ny + intoB * bSurfaceNy);
}
