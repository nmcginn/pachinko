// Sensor regions: pockets. A sensor has no physical response; a ball whose
// centre enters it is captured and leaves play. Physical walls around a
// pocket (the cup of the start pocket) are ordinary rails.
//
// Entry is tested against the ball's actual path through the step, piece by
// piece between impacts, so a fast ball can't skip a thin sensor.

import type { Vec2 } from './vec';

export interface SensorShape {
  readonly kind: 'sensor';
  readonly id: string;
  /** Polygon vertices, flattened as x0, y0, x1, y1, … Closed implicitly. */
  readonly points: readonly number[];
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Build a sensor from a simple polygon (at least three vertices, no edge
 * crossing another, nonzero area). Winding order doesn't matter.
 */
export function createSensor(id: string, polygon: readonly Vec2[]): SensorShape {
  const problem = polygonProblem(polygon);
  if (problem) throw new RangeError(`sensor ${id}: ${problem}`);
  const points: number[] = [];
  for (const p of polygon) points.push(p.x, p.y);
  return {
    kind: 'sensor',
    id,
    points,
    minX: Math.min(...polygon.map((p) => p.x)),
    minY: Math.min(...polygon.map((p) => p.y)),
    maxX: Math.max(...polygon.map((p) => p.x)),
    maxY: Math.max(...polygon.map((p) => p.y)),
  };
}

/** Why a polygon can't be a sensor, or null if it can. Shared with the board validator. */
export function polygonProblem(polygon: readonly Vec2[]): string | null {
  if (polygon.length < 3) return `needs at least 3 vertices, got ${polygon.length}`;
  if (!polygon.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
    return 'vertices must be finite';
  }
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Neighbouring edges share a vertex by construction; skip them.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = polygon[i] as Vec2;
      const b = polygon[(i + 1) % n] as Vec2;
      const c = polygon[j] as Vec2;
      const d = polygon[(j + 1) % n] as Vec2;
      if (segmentsIntersect(a, b, c, d)) return `edges ${i} and ${j} cross`;
    }
  }
  // After the crossing check: a symmetric bow tie also has zero signed area.
  if (!(Math.abs(signedArea(polygon)) > 0)) return 'has zero area';
  return null;
}

function signedArea(polygon: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Vec2;
    const b = polygon[(i + 1) % polygon.length] as Vec2;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

/** Closed segments ab and cd share at least one point. */
function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b))
  );
}

/** Even-odd point-in-polygon test. Points exactly on an edge may fall either way. */
export function sensorContains(sensor: SensorShape, x: number, y: number): boolean {
  if (x < sensor.minX || x > sensor.maxX || y < sensor.minY || y > sensor.maxY) return false;
  const p = sensor.points;
  const n = p.length;
  let inside = false;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = p[i] as number;
    const yi = p[i + 1] as number;
    const xj = p[j] as number;
    const yj = p[j + 1] as number;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Fraction in [0, 1] along the move from (x0, y0) by (dx, dy) at which the
 * point enters the sensor, or Infinity if it doesn't. 0 if it starts inside.
 */
export function sensorEntryT(
  sensor: SensorShape,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
): number {
  const x1 = x0 + dx;
  const y1 = y0 + dy;
  if (
    Math.max(x0, x1) < sensor.minX ||
    Math.min(x0, x1) > sensor.maxX ||
    Math.max(y0, y1) < sensor.minY ||
    Math.min(y0, y1) > sensor.maxY
  ) {
    return Infinity;
  }
  if (sensorContains(sensor, x0, y0)) return 0;
  const p = sensor.points;
  const n = p.length;
  let best = Infinity;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const ax = p[j] as number;
    const ay = p[j + 1] as number;
    const ex = (p[i] as number) - ax;
    const ey = (p[i + 1] as number) - ay;
    const denom = dx * ey - dy * ex;
    if (denom === 0) continue; // parallel: entering through a vertex is caught by the next edge
    const qx = ax - x0;
    const qy = ay - y0;
    const t = (qx * ey - qy * ex) / denom;
    const u = (qx * dy - qy * dx) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}
