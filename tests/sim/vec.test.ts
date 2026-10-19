import { describe, expect, it } from 'vitest';
import {
  ZERO,
  add,
  closestPointOnSegment,
  cross,
  distance,
  dot,
  isFiniteVec,
  length,
  lengthSq,
  lerp,
  normalize,
  perp,
  scale,
  sub,
  vec,
} from '../../src/sim/vec';

describe('vec', () => {
  const a = vec(3, 4);
  const b = vec(-1, 2);

  it('does the arithmetic', () => {
    expect(add(a, b)).toEqual({ x: 2, y: 6 });
    expect(sub(a, b)).toEqual({ x: 4, y: 2 });
    expect(scale(a, -2)).toEqual({ x: -6, y: -8 });
    expect(dot(a, b)).toBe(5);
    expect(cross(a, b)).toBe(10);
    expect(cross(b, a)).toBe(-10);
    expect(lengthSq(a)).toBe(25);
    expect(length(a)).toBe(5);
    expect(distance(a, b)).toBeCloseTo(Math.hypot(4, 2), 15);
    expect(lerp(a, b, 0.5)).toEqual({ x: 1, y: 3 });
  });

  it('rotates a quarter turn counter-clockwise with perp', () => {
    expect(perp(vec(1, 0))).toEqual({ x: -0, y: 1 });
    expect(dot(perp(a), a)).toBe(0);
    expect(cross(a, perp(a))).toBeGreaterThan(0);
  });

  it('normalizes to unit length and refuses the zero vector', () => {
    expect(length(normalize(a))).toBeCloseTo(1, 15);
    expect(normalize(vec(0, -7))).toEqual({ x: 0, y: -1 });
    expect(() => normalize(ZERO)).toThrow(RangeError);
    expect(() => normalize(vec(NaN, 1))).toThrow(RangeError);
  });

  it('never mutates its inputs', () => {
    const p = vec(1, 2);
    add(p, p);
    scale(p, 3);
    normalize(p);
    expect(p).toEqual({ x: 1, y: 2 });
    expect(Object.isFrozen(ZERO)).toBe(true);
  });

  it('flags non-finite vectors', () => {
    expect(isFiniteVec(a)).toBe(true);
    expect(isFiniteVec(vec(Infinity, 0))).toBe(false);
    expect(isFiniteVec(vec(0, NaN))).toBe(false);
  });

  describe('closestPointOnSegment', () => {
    const s0 = vec(0, 0);
    const s1 = vec(10, 0);
    it('projects onto the interior', () => {
      expect(closestPointOnSegment(vec(3, 5), s0, s1)).toEqual({ x: 3, y: 0 });
    });
    it('clamps to the ends', () => {
      expect(closestPointOnSegment(vec(-4, 1), s0, s1)).toEqual({ x: 0, y: 0 });
      expect(closestPointOnSegment(vec(14, -1), s0, s1)).toEqual({ x: 10, y: 0 });
    });
    it('handles a degenerate segment', () => {
      expect(closestPointOnSegment(vec(5, 5), s0, s0)).toBe(s0);
    });
  });
});
