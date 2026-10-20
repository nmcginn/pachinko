// M2 acceptance on boards/classic.json: a mid-power shot clears the top rail
// and lands in the field, and balls leave through the out-hole and are
// removed. Also the PLAN.md invariants, checked on the real board, and the
// handle's range since the remap (M5): the bottom fouls, as on real machines.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Board,
  type PocketKind,
  createBoardWorld,
  launchBall,
  launchSpeedMps,
  parseBoard,
  pocketKind,
} from '../../src/sim/board';
import { CONTACT_SLOP_M } from '../../src/sim/collide';
import {
  type Ball,
  type World,
  BALL_RADIUS_M,
  NAIL_RADIUS_M,
  SIM_STEP_S,
  addBall,
  ballEnergyJ,
  stepWorld,
} from '../../src/sim/world';

const classic: Board = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
const steps = (simS: number) => Math.round(simS / SIM_STEP_S);
/** The best handle power (PHYSICS.md tuning log, the handle remap). */
const BEST_POWER = 0.2;
/**
 * Shots at nominal speed (no launch spread) below this power foul: power
 * 0.05 is 2.82 m/s, power 0.1 2.93 m/s, just enough to clear the lane.
 * With the spread, about 4 shots in 10 still foul at 0.1 (PHYSICS.md).
 */
const FOUL_BELOW_POWER = 0.1;
/** Where a ball can end up once it has reached the field. */
const FIELD_ENDS = ['out', 'start', 'tulip'];

/** The outer guide rail's highest point: the top of the playfield. */
const railTopY = Math.max(
  ...(classic.rails.find((r) => r.id === 'outer')?.points.map((p) => p.y) ?? [NaN]),
);
/**
 * Top of the inner rail, where the launch lane ends. A ball that rises above
 * it has left the lane: weak shots peel off the outer rail between here and
 * the top.
 */
const laneEndY = Math.max(
  ...(classic.rails.find((r) => r.id === 'inner')?.points.map((p) => p.y) ?? [NaN]),
);

function clearanceM(world: World, x: number, y: number): number {
  let min = Infinity;
  for (const c of world.circles) {
    min = Math.min(min, Math.hypot(x - c.x, y - c.y) - c.radiusM - BALL_RADIUS_M);
  }
  for (const [i, s] of world.segments.entries()) {
    // A gate's segments of the other state (a closed tulip's open wings) aren't there.
    if (world.segmentOff[i]) continue;
    const along = Math.min(s.lengthM, Math.max(0, (x - s.ax) * s.ux + (y - s.ay) * s.uy));
    min = Math.min(
      min,
      Math.hypot(x - (s.ax + s.ux * along), y - (s.ay + s.uy * along)) - BALL_RADIUS_M,
    );
  }
  return min;
}

interface Shot {
  /** Pocket that took the ball, 'bounds' if it left the board, null if still in play. */
  end: PocketKind | 'bounds' | null;
  endS: number;
  maxY: number;
  /** Sim time of the first nail contact, or null if it never touched one. */
  firstNailS: number | null;
  minClearanceM: number;
  /** Steps on which the ball's energy rose (should be none). */
  energyRises: number;
  trajectory: number[];
}

/** Launch one ball and follow it until it leaves play or maxS passes. */
function shoot(power: number, maxS = 20, ball?: (world: World) => Ball): Shot {
  const world = createBoardWorld(classic);
  const b = ball ? ball(world) : launchBall(world, classic, power);
  const shot: Shot = {
    end: null,
    endS: NaN,
    maxY: b.y,
    firstNailS: null,
    minClearanceM: Infinity,
    energyRises: 0,
    trajectory: [],
  };
  for (let i = 0; i < steps(maxS); i++) {
    const e0 = ballEnergyJ(b);
    const removed = stepWorld(world);
    shot.trajectory.push(b.x, b.y);
    if (removed.includes(b)) {
      const capture = world.captures.find((c) => c.ball === b);
      shot.end = capture ? pocketKind(classic, capture.sensorId) : 'bounds';
      shot.endS = world.timeS;
      return shot;
    }
    if (!(ballEnergyJ(b) <= e0)) shot.energyRises++;
    shot.maxY = Math.max(shot.maxY, b.y);
    shot.minClearanceM = Math.min(shot.minClearanceM, clearanceM(world, b.x, b.y));
    if (
      shot.firstNailS === null &&
      world.circles.some(
        (c) => Math.hypot(b.x - c.x, b.y - c.y) <= c.radiusM + BALL_RADIUS_M + 1e-4,
      )
    ) {
      shot.firstNailS = world.timeS;
    }
  }
  return shot;
}

