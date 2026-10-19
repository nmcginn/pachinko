import { describe, expect, it } from 'vitest';
import {
  STARTING_BALLS,
  createEconomy,
  recordEntry,
  takeBallForLaunch,
} from '../../src/game/economy';

describe('economy', () => {
  it('starts with the classic ¥1000 rental of 250 balls', () => {
    expect(STARTING_BALLS).toBe(250);
    expect(createEconomy()).toEqual({
      balls: 250,
      launched: 0,
      entries: { start: 0, out: 0, foul: 0 },
    });
  });

  it('takes one ball per launch', () => {
    const e = createEconomy(3);
    expect(takeBallForLaunch(e)).toBe(true);
    expect(e).toMatchObject({ balls: 2, launched: 1 });
  });

  it('refuses to launch from an empty tray, changing nothing', () => {
    const e = createEconomy(1);
    expect(takeBallForLaunch(e)).toBe(true);
    expect(takeBallForLaunch(e)).toBe(false);
    expect(e).toMatchObject({ balls: 0, launched: 1 });
    const none = createEconomy(0);
    expect(takeBallForLaunch(none)).toBe(false);
    expect(none.launched).toBe(0);
  });

  it('tallies pocket entries without paying for out or start yet', () => {
    const e = createEconomy(10);
    recordEntry(e, 'out');
    recordEntry(e, 'out');
    recordEntry(e, 'start');
    expect(e.entries).toEqual({ start: 1, out: 2, foul: 0 });
    expect(e.balls).toBe(10);
  });

  it('puts a foul ball back in the tray', () => {
    const e = createEconomy(1);
    takeBallForLaunch(e);
    expect(e.balls).toBe(0);
    recordEntry(e, 'foul');
    expect(e).toMatchObject({ balls: 1, launched: 1, entries: { start: 0, out: 0, foul: 1 } });
    // The returned ball can be launched again.
    expect(takeBallForLaunch(e)).toBe(true);
  });

  it('rejects a negative or fractional starting count', () => {
    expect(() => createEconomy(-1)).toThrow(RangeError);
    expect(() => createEconomy(2.5)).toThrow(RangeError);
    expect(() => createEconomy(NaN)).toThrow(RangeError);
  });
});
