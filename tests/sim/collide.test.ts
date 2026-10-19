import { describe, expect, it } from 'vitest';
import {
  type BallState,
  type Material,
  CONTACT_SLOP_M,
  MAX_FRICTION_LOSS,
  createCircle,
  createHit,
  createPolyline,
  createSegment,
  resolveContact,
  restingSpeedMps,
  sweepCapsule,
  sweepDisc,
} from '../../src/sim/collide';

const STEEL: Material = { restitution: 0.5, friction: 0.2 };
const SLICK: Material = { restitution: 0.5, friction: 0 };

describe('shape factories', () => {
  it('builds a circle and rejects bad input', () => {
    expect(createCircle({ x: 1, y: 2 }, 0.001, STEEL)).toMatchObject({
      kind: 'circle',
      x: 1,
      y: 2,
    });
    expect(() => createCircle({ x: 0, y: 0 }, 0, STEEL)).toThrow(RangeError);
    expect(() => createCircle({ x: 0, y: 0 }, -1, STEEL)).toThrow(RangeError);
    expect(() => createCircle({ x: NaN, y: 0 }, 1, STEEL)).toThrow(RangeError);
    expect(() => createCircle({ x: 0, y: 0 }, Infinity, STEEL)).toThrow(RangeError);
  });

  it('builds a segment with a unit direction and rejects degenerate ones', () => {
    const s = createSegment({ x: 0, y: 0 }, { x: 3, y: 4 }, STEEL);
    expect(s.lengthM).toBe(5);
    expect(s.ux).toBeCloseTo(0.6, 15);
    expect(s.uy).toBeCloseTo(0.8, 15);
    expect(() => createSegment({ x: 1, y: 1 }, { x: 1, y: 1 }, STEEL)).toThrow(RangeError);
    expect(() => createSegment({ x: 0, y: 0 }, { x: Infinity, y: 0 }, STEEL)).toThrow(RangeError);
  });

  it('builds polylines piece by piece and needs two points', () => {
    const line = createPolyline(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      STEEL,
    );
    expect(line).toHaveLength(2);
    expect(line[1]).toMatchObject({ ax: 1, ay: 0, bx: 1, by: 1 });
    expect(() => createPolyline([{ x: 0, y: 0 }], STEEL)).toThrow(RangeError);
    expect(() => createPolyline([], STEEL)).toThrow(RangeError);
  });

  it('rejects materials outside the energy-safe range', () => {
    // Restitution 1 is excluded on purpose (PHYSICS.md): a perfectly elastic
    // bounce under discrete gravity can gain energy.
    for (const restitution of [1, 1.2, -0.1, NaN]) {
      expect(() => createCircle({ x: 0, y: 0 }, 1, { restitution, friction: 0 })).toThrow(
        RangeError,
      );
    }
    for (const friction of [-0.1, NaN, Infinity]) {
      expect(() => createCircle({ x: 0, y: 0 }, 1, { restitution: 0.5, friction })).toThrow(
        RangeError,
      );
    }
  });
});

describe('sweepDisc', () => {
  const hit = createHit();

  it('finds the time of impact on a head-on approach', () => {
    // From x = -3 toward a disc of radius 1 at the origin: contact at x = -1.
    expect(sweepDisc(-3, 0, 4, 0, 0, 0, 1, hit)).toBe(true);
    expect(hit.t).toBeCloseTo(0.5, 15);
    expect(hit.nx).toBeCloseTo(-1, 15);
    expect(hit.ny).toBeCloseTo(0, 15);
  });

  it('gives the surface normal at an off-centre impact', () => {
    expect(sweepDisc(-3, 0.6, 4, 0, 0, 0, 1, hit)).toBe(true);
    expect(hit.nx).toBeCloseTo(-0.8, 12);
    expect(hit.ny).toBeCloseTo(0.6, 12);
    expect(hit.t).toBeCloseTo((3 - 0.8) / 4, 12);
  });

  it('misses when the path passes by, falls short, or moves away', () => {
    expect(sweepDisc(-3, 1.5, 4, 0, 0, 0, 1, hit)).toBe(false);
    expect(sweepDisc(-3, 0, 1, 0, 0, 0, 1, hit)).toBe(false);
    expect(sweepDisc(-3, 0, -4, 0, 0, 0, 1, hit)).toBe(false);
  });

  it('does nothing with zero displacement', () => {
    expect(sweepDisc(-3, 0, 0, 0, 0, 0, 1, hit)).toBe(false);
    expect(sweepDisc(-1, 0, 0, 0, 0, 0, 1, hit)).toBe(false);
  });

  it('reports an immediate impact when touching and moving in', () => {
    expect(sweepDisc(-1, 0, 0.1, 0.05, 0, 0, 1, hit)).toBe(true);
    expect(hit.t).toBe(0);
    expect(hit.nx).toBeCloseTo(-1, 15);
  });

  it('lets a touching point slide along or leave', () => {
    expect(sweepDisc(-1, 0, 0, 0.1, 0, 0, 1, hit)).toBe(false); // tangent
    expect(sweepDisc(-1, 0, -0.1, 0, 0, 0, 1, hit)).toBe(false); // leaving
  });

  it('counts a point within the contact slop as touching', () => {
    expect(sweepDisc(-1 - CONTACT_SLOP_M / 2, 0, 0.1, 0, 0, 0, 1, hit)).toBe(true);
    expect(hit.t).toBe(0);
  });

  it('catches a disc much smaller than one step of travel', () => {
    expect(sweepDisc(-100, 0, 200, 0, 0, 0, 0.01, hit)).toBe(true);
    expect(hit.t).toBeCloseTo((100 - 0.01) / 200, 12);
  });
});