describe('boards/classic.json', () => {
  it('has its lane end below the top of the outer rail', () => {
    expect(laneEndY).toBeLessThan(railTopY - 0.04);
  });

  it('passes validation, with the parts M2 and M4 ask for', () => {
    expect(classic.name).toBe('classic');
    expect(classic.nails.length).toBeGreaterThan(100);
    const ids = classic.rails.map((r) => r.id);
    for (const id of [
      'outer',
      'inner',
      'floor-left',
      'floor-right',
      'start-cup',
      'attacker-box',
      'tulip-left-cup',
      'tulip-right-cup',
    ]) {
      expect(ids).toContain(id);
    }
    expect(classic.pockets.map((p) => p.kind).sort()).toEqual([
      'attacker',
      'foul',
      'out',
      'start',
      'tulip',
      'tulip',
    ]);
  });

  it("puts the attacker below the start cup, a ball's width clear of every nail, lid shut", () => {
    const attacker = classic.pockets.find((p) => p.kind === 'attacker');
    const cup = classic.rails.find((r) => r.id === 'start-cup');
    if (!attacker?.lid || !cup) throw new Error('classic board has no attacker or start cup');
    const top = Math.max(...attacker.lid.map((p) => p.y));
    expect(top).toBeLessThan(Math.min(...cup.points.map((p) => p.y)) - 2 * BALL_RADIUS_M);
    // Lid and box: no nail close enough to trap a ball against them.
    const box = classic.rails.find((r) => r.id === 'attacker-box');
    const segs = [attacker.lid, box?.points ?? []].flatMap((pts) =>
      pts.slice(1).map((b, i) => [pts[i], b] as const),
    );
    for (const n of classic.nails) {
      for (const [a, b] of segs) {
        if (!a) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = Math.max(
          0,
          Math.min(1, ((n.x - a.x) * dx + (n.y - a.y) * dy) / (dx * dx + dy * dy)),
        );
        const gap = Math.hypot(n.x - (a.x + t * dx), n.y - (a.y + t * dy)) - NAIL_RADIUS_M;
        expect(gap).toBeGreaterThan(2 * BALL_RADIUS_M);
      }
    }
    const world = createBoardWorld(classic);
    expect(world.gates.find((g) => g.id === attacker.id)).toMatchObject({ open: false });
  });

  it('puts two tulips either side of the start pocket, level with it, mirror images', () => {
    const [left, right] = classic.pockets.filter((p) => p.kind === 'tulip');
    const start = classic.pockets.find((p) => p.kind === 'start');
    if (!left?.wings || !right?.wings || !start) throw new Error('classic board has no tulips');
    const mirror = (pts: readonly { x: number; y: number }[]) =>
      pts.map((p) => ({ x: Math.round((0.5 - p.x) * 1e6) / 1e6, y: p.y }));
    const round = (pts: readonly { x: number; y: number }[]) =>
      pts.map((p) => ({ x: Math.round(p.x * 1e6) / 1e6, y: p.y }));
    // The right tulip is the left one reflected in the board's centre line, x = 0.25 m.
    const sortX = (pts: { x: number; y: number }[]) =>
      [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
    expect(sortX(round(right.polygon))).toEqual(sortX(mirror(left.polygon)));
    for (const state of ['closed', 'open'] as const) {
      // Reflected, the left wing becomes the right one: same wings, other order.
      expect(right.wings[state].map((w) => round(w))).toEqual(
        left.wings[state].map((w) => mirror(w)).reverse(),
      );
    }
    // Level with the start pocket: their sensors' tops within 5 mm of its top.
    const ys = (p: typeof start) => p.polygon.map((q) => q.y);
    expect(Math.abs(Math.max(...ys(left)) - Math.max(...ys(start)))).toBeLessThan(0.005);
    const world = createBoardWorld(classic);
    for (const id of [left.id, right.id]) {
      expect(world.gates.find((g) => g.id === id)).toMatchObject({ open: false });
    }
  });
});

describe('M2 acceptance: a ball launched at mid power clears the top rail and lands in the field', () => {
  const shot = shoot(0.5);

  it('climbs the lane and runs over the top of the outer rail', () => {
    // Ball centre rides 5.5 mm inside the rail: within a centimetre of the top is over it.
    expect(shot.maxY).toBeGreaterThan(railTopY - 0.01);
  });

  it('then hits the nail field', () => {
    expect(shot.firstNailS).not.toBeNull();
  });

  it('and leaves through a pocket in the field, not the foul pocket', () => {
    expect(FIELD_ENDS).toContain(shot.end);
  });
});

describe('every power from 0 to 1: the bottom of the handle fouls, the rest reach the field', () => {
  const shots = Array.from({ length: 21 }, (_, k) => [k / 20, shoot(k / 20)] as const);

  for (const [power, shot] of shots) {
    it(`power ${power.toFixed(2)}`, () => {
      if (power < FOUL_BELOW_POWER) {
        // Too weak to leave the lane: rolls back into the foul pocket.
        expect(shot.end).toBe('foul');
        expect(shot.firstNailS).toBeNull();
      } else {
        // Out of the lane (power 0.1 only just), onto a nail, into a field pocket.
        expect(shot.maxY).toBeGreaterThan(laneEndY);
        expect(shot.firstNailS).not.toBeNull();
        expect(FIELD_ENDS).toContain(shot.end);
      }
      // Invariants on the real board: no tunnelling, no energy gain.
      expect(shot.minClearanceM).toBeGreaterThanOrEqual(-CONTACT_SLOP_M);
      expect(shot.energyRises).toBe(0);
    });
  }

  it('with most balls out within a few seconds', () => {
    const times = shots.map(([, s]) => s.endS).sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(5);
  });
});

describe('foul: a shot too weak to reach the field', () => {
  it('rolls back down the lane into the foul pocket and is removed', () => {
    const { launcher } = classic;
    const weak = launcher.minSpeedMps * 0.7;
    const shot = shoot(0, 10, (world) =>
      addBall(world, {
        x: launcher.x,
        y: launcher.y,
        vx: weak * launcher.dirX,
        vy: weak * launcher.dirY,
      }),
    );
    expect(shot.end).toBe('foul');
    expect(shot.firstNailS).toBeNull();
  });

  it('happens at the bottom of the handle, as on real machines', () => {
    expect(shoot(0).end).toBe('foul');
    expect(launchSpeedMps(classic.launcher, 0)).toBeLessThan(2.9);
  });

  it('never happens at the best power, with margin', () => {
    // 3% (three launch-spread standard deviations) below the best power's speed still clears the lane.
    const { launcher } = classic;
    const speed = launchSpeedMps(launcher, BEST_POWER) * 0.97;
    const shot = shoot(0, 20, (world) =>
      addBall(world, {
        x: launcher.x,
        y: launcher.y,
        vx: speed * launcher.dirX,
        vy: speed * launcher.dirY,
      }),
    );
    expect(FIELD_ENDS).toContain(shot.end);
  });
});

describe('M2 acceptance: balls exit through the out-hole and are removed', () => {
  it('drains a stream of 40 balls at 100 per minute, leaving nothing in play', () => {
    const world = createBoardWorld(classic);
    const interval = steps(60 / 100);
    const ends = new Map<string, number>();
    let launched = 0;
    for (let i = 0; i < steps(40 * 0.6 + 20); i++) {
      if (launched < 40 && i % interval === 0) {
        launchBall(world, classic, 0.3 + 0.4 * ((launched * 7) % 10) * 0.1);
        launched++;
      }
      stepWorld(world);
      for (const c of world.captures) {
        const kind = pocketKind(classic, c.sensorId) ?? 'unknown';
        ends.set(kind, (ends.get(kind) ?? 0) + 1);
      }
    }
    expect(launched).toBe(40);
    expect(world.balls).toEqual([]);
    expect((ends.get('out') ?? 0) + (ends.get('start') ?? 0) + (ends.get('tulip') ?? 0)).toBe(40);
    expect(ends.get('out')).toBeGreaterThan(20);
  });
});

describe('determinism on the classic board', () => {
  it('gives the identical trajectory for the same shot twice', () => {
    const a = shoot(0.62, 5).trajectory;
    const b = shoot(0.62, 5).trajectory;
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});
