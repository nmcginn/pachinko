// Board schema, validation, and the bridge from board data to a sim world.
//
// A board is plain JSON (boards/*.json) in SI metres, x right, y up, origin
// at the bottom-left corner of the board:
//
//   {
//     "name": "classic",
//     "widthM": 0.5, "heightM": 0.53,
//     "nails": [[x, y], …],                         // brass nails, NAIL_RADIUS_M each
//     "rails": [{ "id": "outer", "points": [[x, y], …] }, …],   // polylines
//     "pockets": [{ "id": "start", "kind": "start", "polygon": [[x, y], …] }, …],
//                                                   // an "attacker" also has a "lid": [[x, y], …]
//     "launcher": { "x": …, "y": …, "angleDeg": …, "minSpeedMps": … }
//   }
//
// Pockets are sensor regions: a ball whose centre enters one leaves play.
// Their physical walls, if any, are rails. An attacker's lid is a polyline
// that closes over its mouth: the world makes it a gate, closed at the start,
// and the game opens it for jackpot rounds (M4). `parseBoard` checks everything it
// can about the data up front and reports every problem it finds at once,
// each with the path of the offending item, so a hand-edited board fails
// loudly at load time rather than as a ball doing something odd.

import { createCircle, createPolyline } from './collide';
import type { Rng } from './rng';
import { createSensor, polygonProblem, sensorContains } from './sensor';
import type { Vec2 } from './vec';
import {
  type Ball,
  type World,
  LAUNCH_SPEED_SPREAD,
  MAX_LAUNCH_SPEED_MPS,
  NAIL_MATERIAL,
  NAIL_RADIUS_M,
  RAIL_MATERIAL,
  addBall,
  createWorld,
} from './world';

/**
 * - `start`: the start pocket (ヘソ). Pays and triggers a spin (M3, M4).
 * - `out`: the out-hole. The ball is lost.
 * - `foul`: the bottom of the launch lane, for a shot too weak to reach the
 *   field. The ball goes back to the tray (PLAN.md game rules); the sim only
 *   reports the capture and the economy returns the ball.
 * - `attacker`: the attacker (アタッカー), the big pocket that opens for
 *   jackpot rounds. Has a lid, closed except during a round (M4).
 */
export const POCKET_KINDS = ['start', 'out', 'foul', 'attacker'] as const;
export type PocketKind = (typeof POCKET_KINDS)[number];

export interface Rail {
  readonly id: string;
  readonly points: readonly Vec2[];
}

export interface Pocket {
  readonly id: string;
  readonly kind: PocketKind;
  readonly polygon: readonly Vec2[];
  /** Attackers only: the lid over the mouth, a polyline. Solid while the gate is closed. */
  readonly lid?: readonly Vec2[];
}

export interface Launcher {
  /** Where a launched ball appears: the bottom of the launch lane. */
  readonly x: number;
  readonly y: number;
  /** Unit launch direction. */
  readonly dirX: number;
  readonly dirY: number;
  /** Launch speed at power 0. Power 1 is MAX_LAUNCH_SPEED_MPS. */
  readonly minSpeedMps: number;
}

export interface Board {
  readonly name: string;
  readonly widthM: number;
  readonly heightM: number;
  readonly nails: readonly Vec2[];
  readonly rails: readonly Rail[];
  readonly pockets: readonly Pocket[];
  readonly launcher: Launcher;
}

export class BoardError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`invalid board:\n  ${issues.join('\n  ')}`);
    this.name = 'BoardError';
    this.issues = issues;
  }
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Collects problems while walking the data, so one load reports all of them. */
class Checker {
  readonly issues: string[] = [];

  fail(path: string, message: string): void {
    this.issues.push(`${path}: ${message}`);
  }

  object(v: unknown, path: string, keys: readonly string[]): Json | null {
    if (!isObject(v)) {
      this.fail(path, 'must be an object');
      return null;
    }
    for (const k of Object.keys(v)) {
      if (!keys.includes(k)) this.fail(`${path}.${k}`, 'unknown field');
    }
    return v;
  }

