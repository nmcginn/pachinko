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
//                                                   // an "attacker" also has a "lid": [[x, y], …];
//                                                   // a "tulip" has "wings": { "closed": [polyline, …], "open": [polyline, …] }
//     "launcher": { "x": …, "y": …, "angleDeg": …, "minSpeedMps": … }
//   }
//
// Pockets are sensor regions: a ball whose centre enters one leaves play.
// Their physical walls, if any, are rails. An attacker's lid is a polyline
// that closes over its mouth: the world makes it a gate, closed at the start,
// and the game opens it for jackpot rounds (M4). A tulip's wings are
// polylines in two shapes, one solid while it is closed and one while it is
// open: the world makes them a gate too, closed at the start, and the game
// opens and closes it on each entry (M5). `parseBoard` checks everything it
// can about the data up front and reports every problem it finds at once,
// each with the path of the offending item, so a hand-edited board fails
// loudly at load time rather than as a ball doing something odd.

import { CONTACT_SLOP_M, createCircle, createPolyline } from './collide';
import type { Rng } from './rng';
import { createSensor, polygonProblem, sensorContains } from './sensor';
import type { Vec2 } from './vec';
import {
  type Ball,
  type World,
  BALL_RADIUS_M,
  LAUNCH_SPEED_SPREAD,
  MAX_LAUNCH_SPEED_MPS,
  NAIL_MATERIAL,
  NAIL_RADIUS_M,
  RAIL_MATERIAL,
  addBall,
  createWorld,
  overlapsBall,
  removeBall,
  setGateOpen,
} from './world';

/**
 * - `start`: the start pocket (ヘソ). Pays and triggers a spin (M3, M4).
 * - `out`: the out-hole. The ball is lost.
 * - `foul`: the bottom of the launch lane, for a shot too weak to reach the
 *   field. The ball goes back to the tray (PLAN.md game rules); the sim only
 *   reports the capture and the economy returns the ball.
 * - `attacker`: the attacker (アタッカー), the big pocket that opens for
 *   jackpot rounds. Has a lid, closed except during a round (M4).
 * - `tulip`: a side pocket (チューリップ) with wings. An entry into a closed
 *   tulip opens it, spreading its wings to catch more; the next entry
 *   closes it (M5).
 */
export const POCKET_KINDS = ['start', 'out', 'foul', 'attacker', 'tulip'] as const;
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
  /** Tulips only: the wings, as polylines, in each state. */
  readonly wings?: Wings;
}

export interface Wings {
  /** Solid while the tulip is closed. */
  readonly closed: readonly (readonly Vec2[])[];
  /** Solid while it is open. */
  readonly open: readonly (readonly Vec2[])[];
}

export interface Launcher {
  /** Where a launched ball appears: the bottom of the launch lane. */
  readonly x: number;
  readonly y: number;
  /** Launch direction as the board data gives it, in degrees anticlockwise from +x. Kept so the board exports as it loaded. */
  readonly angleDeg: number;
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
 * that nails don't overlap each other or cut through a rail, lid or wing,
 * rails have distinct consecutive points, pockets are simple polygons, ids
 * are unique, there is an out-hole for balls to leave by, attackers (and
 * only attackers) have a lid, tulips (and only tulips) have wings in both
 * shapes, and the launcher sits clear of geometry, with every gate in
 * either state, with a usable speed range.
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

  /** A rail, lid or wing: at least 2 points, all on the board, no point repeating the one before. */
  const polyline = (v: unknown, path: string, what: 'rail' | 'lid' | 'wing'): Vec2[] | null => {
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

  /** A tulip's wings: both shapes present, each a non-empty list of polylines. */
  const wingShapes = (v: unknown, path: string): Wings | null => {
    const w = c.object(v, path, ['closed', 'open']);
    if (!w) return null;
    const shape = (key: 'closed' | 'open'): Vec2[][] | null => {
      const list = c.array(w[key], `${path}.${key}`);
      if (!list) return null;
      if (list.length === 0) {
        c.fail(`${path}.${key}`, 'needs at least one wing polyline');
        return null;
      }
      const out: Vec2[][] = [];
      list.forEach((p, k) => {
        const points = polyline(p, `${path}.${key}[${k}]`, 'wing');
        if (points) out.push(points);
      });
      return out.length === list.length ? out : null;
    };
    const closed = shape('closed');
    const open = shape('open');
    return closed && open ? { closed, open } : null;
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
    const o = c.object(v, path, ['id', 'kind', 'polygon', 'lid', 'wings']);
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
    let wings: Wings | null = null;
    let wingsOk = true;
    if (kind === 'tulip' && o['wings'] === undefined) {
      c.fail(
        `${path}.wings`,
        'a tulip needs wings, { "closed": [polyline, …], "open": [polyline, …] }',
      );
      wingsOk = false;
    } else if (validKind && kind !== 'tulip' && o['wings'] !== undefined) {
      c.fail(`${path}.wings`, `only tulip pockets have wings, not "${String(kind)}"`);
      wingsOk = false;
    } else if (o['wings'] !== undefined) {
      wings = wingShapes(o['wings'], `${path}.wings`);
      wingsOk = wings !== null;
    }
    const polygon = c.points(o['polygon'], `${path}.polygon`);
    if (!polygon) return;
    polygon.forEach((p, k) => onBoard(p, `${path}.polygon[${k}]`));
    const problem = polygonProblem(polygon);
    if (problem) c.fail(`${path}.polygon`, problem);
    if (id !== null && validKind && !problem && lidOk && wingsOk) {
      pockets.push({
        id,
        kind: kind as PocketKind,
        polygon,
        ...(lid ? { lid } : {}),
        ...(wings ? { wings } : {}),
      });
    }
  });
  if (Array.isArray(root['pockets']) && !pockets.some((p) => p.kind === 'out')) {
    c.fail('pockets', 'needs at least one "out" pocket, or balls can never leave');
  }

