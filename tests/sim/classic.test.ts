// M2 acceptance on boards/classic.json: a mid-power shot clears the top rail
// and lands in the field, and balls leave through the out-hole and are
// removed. Also the PLAN.md invariants, checked on the real board.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Board,
  type PocketKind,
  createBoardWorld,
  launchBall,
  parseBoard,
  pocketKind,
} from '../../src/sim/board';
import { CONTACT_SLOP_M } from '../../src/sim/collide';
import {
  type Ball,
  type World,
  BALL_RADIUS_M,
  SIM_STEP_S,
  addBall,
  ballEnergyJ,
  stepWorld,
} from '../../src/sim/world';

const classic: Board = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
const steps = (simS: number) => Math.round(simS / SIM_STEP_S);

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
  for (const s of world.segments) {
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

  it('passes validation, with the parts M2 asks for', () => {
    expect(classic.name).toBe('classic');
    expect(classic.nails.length).toBeGreaterThan(100);
    const ids = classic.rails.map((r) => r.id);
    for (const id of ['outer', 'inner', 'floor-left', 'floor-right', 'start-cup']) {
      expect(ids).toContain(id);
    }
    expect(classic.pockets.map((p) => p.kind).sort()).toEqual(['foul', 'out', 'start']);
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
    expect(['out', 'start']).toContain(shot.end);
  });
});

describe('every power from 0 to 1 reaches the field and leaves through the out-hole or start pocket', () => {
  const shots = Array.from({ length: 21 }, (_, k) => [k / 20, shoot(k / 20)] as const);

  for (const [power, shot] of shots) {
    it(`power ${power.toFixed(2)}`, () => {
      expect(shot.maxY).toBeGreaterThan(laneEndY + 0.01);
      expect(shot.firstNailS).not.toBeNull();
      expect(['out', 'start']).toContain(shot.end);
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

  it('never happens at the weakest handle setting, with margin', () => {
    // 5% below the power-0 speed still clears the lane.
    const { launcher } = classic;
    const speed = launcher.minSpeedMps * 0.95;
    const shot = shoot(0, 20, (world) =>
      addBall(world, {
        x: launcher.x,
        y: launcher.y,
        vx: speed * launcher.dirX,
        vy: speed * launcher.dirY,
      }),
    );
    expect(['out', 'start']).toContain(shot.end);
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
    expect((ends.get('out') ?? 0) + (ends.get('start') ?? 0)).toBe(40);
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