  array(v: unknown, path: string): unknown[] | null {
    if (!Array.isArray(v)) {
      this.fail(path, 'must be an array');
      return null;
    }
    return v;
  }

  string(v: unknown, path: string): string | null {
    if (typeof v !== 'string' || v.length === 0) {
      this.fail(path, 'must be a non-empty string');
      return null;
    }
    return v;
  }

  number(v: unknown, path: string): number | null {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.fail(path, 'must be a finite number');
      return null;
    }
    return v;
  }

  /** A point as [x, y]. */
  point(v: unknown, path: string): Vec2 | null {
    if (
      !Array.isArray(v) ||
      v.length !== 2 ||
      !v.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      this.fail(path, 'must be a point [x, y] of two finite numbers');
      return null;
    }
    return { x: v[0] as number, y: v[1] as number };
  }

  points(v: unknown, path: string): Vec2[] | null {
    const list = this.array(v, path);
    if (!list) return null;
    const out: Vec2[] = [];
    let ok = true;
    list.forEach((p, i) => {
      const point = this.point(p, `${path}[${i}]`);
      if (point) out.push(point);
      else ok = false;
    });
    return ok ? out : null;
  }
}

const fmt = (p: Vec2) => `(${p.x}, ${p.y})`;

/**
 * Validate board JSON and return a Board. Throws a BoardError listing every
 * problem found. Checks shape and types, that all geometry lies on the board,
 * that nails don't overlap, rails have distinct consecutive points, pockets
 * are simple polygons, ids are unique, there is an out-hole for balls to
 * leave by, attackers (and only attackers) have a lid, and the launcher
 * sits clear of geometry with a usable speed range.
 */