  // A nail cutting through a rail, lid or wing is a typo in the data, not a
  // layout; M7's nail adjustment refuses to move one there, and so does loading.
  const lines = solidLines(rails, pockets);
  nails.forEach((p, i) => {
    const problem = nailLineProblem(p, lines);
    if (problem) c.fail(`nails[${i}]`, `${fmt(p)} ${problem}`);
  });

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
      launcher = { x, y, angleDeg, dirX: Math.cos(a), dirY: Math.sin(a), minSpeedMps };
    }
  }

  if (c.issues.length > 0 || !sized || !launcher) throw new BoardError(c.issues);

  const board: Board = { name, widthM, heightM, nails, rails, pockets, launcher };

  // Checks that need the assembled geometry. The launch point must be clear
  // with gates in either state: a tulip opening adds wings.
  const world = createBoardWorld(board);
  const at = { x: launcher.x, y: launcher.y };
  const states = world.gates.length > 0 ? [false, true] : [false];
  for (const open of states) {
    for (const gate of world.gates) setGateOpen(world, gate.id, open);
    try {
      addBall(world, at);
    } catch {
      const state = open ? ' with every gate open' : '';
      c.fail('launcher', `a ball at ${fmt(at)} would overlap a nail or rail${state}`);
    }
    for (const ball of [...world.balls]) removeBall(world, ball.id);
  }
  const inPocket = world.sensors.find((s) => sensorContains(s, at.x, at.y));
  if (inPocket) c.fail('launcher', `${fmt(at)} is inside pocket "${inPocket.id}"`);
  if (c.issues.length > 0) throw new BoardError(c.issues);
  return board;
}

/** A point as the board data writes it. */
export type PointData = [number, number];

/** A board as plain JSON data, in the schema parseBoard reads (see the top of this file). */
export interface BoardData {
  name: string;
  widthM: number;
  heightM: number;
  nails: PointData[];
  rails: { id: string; points: PointData[] }[];
  pockets: {
    id: string;
    kind: PocketKind;
    polygon: PointData[];
    lid?: PointData[];
    wings?: { closed: PointData[][]; open: PointData[][] };
  }[];
  launcher: { x: number; y: number; angleDeg: number; minSpeedMps: number };
}

/**
 * The inverse of parseBoard: a board as JSON data, with the fields in the
 * order boards/classic.json has them. parseBoard(boardData(b)) equals b.
 * For M7's export.
 */
export function boardData(board: Board): BoardData {
  const pt = (p: Vec2): PointData => [p.x, p.y];
  const line = (points: readonly Vec2[]): PointData[] => points.map(pt);
  const { launcher } = board;
  return {
    name: board.name,
    widthM: board.widthM,
    heightM: board.heightM,
    nails: line(board.nails),
    rails: board.rails.map((r) => ({ id: r.id, points: line(r.points) })),
    pockets: board.pockets.map((p) => ({
      id: p.id,
      kind: p.kind,
      polygon: line(p.polygon),
      ...(p.lid ? { lid: line(p.lid) } : {}),
      ...(p.wings
        ? { wings: { closed: p.wings.closed.map(line), open: p.wings.open.map(line) } }
        : {}),
    })),
    launcher: {
      x: launcher.x,
      y: launcher.y,
      angleDeg: launcher.angleDeg,
      minSpeedMps: launcher.minSpeedMps,
    },
  };
}

interface NamedLine {
  /** For messages: 'rail "outer"', 'the lid of pocket "attacker"'. */
  readonly name: string;
  readonly points: readonly Vec2[];
}

/** Every line a nail must stay clear of: rails, lids, and tulip wings in both shapes. */
function solidLines(rails: readonly Rail[], pockets: readonly Pocket[]): NamedLine[] {
  const lines: NamedLine[] = rails.map((r) => ({ name: `rail "${r.id}"`, points: r.points }));
  for (const p of pockets) {
    if (p.lid) lines.push({ name: `the lid of pocket "${p.id}"`, points: p.lid });
    for (const wing of [...(p.wings?.closed ?? []), ...(p.wings?.open ?? [])]) {
      lines.push({ name: `a wing of pocket "${p.id}"`, points: wing });
    }
  }
  return lines;
}

