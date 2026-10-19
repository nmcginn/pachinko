import { describe, expect, it } from 'vitest';
import {
  BoardError,
  createBoardWorld,
  launchBall,
  launchSpeedMps,
  parseBoard,
  pocketKind,
} from '../../src/sim/board';
import { MAX_LAUNCH_SPEED_MPS, NAIL_RADIUS_M } from '../../src/sim/world';

/** Smallest useful board: a bowl with an out-hole and a launcher above it. */
function minimal(): Record<string, unknown> {
  return {
    name: 'test',
    widthM: 0.2,
    heightM: 0.2,
    nails: [
      [0.1, 0.1],
      [0.12, 0.1],
    ],
    rails: [
      {
        id: 'bowl',
        points: [
          [0.01, 0.19],
          [0.01, 0.05],
          [0.09, 0.02],
        ],
      },
    ],
    pockets: [
      {
        id: 'out',
        kind: 'out',
        polygon: [
          [0.09, 0.02],
          [0.11, 0.02],
          [0.11, 0.001],
          [0.09, 0.001],
        ],
      },
    ],
    launcher: { x: 0.05, y: 0.15, angleDeg: 90, minSpeedMps: 1 },
  };
}

/** Issues reported for a board, or [] if it parses. */
function issues(data: unknown): readonly string[] {
  try {
    parseBoard(data);
    return [];
  } catch (e) {
    if (e instanceof BoardError) return e.issues;
    throw e;
  }
}

function edit(change: (b: Record<string, unknown>) => void): Record<string, unknown> {
  const b = minimal();
  change(b);
  return b;
}

describe('parseBoard', () => {
  it('accepts a minimal valid board', () => {
    const board = parseBoard(minimal());
    expect(board.name).toBe('test');
    expect(board.nails).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.12, y: 0.1 },
    ]);
    expect(board.rails[0]?.points).toHaveLength(3);
    expect(board.pockets[0]).toMatchObject({ id: 'out', kind: 'out' });
    expect(board.launcher.dirX).toBeCloseTo(0, 15);
    expect(board.launcher.dirY).toBeCloseTo(1, 15);
  });

  it('accepts a board with no nails and no rails', () => {
    const board = parseBoard(
      edit((b) => {
        b['nails'] = [];
        b['rails'] = [];
      }),
    );
    expect(board.nails).toEqual([]);
    expect(createBoardWorld(board).circles).toEqual([]);
  });

  it('rejects things that are not boards at all', () => {
    for (const bad of [null, 42, 'board', [], undefined]) {
      expect(issues(bad)).toEqual(['board: must be an object']);
    }
    const empty = issues({});
    for (const field of ['name', 'widthM', 'heightM', 'nails', 'rails', 'pockets', 'launcher']) {
      expect(
        empty.some((i) => i.startsWith(`${field}:`)),
        field,
      ).toBe(true);
    }
  });

  it('throws a BoardError whose message lists every issue', () => {
    const data = edit((b) => {
      b['widthM'] = -1;
      b['nails'] = [[0.1, 'x']];
    });
    expect(() => parseBoard(data)).toThrow(BoardError);
    expect(() => parseBoard(data)).toThrow(/widthM: must be > 0\n\s+nails\[0\]: must be a point/);
  });

  it('rejects unknown fields, so a typo cannot be silently ignored', () => {
    expect(issues(edit((b) => (b['nail'] = [])))).toEqual(['board.nail: unknown field']);
    expect(
      issues(
        edit((b) => {
          b['launcher'] = { x: 0.05, y: 0.15, angleDeg: 90, minSpeedMps: 1, power: 1 };
        }),
      ),
    ).toEqual(['launcher.power: unknown field']);
  });

  it('rejects non-finite and malformed numbers and points', () => {
    expect(issues(edit((b) => (b['heightM'] = Infinity)))).toEqual([
      'heightM: must be a finite number',
    ]);
    expect(issues(edit((b) => (b['nails'] = [[0.1]])))).toEqual([
      'nails[0]: must be a point [x, y] of two finite numbers',
    ]);
    expect(issues(edit((b) => (b['nails'] = [[0.1, NaN]])))).toEqual([
      'nails[0]: must be a point [x, y] of two finite numbers',
    ]);
    expect(issues(edit((b) => (b['name'] = '')))).toEqual(['name: must be a non-empty string']);
  });

  it('says which nail is off the board and where it is', () => {
    expect(
      issues(
        edit(
          (b) =>
            (b['nails'] = [
              [0.1, 0.1],
              [0.25, 0.1],
            ]),
        ),
      ),
    ).toEqual(['nails[1]: (0.25, 0.1) is outside the 0.2 × 0.2 m board']);
  });

  it('rejects overlapping nails, naming both', () => {
    const close = 0.1 + 1.5 * NAIL_RADIUS_M;
    expect(
      issues(
        edit(
          (b) =>
            (b['nails'] = [
              [0.1, 0.1],
              [close, 0.1],
            ]),
        ),
      ),
    ).toEqual([`nails[1]: (${close}, 0.1) overlaps nails[0] at (0.1, 0.1)`]);
    // Touching exactly is allowed.
    expect(
      issues(
        edit(
          (b) =>
            (b['nails'] = [
              [0.1, 0.1],
              [0.1 + 2 * NAIL_RADIUS_M, 0.1],
            ]),
        ),
      ),
    ).toEqual([]);
  });

  it('rejects bad rails', () => {
    expect(issues(edit((b) => (b['rails'] = [{ id: 'r', points: [[0.1, 0.1]] }])))).toEqual([
      'rails[0].points: a rail needs at least 2 points, got 1',
    ]);
    expect(
      issues(
        edit(
          (b) =>
            (b['rails'] = [
              {
                id: 'r',
                points: [
                  [0.1, 0.15],
                  [0.1, 0.15],
                ],
              },
            ]),
        ),
      ),
    ).toEqual(['rails[0].points[1]: repeats the previous point (0.1, 0.15)']);
    const twice = {
      id: 'r',
      points: [
        [0.15, 0.19],
        [0.19, 0.19],
      ],
    };
    expect(issues(edit((b) => (b['rails'] = [twice, twice])))).toEqual([
      'rails[1].id: duplicate rail id "r"',
    ]);
    expect(
      issues(
        edit(
          (b) =>
            (b['rails'] = [
              {
                points: [
                  [0, 0],
                  [0.1, 0],
                ],
              },
            ]),
        ),
      ),
    ).toEqual(['rails[0].id: must be a non-empty string']);
  });

  it('rejects bad pockets', () => {
    const out = (minimal()['pockets'] as unknown[])[0] as Record<string, unknown>;
    expect(issues(edit((b) => (b['pockets'] = [{ ...out, kind: 'jackpot' }])))).toEqual([
      'pockets[0].kind: must be one of start, out, foul, got jackpot',
      'pockets: needs at least one "out" pocket, or balls can never leave',
    ]);
    expect(
      issues(
        edit(
          (b) =>
            (b['pockets'] = [
              out,
              {
                id: 'bow',
                kind: 'start',
                polygon: [
                  [0.15, 0.15],
                  [0.16, 0.16],
                  [0.16, 0.15],
                  [0.15, 0.16],
                ],
              },
            ]),
        ),
      ),
    ).toEqual(['pockets[1].polygon: edges 0 and 2 cross']);
    expect(issues(edit((b) => (b['pockets'] = [out, { ...out }])))).toEqual([
      'pockets[1].id: duplicate pocket id "out"',
    ]);
    expect(issues(edit((b) => (b['pockets'] = [])))).toEqual([
      'pockets: needs at least one "out" pocket, or balls can never leave',
    ]);
  });

  it('rejects a launcher that overlaps geometry, sits in a pocket, or has a bad speed', () => {
    const at = (x: number, y: number, extra: Record<string, unknown> = {}) =>
      issues(edit((b) => (b['launcher'] = { x, y, angleDeg: 90, minSpeedMps: 1, ...extra })));
    expect(at(0.1, 0.1)).toEqual(['launcher: a ball at (0.1, 0.1) would overlap a nail or rail']);
    expect(at(0.1, 0.01)).toEqual(['launcher: (0.1, 0.01) is inside pocket "out"']);
    expect(at(0.3, 0.1)).toEqual(['launcher: (0.3, 0.1) is outside the 0.2 × 0.2 m board']);
    expect(at(0.05, 0.15, { minSpeedMps: 0 })).toEqual([
      `launcher.minSpeedMps: must be in (0, ${MAX_LAUNCH_SPEED_MPS}] (MAX_LAUNCH_SPEED_MPS), got 0`,
    ]);
    expect(at(0.05, 0.15, { minSpeedMps: MAX_LAUNCH_SPEED_MPS + 1 })).toHaveLength(1);
    expect(at(0.05, 0.15, { minSpeedMps: MAX_LAUNCH_SPEED_MPS })).toEqual([]);
  });

  it('reports every problem in one pass', () => {
    const found = issues(
      edit((b) => {
        b['nails'] = [[-1, 0]];
        b['rails'] = [{ id: 'r', points: [[0.1, 0.1]] }];
        b['launcher'] = { x: 0.05, y: 0.15, angleDeg: 'up', minSpeedMps: 1 };
      }),
    );
    expect(found).toHaveLength(3);
  });
});

