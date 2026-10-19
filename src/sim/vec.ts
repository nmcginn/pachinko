// 2D vector math. Small pure functions over plain {x, y} objects.
//
// The per-step hot path in world.ts and collide.ts works on number fields
// directly so it allocates nothing; these are for geometry setup, tests, and
// anywhere clarity beats a few allocations.

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** z component of the 3D cross product: positive when b is counter-clockwise from a. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lengthSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Unit vector in the direction of a. Throws on the zero vector, which has no direction. */
export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  if (!(len > 0)) throw new RangeError('cannot normalize a zero-length vector');
  return { x: a.x / len, y: a.y / len };
}

/** a rotated 90° counter-clockwise. */
export function perp(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function isFiniteVec(a: Vec2): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y);
}

/** Closest point to p on segment ab. A degenerate segment (a = b) returns a. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const lenSq = lengthSq(ab);
  if (lenSq === 0) return a;
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / lenSq));
  return lerp(a, b, t);
}
