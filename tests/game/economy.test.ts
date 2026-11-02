import { describe, expect, it } from 'vitest';
import {
  ATTACKER_PAYOUT,
  START_POCKET_PAYOUT,
  STARTING_BALLS,
  TULIP_PAYOUT,
  createEconomy,
  recordEntry,
  resetEconomy,
  takeBallForLaunch,
} from '../../src/game/economy';

describe('economy', () => {
  it('starts with the classic ¥1000 rental of 250 balls', () => {
    expect(STARTING_BALLS).toBe(250);
    expect(createEconomy()).toEqual({
      startingBalls: 250,
      balls: 250,
      launched: 0,
      entries: { start: 0, out: 0, foul: 0, attacker: 0, tulip: 0 },
      paidOut: 0,
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

  it('tallies pocket entries; the out-hole pays nothing', () => {
    const e = createEconomy(10);
    recordEntry(e, 'out');
    recordEntry(e, 'out');
    expect(e.entries).toEqual({ start: 0, out: 2, foul: 0, attacker: 0, tulip: 0 });
    expect(e).toMatchObject({ balls: 10, paidOut: 0 });
  });

  it('pays TULIP_PAYOUT into the tray for each tulip entry, open or closed', () => {
    // Provisional: the payout is an open question for the maintainer (PLAN.md).
    expect(TULIP_PAYOUT).toBe(3);
    const e = createEconomy(0);
    recordEntry(e, 'tulip');
    recordEntry(e, 'tulip');
    expect(e).toMatchObject({ balls: 2 * TULIP_PAYOUT, paidOut: 2 * TULIP_PAYOUT });
    expect(e.entries.tulip).toBe(2);
  });

  it('pays 3 balls into the tray for each start-pocket entry', () => {
    expect(START_POCKET_PAYOUT).toBe(3);
    const e = createEconomy(1);
    takeBallForLaunch(e);
    recordEntry(e, 'start');
    expect(e).toMatchObject({ balls: 3, launched: 1, paidOut: 3, entries: { start: 1 } });
    recordEntry(e, 'start');
    expect(e).toMatchObject({ balls: 6, paidOut: 6, entries: { start: 2 } });
  });

  it('pays 15 balls into the tray for each attacker entry', () => {
    expect(ATTACKER_PAYOUT).toBe(15);
    const e = createEconomy(0);
    recordEntry(e, 'attacker');
    recordEntry(e, 'attacker');
    expect(e).toMatchObject({ balls: 30, paidOut: 30, entries: { attacker: 2, start: 0 } });
  });

  it('pays out into an empty tray, and the paid balls can be launched', () => {
    const e = createEconomy(0);
    expect(takeBallForLaunch(e)).toBe(false);
    recordEntry(e, 'start');
    for (let i = 0; i < START_POCKET_PAYOUT; i++) expect(takeBallForLaunch(e)).toBe(true);
    expect(takeBallForLaunch(e)).toBe(false);
  });

  it('puts a foul ball back in the tray', () => {
    const e = createEconomy(1);
    takeBallForLaunch(e);
    expect(e.balls).toBe(0);
    recordEntry(e, 'foul');
    // Back to the tray, but not a payout.
    expect(e).toMatchObject({
      balls: 1,
      launched: 1,
      paidOut: 0,
      entries: { start: 0, out: 0, foul: 1 },
    });
    // The returned ball can be launched again.
    expect(takeBallForLaunch(e)).toBe(true);
  });

  it('rejects a negative or fractional starting count', () => {
    expect(() => createEconomy(-1)).toThrow(RangeError);
    expect(() => createEconomy(2.5)).toThrow(RangeError);
    expect(() => createEconomy(NaN)).toThrow(RangeError);
  });

  it('remembers what it started with', () => {
    expect(createEconomy(500).startingBalls).toBe(500);
    expect(createEconomy(0).startingBalls).toBe(0);
  });

  it('resets in place for a new game: a fresh tray, no tallies', () => {
    const e = createEconomy(10);
    takeBallForLaunch(e);
    takeBallForLaunch(e);
    recordEntry(e, 'start');
    recordEntry(e, 'out');
    recordEntry(e, 'foul');
    recordEntry(e, 'attacker');
    recordEntry(e, 'tulip');
    const { entries } = e;
    resetEconomy(e, 1250);
    expect(e).toEqual(createEconomy(1250));
    // The same objects: the page and the cue tracker hold them.
    expect(e.entries).toBe(entries);
    resetEconomy(e, 0);
    expect(e).toEqual(createEconomy(0));
    expect(takeBallForLaunch(e)).toBe(false);
  });

  it('refuses a reset to anything but a whole number ≥ 0, changing nothing', () => {
    const e = createEconomy(10);
    takeBallForLaunch(e);
    const before = structuredClone(e);
    for (const n of [-1, 2.5, NaN, Infinity]) {
      expect(() => resetEconomy(e, n)).toThrow(RangeError);
      expect(e).toEqual(before);
    }
  });
});