describe('sweepCapsule', () => {
  const hit = createHit();
  const floor = createSegment({ x: -1, y: 0 }, { x: 1, y: 0 }, STEEL);

  it('hits the flat side from either face', () => {
    expect(sweepCapsule(0, 1, 0, -2, floor, 0.5, hit)).toBe(true);
    expect(hit.t).toBeCloseTo(0.25, 15);
    expect(hit.nx).toBeCloseTo(0, 15);
    expect(hit.ny).toBeCloseTo(1, 15);
    expect(sweepCapsule(0, -1, 0, 2, floor, 0.5, hit)).toBe(true);
    expect(hit.ny).toBeCloseTo(-1, 15);
  });

  it('hits the rounded ends past the segment', () => {
    // Heading straight left at the right end cap.
    expect(sweepCapsule(3, 0, -4, 0, floor, 0.5, hit)).toBe(true);
    expect(hit.t).toBeCloseTo(1.5 / 4, 15);
    expect(hit.nx).toBeCloseTo(1, 15);
    // Diagonally onto the corner of the left end.
    expect(sweepCapsule(-2, 1, 1, -1, floor, 0.5, hit)).toBe(true);
    expect(hit.nx).toBeLessThan(0);
    expect(hit.ny).toBeGreaterThan(0);
  });

  it('misses a parallel path and a path that stops short', () => {
    expect(sweepCapsule(-3, 1, 6, 0, floor, 0.5, hit)).toBe(false);
    expect(sweepCapsule(0, 1, 0, -0.4, floor, 0.5, hit)).toBe(false);
  });

  it('reports an immediate impact when resting on it and pressed in', () => {
    expect(sweepCapsule(0.3, 0.5, 0.01, -0.01, floor, 0.5, hit)).toBe(true);
    expect(hit.t).toBe(0);
    expect(hit.ny).toBeCloseTo(1, 15);
  });

  it('lets a resting point roll along it', () => {
    expect(sweepCapsule(0.3, 0.5, 0.1, 0, floor, 0.5, hit)).toBe(false);
  });

  it('cannot be crossed even when the step is far longer than the capsule is thick', () => {
    expect(sweepCapsule(0, 100, 1, -200, floor, 0.001, hit)).toBe(true);
    expect(hit.t).toBeCloseTo((100 - 0.001) / 200, 12);
    expect(hit.ny).toBe(1);
  });

  it('pushes back against the direction of travel when exactly on the line', () => {
    expect(sweepCapsule(0, 0, 0, -1, floor, 0.5, hit)).toBe(true);
    expect(hit.t).toBe(0);
    expect(hit.ny).toBe(1);
    expect(sweepCapsule(0, 0, 1, 0, floor, 0.5, hit)).toBe(false);
  });
});

describe('resolveContact', () => {
  const g = 0.005; // speed gravity adds per step, m/s
  const fast = 1; // well above any resting threshold here

  it('bounces with the material restitution', () => {
    const ball: BallState = { x: 0, y: 0, vx: 0, vy: -fast };
    resolveContact(ball, 0, 1, SLICK, g);
    expect(ball.vy).toBeCloseTo(0.5, 15);
    expect(ball.vx).toBe(0);
  });

  it('applies Coulomb friction to the tangential speed on impact', () => {
    // Normal impulse 1.5 × friction 0.2 = 0.3 off a tangential speed of 2.
    const ball: BallState = { x: 0, y: 0, vx: 2, vy: -fast };
    resolveContact(ball, 0, 1, STEEL, g);
    expect(ball.vx).toBeCloseTo(1.7, 12);
    expect(ball.vy).toBeCloseTo(0.5, 15);
  });

  it('caps friction where a sphere starts to roll, and never reverses it', () => {
    const grippy: Material = { restitution: 0.5, friction: 10 };
    const ball: BallState = { x: 0, y: 0, vx: 0.1, vy: -fast };
    resolveContact(ball, 0, 1, grippy, g);
    expect(ball.vx).toBeCloseTo(0.1 * (1 - MAX_FRICTION_LOSS), 15);
  });

  it('treats a slow approach as resting: no bounce, no friction', () => {
    const threshold = restingSpeedMps(STEEL.restitution, g);
    expect(threshold).toBeCloseTo(0.02, 15);
    const ball: BallState = { x: 0, y: 0, vx: 0.3, vy: -threshold * 0.99 };
    resolveContact(ball, 0, 1, STEEL, g);
    expect(ball.vy).toBe(0);
    expect(ball.vx).toBe(0.3);
  });

  it('bounces normally right at the threshold', () => {
    const threshold = restingSpeedMps(STEEL.restitution, g);
    const ball: BallState = { x: 0, y: 0, vx: 0, vy: -threshold };
    resolveContact(ball, 0, 1, STEEL, g);
    expect(ball.vy).toBeCloseTo(threshold * 0.5, 15);
  });

  it('leaves a separating ball alone', () => {
    const ball: BallState = { x: 0, y: 0, vx: 1, vy: 0.2 };
    resolveContact(ball, 0, 1, STEEL, g);
    expect(ball).toEqual({ x: 0, y: 0, vx: 1, vy: 0.2 });
  });

  it('works along a slanted normal and never adds speed', () => {
    const n = Math.SQRT1_2;
    for (const [vx, vy] of [
      [-1, -1],
      [-2, 0.5],
      [0.3, -3],
    ] as const) {
      const ball: BallState = { x: 0, y: 0, vx, vy };
      const before = Math.hypot(vx, vy);
      resolveContact(ball, n, n, STEEL, g);
      expect(Math.hypot(ball.vx, ball.vy)).toBeLessThanOrEqual(before);
      expect(ball.vx * n + ball.vy * n).toBeGreaterThanOrEqual(0);
    }
  });
});