export function parseBoard(data: unknown): Board {
  const c = new Checker();
  const root = c.object(data, 'board', [
    'name',
    'widthM',
    'heightM',
    'nails',
    'rails',
    'pockets',
    'launcher',
  ]);
  if (!root) throw new BoardError(c.issues);

  const name = c.string(root['name'], 'name') ?? '';
  const widthM = c.number(root['widthM'], 'widthM');
  const heightM = c.number(root['heightM'], 'heightM');
  if (widthM !== null && !(widthM > 0)) c.fail('widthM', 'must be > 0');
  if (heightM !== null && !(heightM > 0)) c.fail('heightM', 'must be > 0');
  const sized = widthM !== null && heightM !== null && widthM > 0 && heightM > 0;
  const onBoard = (p: Vec2, path: string): void => {
    if (sized && !(p.x >= 0 && p.x <= widthM && p.y >= 0 && p.y <= heightM)) {
      c.fail(path, `${fmt(p)} is outside the ${widthM} × ${heightM} m board`);
    }
  };

  // Nails.
  const nails: Vec2[] = [];
  c.array(root['nails'], 'nails')?.forEach((v, i) => {
    const p = c.point(v, `nails[${i}]`);
    if (!p) return;
    onBoard(p, `nails[${i}]`);
    nails.push(p);
  });
  // O(n²), once at load. A few hundred nails is well under a millisecond.
  for (let i = 0; i < nails.length; i++) {
    for (let j = i + 1; j < nails.length; j++) {
      const a = nails[i] as Vec2;
      const b = nails[j] as Vec2;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 2 * NAIL_RADIUS_M) {
        c.fail(`nails[${j}]`, `${fmt(b)} overlaps nails[${i}] at ${fmt(a)}`);
      }
    }
  }

  /** A rail or lid: at least 2 points, all on the board, no point repeating the one before. */
  const polyline = (v: unknown, path: string, what: 'rail' | 'lid'): Vec2[] | null => {
    const points = c.points(v, path);
    if (!points) return null;
    if (points.length < 2) {
      c.fail(path, `a ${what} needs at least 2 points, got ${points.length}`);
      return null;
    }
    let ok = true;
    points.forEach((p, k) => {
      onBoard(p, `${path}[${k}]`);
      const prev = points[k - 1];
      if (prev && prev.x === p.x && prev.y === p.y) {
        c.fail(`${path}[${k}]`, `repeats the previous point ${fmt(p)}`);
        ok = false;
      }
    });
    return ok ? points : null;
  };

  // Rails.
  const rails: Rail[] = [];
  const railIds = new Set<string>();
  c.array(root['rails'], 'rails')?.forEach((v, i) => {
    const path = `rails[${i}]`;
    const r = c.object(v, path, ['id', 'points']);
    if (!r) return;
    const id = c.string(r['id'], `${path}.id`);
    if (id !== null) {
      if (railIds.has(id)) c.fail(`${path}.id`, `duplicate rail id "${id}"`);
      railIds.add(id);
    }
    const points = polyline(r['points'], `${path}.points`, 'rail');
    if (points && id !== null) rails.push({ id, points });
  });

  // Pockets.
  const pockets: Pocket[] = [];
  const pocketIds = new Set<string>();
  c.array(root['pockets'], 'pockets')?.forEach((v, i) => {
    const path = `pockets[${i}]`;
    const o = c.object(v, path, ['id', 'kind', 'polygon', 'lid']);
    if (!o) return;
    const id = c.string(o['id'], `${path}.id`);
    if (id !== null) {
      if (pocketIds.has(id)) c.fail(`${path}.id`, `duplicate pocket id "${id}"`);
      pocketIds.add(id);
    }
    const kind = o['kind'];
    const validKind = POCKET_KINDS.includes(kind as PocketKind);
    if (!validKind) {
      c.fail(`${path}.kind`, `must be one of ${POCKET_KINDS.join(', ')}, got ${String(kind)}`);
    }
    let lid: Vec2[] | null = null;
    let lidOk = true;
    if (kind === 'attacker' && o['lid'] === undefined) {
      c.fail(`${path}.lid`, 'an attacker needs a lid, the polyline that closes over its mouth');
      lidOk = false;
    } else if (validKind && kind !== 'attacker' && o['lid'] !== undefined) {
      c.fail(`${path}.lid`, `only attacker pockets have a lid, not "${String(kind)}"`);
      lidOk = false;
    } else if (o['lid'] !== undefined) {
      lid = polyline(o['lid'], `${path}.lid`, 'lid');
      lidOk = lid !== null;
    }
    const polygon = c.points(o['polygon'], `${path}.polygon`);
    if (!polygon) return;
    polygon.forEach((p, k) => onBoard(p, `${path}.polygon[${k}]`));
    const problem = polygonProblem(polygon);
    if (problem) c.fail(`${path}.polygon`, problem);
    if (id !== null && validKind && !problem && lidOk) {
      pockets.push({ id, kind: kind as PocketKind, polygon, ...(lid ? { lid } : {}) });
    }
  });
  if (Array.isArray(root['pockets']) && !pockets.some((p) => p.kind === 'out')) {
    c.fail('pockets', 'needs at least one "out" pocket, or balls can never leave');
  }

  // Launcher.
  let launcher: Launcher | null = null;
  const l = c.object(root['launcher'], 'launcher', ['x', 'y', 'angleDeg', 'minSpeedMps']);
  if (l) {
    const x = c.number(l['x'], 'launcher.x');
    const y = c.number(l['y'], 'launcher.y');
    const angleDeg = c.number(l['angleDeg'], 'launcher.angleDeg');
    const minSpeedMps = c.number(l['minSpeedMps'], 'launcher.minSpeedMps');
    if (minSpeedMps !== null && !(minSpeedMps > 0 && minSpeedMps <= MAX_LAUNCH_SPEED_MPS)) {
      c.fail(
        'launcher.minSpeedMps',
        `must be in (0, ${MAX_LAUNCH_SPEED_MPS}] (MAX_LAUNCH_SPEED_MPS), got ${minSpeedMps}`,
      );
    }
    if (x !== null && y !== null) onBoard({ x, y }, 'launcher');
    if (x !== null && y !== null && angleDeg !== null && minSpeedMps !== null) {
      const a = (angleDeg * Math.PI) / 180;
      launcher = { x, y, dirX: Math.cos(a), dirY: Math.sin(a), minSpeedMps };
    }
  }

  if (c.issues.length > 0 || !sized || !launcher) throw new BoardError(c.issues);

  const board: Board = { name, widthM, heightM, nails, rails, pockets, launcher };

  // Checks that need the assembled geometry.
  const world = createBoardWorld(board);
  const at = { x: launcher.x, y: launcher.y };
  try {
    addBall(world, at);
  } catch {
    c.fail('launcher', `a ball at ${fmt(at)} would overlap a nail or rail`);
  }
  const inPocket = world.sensors.find((s) => sensorContains(s, at.x, at.y));
  if (inPocket) c.fail('launcher', `${fmt(at)} is inside pocket "${inPocket.id}"`);
  if (c.issues.length > 0) throw new BoardError(c.issues);
  return board;
}