function segmentDistanceM(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Why a nail at `p` would cut through one of `lines`, or null if it is clear of all of them. */
function nailLineProblem(p: Vec2, lines: readonly NamedLine[]): string | null {
  for (const line of lines) {
    for (let k = 1; k < line.points.length; k++) {
      const a = line.points[k - 1] as Vec2;
      const b = line.points[k] as Vec2;
      if (segmentDistanceM(p, a, b) < NAIL_RADIUS_M) return `overlaps ${line.name}`;
    }
  }
  return null;
}

/**
 * Why nail `index` can't move to `to`, or null if it can: the same rules
 * parseBoard applies to a nail (a finite point on the board, clear of the
 * other nails and of every rail, lid and wing) plus the one it checks on
 * the assembled world, that a ball at the launch point stays clear of it.
 * Everything else on the board is unchanged, so this is enough for the
 * moved board to be valid. For M7's nail adjustment.
 */
export function nailMoveProblem(board: Board, index: number, to: Vec2): string | null {
  if (!(Number.isInteger(index) && index >= 0 && index < board.nails.length)) {
    return `no nail ${index}; the board has ${board.nails.length}`;
  }
  if (!(Number.isFinite(to.x) && Number.isFinite(to.y))) return 'must be a finite point';
  if (!(to.x >= 0 && to.x <= board.widthM && to.y >= 0 && to.y <= board.heightM)) {
    return `${fmt(to)} is outside the ${board.widthM} × ${board.heightM} m board`;
  }
  for (let j = 0; j < board.nails.length; j++) {
    const other = board.nails[j] as Vec2;
    if (j !== index && Math.hypot(to.x - other.x, to.y - other.y) < 2 * NAIL_RADIUS_M) {
      return `${fmt(to)} overlaps nails[${j}] at ${fmt(other)}`;
    }
  }
  const line = nailLineProblem(to, solidLines(board.rails, board.pockets));
  if (line) return `${fmt(to)} ${line}`;
  const { launcher } = board;
  // The same clearance addBall checks a launched ball against.
  const launchReachM = BALL_RADIUS_M - CONTACT_SLOP_M + NAIL_RADIUS_M;
  if (Math.hypot(to.x - launcher.x, to.y - launcher.y) < launchReachM) {
    return `${fmt(to)} blocks the launch point ${fmt(launcher)}`;
  }
  return null;
}

/**
 * The board with nail `index` moved to `to`. Throws a BoardError, naming
 * the nail, if nailMoveProblem finds one. The board passed in is unchanged.
 */
export function moveNail(board: Board, index: number, to: Vec2): Board {
  const problem = nailMoveProblem(board, index, to);
  if (problem) throw new BoardError([`nails[${index}]: ${problem}`]);
  const nails = [...board.nails];
  nails[index] = { x: to.x, y: to.y };
  return { ...board, nails };
}

/**
 * How far outside the board a ball may stray before it is removed. Only a
 * board with a gap in its walls lets a ball get there; this is a backstop so
 * such a ball can't fly forever.
 */
const BOUNDS_MARGIN_M = 0.05;

/**
 * Build the sim world for a board: nails, rails, pockets as sensors, bounds,
 * and a gate for each attacker's lid and each tulip's wings, closed, with
 * the pocket's id. Balls collide with each other (M5).
 */
export function createBoardWorld(board: Board): World {
  return createWorld({
    circles: board.nails.map((p) => createCircle(p, NAIL_RADIUS_M, NAIL_MATERIAL)),
    segments: board.rails.flatMap((r) => createPolyline(r.points, RAIL_MATERIAL)),
    sensors: board.pockets.map((p) => createSensor(p.id, p.polygon)),
    gates: board.pockets.flatMap((p) => {
      if (p.lid)
        return [{ id: p.id, segments: createPolyline(p.lid, RAIL_MATERIAL), sensorId: p.id }];
      if (p.wings) {
        const shape = (lines: Wings['closed']) =>
          lines.flatMap((line) => createPolyline(line, RAIL_MATERIAL));
        return [
          {
            id: p.id,
            segments: shape(p.wings.closed),
            openSegments: shape(p.wings.open),
            sensorId: p.id,
          },
        ];
      }
      return [];
    }),
    ballCollisions: true,
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
 * Whether a ball can be launched now: no ball sits at the launch point.
 * Nails, rails and gates can't: parseBoard checks the launch point is clear
 * of them with every gate closed and with every gate open, and each gate's
 * geometry depends on its own state alone.
 */
export function launcherClear(world: World, board: Board): boolean {
  return !overlapsBall(world, board.launcher.x, board.launcher.y);
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