describe('board world', () => {
  it('turns nails, rails, and pockets into circles, segments, and sensors', () => {
    const board = parseBoard(minimal());
    const world = createBoardWorld(board);
    expect(world.circles.map((c) => [c.x, c.y, c.radiusM])).toEqual([
      [0.1, 0.1, NAIL_RADIUS_M],
      [0.12, 0.1, NAIL_RADIUS_M],
    ]);
    expect(world.segments).toHaveLength(2);
    expect(world.sensors.map((s) => s.id)).toEqual(['out']);
    expect(world.bounds).toEqual({ minX: -0.05, minY: -0.05, maxX: 0.25, maxY: 0.25 });
    expect(pocketKind(board, 'out')).toBe('out');
    expect(pocketKind(board, 'nope')).toBeNull();
  });
});

describe('launch', () => {
  const { launcher } = parseBoard(minimal());

  it('maps power 0..1 linearly from the board minimum to MAX_LAUNCH_SPEED_MPS', () => {
    expect(launchSpeedMps(launcher, 0)).toBe(1);
    expect(launchSpeedMps(launcher, 1)).toBe(MAX_LAUNCH_SPEED_MPS);
    expect(launchSpeedMps(launcher, 0.5)).toBe((1 + MAX_LAUNCH_SPEED_MPS) / 2);
  });

  it('clamps power outside [0, 1], and treats NaN as 0', () => {
    expect(launchSpeedMps(launcher, -3)).toBe(1);
    expect(launchSpeedMps(launcher, 7)).toBe(MAX_LAUNCH_SPEED_MPS);
    expect(launchSpeedMps(launcher, NaN)).toBe(1);
  });

  it('adds a ball at the launcher moving along the launch direction', () => {
    const board = parseBoard(minimal());
    const world = createBoardWorld(board);
    const ball = launchBall(world, board, 1);
    expect(world.balls).toEqual([ball]);
    expect([ball.x, ball.y]).toEqual([0.05, 0.15]);
    expect(ball.vx).toBeCloseTo(0, 12);
    expect(ball.vy).toBeCloseTo(MAX_LAUNCH_SPEED_MPS, 12);
  });
});
