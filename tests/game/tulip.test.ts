// Tulips: an entry into a closed tulip opens it, the next closes it (M5).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { enterTulip, tulipIds, tulipOpen } from '../../src/game/tulip';
import { createBoardWorld, parseBoard } from '../../src/sim/board';
import { addBall } from '../../src/sim/world';
import { TULIP_MOUTH_Y_M, TULIP_X_M, tulipBoardData } from '../fixtures/tulipBoard';

const board = parseBoard(tulipBoardData());

describe('tulips', () => {
  it('lists the board’s tulips, and starts them closed', () => {
    expect(tulipIds(board)).toEqual(['tulip']);
    expect(tulipOpen(createBoardWorld(board), 'tulip')).toBe(false);
  });

  it('opens on an entry while closed and closes on the next, with no timer', () => {
    const world = createBoardWorld(board);
    expect(enterTulip(world, 'tulip')).toEqual([]);
    expect(tulipOpen(world, 'tulip')).toBe(true);
    expect(enterTulip(world, 'tulip')).toEqual([]);
    expect(tulipOpen(world, 'tulip')).toBe(false);
    expect(enterTulip(world, 'tulip')).toEqual([]);
    expect(tulipOpen(world, 'tulip')).toBe(true);
  });

  it('returns a ball its opening wings would land on, taken into the tulip', () => {
    const world = createBoardWorld(board);
    // 3 mm below and left of the middle of the left open wing, 8 mm from
    // the closed wing's hinge: clear while closed.
    const ball = addBall(world, { x: TULIP_X_M - 0.0159, y: TULIP_MOUTH_Y_M + 0.0031 });
    const swept = enterTulip(world, 'tulip');
    expect(swept.map((c) => [c.ball.id, c.sensorId])).toEqual([[ball.id, 'tulip']]);
    expect(world.balls).toEqual([]);
  });

  it('finds none on the classic board, which has no tulips yet', () => {
    const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
    expect(tulipIds(classic)).toEqual([]);
  });

  it('rejects an id that is not a tulip in the world', () => {
    const world = createBoardWorld(board);
    expect(() => tulipOpen(world, 'nope')).toThrow(/no tulip "nope"/);
    expect(() => enterTulip(world, 'nope')).toThrow(/no tulip "nope"/);
  });
});
