// Nail glints: a nail flashes brass-white for a moment when a ball strikes
// it. Pure and DOM-free, so it is unit-tested under Node. It reads the world
// after each step and never changes it; drawBoard draws the result.
//
// The world doesn't say which nail a ball hit, only how hard the step's
// hardest impact was, so the tracker works it out from each ball's velocity:
// an impact changes it along the contact normal, nail centre to ball centre,
// far beyond what gravity and drag do in a step. A kick that points away
// from a nail the ball is touching (or was, within the step) is a hit on
// that nail.
//
// The frame loop calls collectGlints once per sim step, right after
// stepTable, like collectCues: an impact lasts one step, so sampling once a
// frame would miss most of them. Time counts sim steps.

import { type Candidates, queryGrid } from '../sim/broadphase';
import { BALL_RADIUS_M, IN_PLANE_GRAVITY_MPS2, SIM_STEP_S, type World } from '../sim/world';

/** A kick (velocity change beyond gravity's) smaller than this is no glint: resting and rolling contacts, grazes. */
export const GLINT_MIN_KICK_MPS = 0.2;
/** A kick this hard or harder glints at full strength; softer ones in proportion. */
export const GLINT_FULL_KICK_MPS = 1.5;
/** How long a glint takes to fade out. */
export const GLINT_S = 0.15;
export const GLINT_STEPS = Math.round(GLINT_S / SIM_STEP_S);
/**
 * How closely the kick must point along the nail-to-ball normal (cosine of
 * the angle between them). Friction tilts it a little; a hit on a
 * neighbouring nail or a rail points well away.
 */
const MIN_ALIGNMENT = 0.9;
/** Contact distance slack beyond how far the ball moved in the step. */
const REACH_SLOP_M = 1e-4;

const GRAVITY_DV_MPS = IN_PLANE_GRAVITY_MPS2 * SIM_STEP_S;

export interface Glints {
  /** Per nail (world.circles index), the step its latest glint started, or -Infinity for never. */
  readonly startStep: Float64Array;
  /** Per nail, that glint's strength in (0, 1]. */
  readonly strength: Float64Array;
  /** Each ball's velocity at the end of the previous step, by id. */
  readonly velocity: Map<number, { vx: number; vy: number }>;
}

/** A tracker for a world. Balls already in it have their current velocity as the baseline. */
export function createGlints(world: Readonly<World>): Glints {
  const n = world.circles.length;
  const glints: Glints = {
    startStep: new Float64Array(n).fill(-Infinity),
    strength: new Float64Array(n),
    velocity: new Map(),
  };
  for (const b of world.balls) glints.velocity.set(b.id, { vx: b.vx, vy: b.vy });
  return glints;
}

const candidates: Candidates = { circles: [], segments: [] };

/** Record the nails the world's latest step struck. */
export function collectGlints(glints: Glints, world: Readonly<World>): void {
  const { circles, grid } = world;
  const seen = new Set<number>();
  for (const ball of world.balls) {
    seen.add(ball.id);
    const before = glints.velocity.get(ball.id);
    glints.velocity.set(ball.id, { vx: ball.vx, vy: ball.vy });
    // A ball new this step has nothing to compare against.
    if (!before) continue;
    const kx = ball.vx - before.vx;
    const ky = ball.vy - before.vy + GRAVITY_DV_MPS;
    const kick = Math.hypot(kx, ky);
    if (!(kick >= GLINT_MIN_KICK_MPS)) continue;

    const reachM = Math.hypot(ball.vx, ball.vy) * SIM_STEP_S + REACH_SLOP_M;
    let indices: readonly number[];
    if (grid) {
      queryGrid(
        grid,
        ball.x - reachM,
        ball.y - reachM,
        ball.x + reachM,
        ball.y + reachM,
        candidates,
      );
      indices = candidates.circles;
    } else {
      indices = circles.map((_, i) => i);
    }
    let best = -1;
    let bestAlignment = MIN_ALIGNMENT;
    for (const i of indices) {
      const c = circles[i];
      if (!c) continue;
      const dx = ball.x - c.x;
      const dy = ball.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d > BALL_RADIUS_M + c.radiusM + reachM || d === 0) continue;
      const alignment = (dx * kx + dy * ky) / (d * kick);
      if (alignment >= bestAlignment) {
        best = i;
        bestAlignment = alignment;
      }
    }
    if (best >= 0) {
      glints.startStep[best] = world.steps;
      glints.strength[best] = Math.min(1, kick / GLINT_FULL_KICK_MPS);
    }
  }
  // Forget balls that left the world, so the map doesn't grow all game.
  if (glints.velocity.size > seen.size) {
    for (const id of glints.velocity.keys()) if (!seen.has(id)) glints.velocity.delete(id);
  }
}

/** How bright nail `i` glints at step `nowStep`: its strength, fading linearly to 0 over GLINT_STEPS. */
export function glintLevel(glints: Readonly<Glints>, i: number, nowStep: number): number {
  const age = nowStep - (glints.startStep[i] ?? -Infinity);
  if (!(age >= 0 && age < GLINT_STEPS)) return 0;
  return (glints.strength[i] ?? 0) * (1 - age / GLINT_STEPS);
}
