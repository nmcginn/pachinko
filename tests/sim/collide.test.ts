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
  moveOutOfReach,
  REACH_SLOP_M,
  resolveContact,
  restingSpeedMps,
  sweepCapsule,
  sweepDisc,
} from '../../src/sim/collide';
import { createRng } from '../../src/sim/rng';

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

describe('moveOutOfReach', () => {
  it('is true only when the move stays more than rM + REACH_SLOP_M away along x or y', () => {
    // A box at the origin (a point, as for a nail), rM = 1.
    const far = 1 + 2 * REACH_SLOP_M;
    const near = 1 + REACH_SLOP_M / 2;
    expect(moveOutOfReach(-far, 0, 0, 0, 0, 0, 0, 0, 1)).toBe(true);
    expect(moveOutOfReach(-near, 0, 0, 0, 0, 0, 0, 0, 1)).toBe(false);
    expect(moveOutOfReach(0, far, 0, 0, 0, 0, 0, 0, 1)).toBe(true);
    expect(moveOutOfReach(0, near, 0, 0, 0, 0, 0, 0, 1)).toBe(false);
    // Off along both axes, but within reach along each: not out of reach,
    // though the corner is further than rM away. The test is a box.
    expect(moveOutOfReach(-0.9, 0.9, 0, 0, 0, 0, 0, 0, 1)).toBe(false);
  });

  it('takes the whole move into account, in either direction', () => {
    expect(moveOutOfReach(-5, 0, 3, 0, 0, 0, 0, 0, 1)).toBe(true);
    expect(moveOutOfReach(-5, 0, 4.5, 0, 0, 0, 0, 0, 1)).toBe(false);
    expect(moveOutOfReach(5, 0, -4.5, 0, 0, 0, 0, 0, 1)).toBe(false);
    expect(moveOutOfReach(0, -5, 0, 10, 0, 0, 0, 0, 1)).toBe(false);
    expect(moveOutOfReach(0, -5, 0, -10, 0, 0, 0, 0, 1)).toBe(true);
  });

  it('measures from the box edges, for a segment', () => {
    // Box of the segment (0, 0)–(2, 1).
    expect(moveOutOfReach(1, 1.9, 0, 0, 0, 0, 2, 1, 1)).toBe(false);
    expect(moveOutOfReach(1, 2.5, 0, 0, 0, 0, 2, 1, 1)).toBe(true);
    expect(moveOutOfReach(1, 2.5, 0, -0.6, 0, 0, 2, 1, 1)).toBe(false);
    expect(moveOutOfReach(3.5, 0.5, -0.1, 0, 0, 0, 2, 1, 1)).toBe(true);
    expect(moveOutOfReach(3.5, 0.5, -0.6, 0, 0, 0, 2, 1, 1)).toBe(false);
    expect(moveOutOfReach(-1.5, 0.5, 0, 0, 0, 0, 2, 1, 1)).toBe(true);
  });

  // The world skips the sweep for a shape out of reach, so this must hold
  // without exception: whenever a sweep reports a hit, the shape was in
  // reach. Board-scale numbers (a ball at 0.3 m from the origin, mm moves)
  // so rounding is what it is in play, and many moves that start touching or
  // graze the boundary, where rounding decides.
  const rng = createRng(20261023);
  const R = 0.0055;
  const NAIL_REACH = R + 0.001;
  /** A coordinate about `base`, give or take `spread`. */
  const near = (base: number, spread: number) => base + rng.range(-spread, spread);
  /**
   * A move of up to the ball's travel at max launch speed in one step
   * (2.5 mm); sometimes none, and sometimes under a nanometre, as for a ball
   * all but resting against a nail, where the contact slop decides.
   */
  const randomMove = (): [number, number] => {
    const kind = rng.next();
    if (kind < 0.05) return [0, 0];
    const len = kind < 0.25 ? 1e-9 * rng.next() : 0.0025 * rng.next();
    const a = rng.range(0, 2 * Math.PI);
    return [len * Math.cos(a), len * Math.sin(a)];
  };
  /**
   * A start at about `reach` from (cx, cy), often within a few contact slops
   * of it, and often straight left, right, above or below it: where the box
   * test is tightest.
   */
  const startAround = (cx: number, cy: number, reach: number): [number, number] => {
    const a =
      rng.next() < 0.3 ? (Math.floor(rng.next() * 4) * Math.PI) / 2 : rng.range(0, 2 * Math.PI);
    const d =
      rng.next() < 0.5
        ? reach + rng.range(-3, 3) * CONTACT_SLOP_M
        : reach + rng.range(-0.0005, 0.004);
    return [cx + d * Math.cos(a), cy + d * Math.sin(a)];
  };

  it('never says out of reach for a nail sweepDisc hits', () => {
    const hit = createHit();
    let hits = 0;
    let culled = 0;
    for (let i = 0; i < 200_000; i++) {
      const cx = near(0.3, 0.2);
      const cy = near(0.4, 0.2);
      const [px, py] = startAround(cx, cy, NAIL_REACH);
      const [dx, dy] = randomMove();
      const out = moveOutOfReach(px, py, dx, dy, cx, cy, cx, cy, NAIL_REACH);
      if (sweepDisc(px, py, dx, dy, cx, cy, NAIL_REACH, hit)) {
        hits++;
        expect(out).toBe(false);
      }
      if (out) culled++;
    }
    // Neither side of the property is empty.
    expect(hits).toBeGreaterThan(10_000);
    expect(culled).toBeGreaterThan(10_000);
  });

  it('never says out of reach for a rail sweepCapsule hits, level, upright or slanted', () => {
    const hit = createHit();
    let hits = 0;
    let culled = 0;
    for (let i = 0; i < 200_000; i++) {
      const ax = near(0.3, 0.2);
      const ay = near(0.4, 0.2);
      const len = rng.range(0.002, 0.05);
      // Level and upright rails make the box flat: the case to get right.
      const kind = rng.next();
      const angle =
        kind < 0.3
          ? 0
          : kind < 0.6
            ? Math.PI / 2
            : kind < 0.65
              ? Math.PI
              : rng.range(0, 2 * Math.PI);
      const seg = createSegment(
        { x: ax, y: ay },
        { x: ax + len * Math.cos(angle), y: ay + len * Math.sin(angle) },
        STEEL,
      );
      // Start near an end cap or beside a random point along the rail.
      const along =
        rng.next() < 0.3 ? (rng.next() < 0.5 ? 0 : seg.lengthM) : rng.range(0, seg.lengthM);
      const [px, py] = startAround(seg.ax + seg.ux * along, seg.ay + seg.uy * along, R);
      const [dx, dy] = randomMove();
      const minX = Math.min(seg.ax, seg.bx);
      const maxX = Math.max(seg.ax, seg.bx);
      const minY = Math.min(seg.ay, seg.by);
      const maxY = Math.max(seg.ay, seg.by);
      const out = moveOutOfReach(px, py, dx, dy, minX, minY, maxX, maxY, R);
      if (sweepCapsule(px, py, dx, dy, seg, R, hit)) {
        hits++;
        expect(out).toBe(false);
      }
      if (out) culled++;
    }
    expect(hits).toBeGreaterThan(10_000);
    expect(culled).toBeGreaterThan(5_000);
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
