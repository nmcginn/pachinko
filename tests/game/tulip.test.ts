// Tulips: an entry into a closed tulip opens it, the next closes it (M5).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { enterTulip, tulipIds, tulipOpen } from '../../src/game/tulip';
import { createBoardWorld, parseBoard } from '../../src/sim/board';
import { addBall } from '../../src/sim/world';
import { tulipMouth, underLeftOpenWing } from '../fixtures/tulips';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));

describe('tulips', () => {
  it('finds the classic board’s two tulips, and starts them closed', () => {
    expect(tulipIds(classic)).toEqual(['tulip-left', 'tulip-right']);
    const world = createBoardWorld(classic);
    expect(tulipOpen(world, 'tulip-left')).toBe(false);
    expect(tulipOpen(world, 'tulip-right')).toBe(false);
  });

  it('opens on an entry while closed and closes on the next, with no timer', () => {
    const world = createBoardWorld(classic);
    expect(enterTulip(world, 'tulip-left')).toEqual([]);
    expect(tulipOpen(world, 'tulip-left')).toBe(true);
    // Each tulip has its own state.
    expect(tulipOpen(world, 'tulip-right')).toBe(false);
    expect(enterTulip(world, 'tulip-left')).toEqual([]);
    expect(tulipOpen(world, 'tulip-left')).toBe(false);
    expect(enterTulip(world, 'tulip-left')).toEqual([]);
    expect(tulipOpen(world, 'tulip-left')).toBe(true);
  });

  it('returns a ball its opening wings would land on, taken into the tulip', () => {
    for (const id of ['tulip-left', 'tulip-right']) {
      const world = createBoardWorld(classic);
      const ball = addBall(world, underLeftOpenWing(tulipMouth(classic, id)));
      const swept = enterTulip(world, id);
      expect(swept.map((c) => [c.ball.id, c.sensorId])).toEqual([[ball.id, id]]);
      expect(world.balls).toEqual([]);
    }
  });

  it('finds none on a board without tulips', () => {
    const data = JSON.parse(readFileSync('boards/classic.json', 'utf8'));
    data.pockets = data.pockets.filter((p: { kind: string }) => p.kind !== 'tulip');
    // And their cups, or balls would come to rest in them.
    data.rails = data.rails.filter((r: { id: string }) => !r.id.startsWith('tulip-'));
    expect(tulipIds(parseBoard(data))).toEqual([]);
  });

  it('rejects an id that is not a tulip in the world', () => {
    const world = createBoardWorld(classic);
    expect(() => tulipOpen(world, 'nope')).toThrow(/no tulip "nope"/);
    expect(() => enterTulip(world, 'nope')).toThrow(/no tulip "nope"/);
  });
});