/**
 * How far outside the board a ball may stray before it is removed. Only a
 * board with a gap in its walls lets a ball get there; this is a backstop so
 * such a ball can't fly forever.
 */
const BOUNDS_MARGIN_M = 0.05;

/**
 * Build the sim world for a board: nails, rails, pockets as sensors, bounds,
 * and a gate for each attacker's lid, closed, with the pocket's id.
 */
export function createBoardWorld(board: Board): World {
  return createWorld({
    circles: board.nails.map((p) => createCircle(p, NAIL_RADIUS_M, NAIL_MATERIAL)),
    segments: board.rails.flatMap((r) => createPolyline(r.points, RAIL_MATERIAL)),
    sensors: board.pockets.map((p) => createSensor(p.id, p.polygon)),
    gates: board.pockets.flatMap((p) =>
      p.lid ? [{ id: p.id, segments: createPolyline(p.lid, RAIL_MATERIAL), sensorId: p.id }] : [],
    ),
    bounds: {
      minX: -BOUNDS_MARGIN_M,
      minY: -BOUNDS_MARGIN_M,
      maxX: board.widthM + BOUNDS_MARGIN_M,
      maxY: board.heightM + BOUNDS_MARGIN_M,
    },
  });
}

/** Pocket kind for a sensor id from this board, or null if it isn't one of its pockets. */
export function pocketKind(board: Board, sensorId: string): PocketKind | null {
  return board.pockets.find((p) => p.id === sensorId)?.kind ?? null;
}

/**
 * Launch speed for a handle power in [0, 1]: linear from the board's
 * minimum to MAX_LAUNCH_SPEED_MPS. Power outside [0, 1] is clamped; NaN is 0.
 */
export function launchSpeedMps(launcher: Launcher, power: number): number {
  const p = power >= 0 ? Math.min(power, 1) : 0;
  return launcher.minSpeedMps + p * (MAX_LAUNCH_SPEED_MPS - launcher.minSpeedMps);
}

/**
 * Put a new ball at the bottom of the launch lane, moving up it at the speed
 * for this power. With an rng, the speed varies shot to shot by
 * LAUNCH_SPEED_SPREAD (one draw from `rng.normal()`), capped at
 * MAX_LAUNCH_SPEED_MPS. Without one, the shot is exactly nominal.
 */
export function launchBall(world: World, board: Board, power: number, rng?: Rng): Ball {
  const { launcher } = board;
  let speed = launchSpeedMps(launcher, power);
  if (rng) speed = Math.min(MAX_LAUNCH_SPEED_MPS, speed * (1 + LAUNCH_SPEED_SPREAD * rng.normal()));
  return addBall(world, {
    x: launcher.x,
    y: launcher.y,
    vx: speed * launcher.dirX,
    vy: speed * launcher.dirY,
  });
}
