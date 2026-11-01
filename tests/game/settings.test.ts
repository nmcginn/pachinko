import { describe, expect, it } from 'vitest';
import { STARTING_BALLS } from '../../src/game/economy';
import { DEFAULT_JACKPOT_PROBABILITY } from '../../src/game/lottery';
import {
  DEFAULT_SETTINGS,
  JACKPOT_ODDS,
  STARTING_BALL_OPTIONS,
  YEN_PER_BALL,
  isJackpotOdds,
  isStartingBalls,
  jackpotProbability,
  parseSettings,
  snapVolume,
  startingBallsLabel,
} from '../../src/game/settings';

describe('settings: the choices', () => {
  it('defaults to the game rules: 1 in 99, 250 balls, full volume', () => {
    expect(DEFAULT_SETTINGS).toEqual({ jackpotOdds: 99, startingBalls: 250, volume: 1 });
    expect(DEFAULT_SETTINGS.startingBalls).toBe(STARTING_BALLS);
    expect(jackpotProbability(DEFAULT_SETTINGS.jackpotOdds)).toBe(DEFAULT_JACKPOT_PROBABILITY);
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
  });

  it('offers the defaults among the choices', () => {
    expect(JACKPOT_ODDS).toContain(DEFAULT_SETTINGS.jackpotOdds);
    expect(STARTING_BALL_OPTIONS).toContain(DEFAULT_SETTINGS.startingBalls);
  });

  it('turns odds into a probability per spin', () => {
    expect(JACKPOT_ODDS.map(jackpotProbability)).toEqual([1 / 99, 1 / 199, 1 / 319]);
    for (const odds of JACKPOT_ODDS) {
      const p = jackpotProbability(odds);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });

  it('prices starting balls at ¥4 a ball, so 250 is the ¥1000 rental', () => {
    expect(YEN_PER_BALL * STARTING_BALLS).toBe(1000);
    expect(STARTING_BALL_OPTIONS.map(startingBallsLabel)).toEqual([
      '125 balls (¥500)',
      '250 balls (¥1,000)',
      '500 balls (¥2,000)',
      '1,250 balls (¥5,000)',
    ]);
  });

  it('recognises only the choices on offer', () => {
    expect(isJackpotOdds(199)).toBe(true);
    for (const v of [0, 1, 100, 99.5, '99', null, undefined, NaN])
      expect(isJackpotOdds(v)).toBe(false);
    expect(isStartingBalls(500)).toBe(true);
    for (const v of [0, 249, 251, -250, '250', 250.5, Infinity])
      expect(isStartingBalls(v)).toBe(false);
  });
});

describe('settings: volume', () => {
  it('snaps to tenths and clamps to [0, 1]', () => {
    expect(snapVolume(0)).toBe(0);
    expect(snapVolume(1)).toBe(1);
    expect(snapVolume(0.3)).toBe(0.3);
    expect(snapVolume(0.1 + 0.2)).toBe(0.3);
    expect(snapVolume(0.74)).toBe(0.7);
    expect(snapVolume(0.75)).toBe(0.8);
    expect(snapVolume(-3)).toBe(0);
    expect(snapVolume(7)).toBe(1);
    expect(snapVolume(Infinity)).toBeNull();
  });

  it('every step reads back as a tidy decimal', () => {
    for (let i = 0; i <= 10; i++) expect(String(snapVolume(i / 10))).toMatch(/^(0|1|0\.\d)$/);
  });

  it('has no volume for anything but a finite number', () => {
    for (const v of [NaN, -Infinity, '0.5', null, undefined, {}]) expect(snapVolume(v)).toBeNull();
  });
});

describe('settings: reading a saved copy', () => {
  it('keeps every valid field', () => {
    expect(parseSettings({ jackpotOdds: 319, startingBalls: 1250, volume: 0.4 })).toEqual({
      jackpotOdds: 319,
      startingBalls: 1250,
      volume: 0.4,
    });
  });

  it('falls back to the default for each field that is missing or not a choice on offer', () => {
    expect(parseSettings({ jackpotOdds: 2, startingBalls: 500 })).toEqual({
      jackpotOdds: 99,
      startingBalls: 500,
      volume: 1,
    });
    expect(parseSettings({ jackpotOdds: 199, startingBalls: '500', volume: 'loud' })).toEqual({
      jackpotOdds: 199,
      startingBalls: 250,
      volume: 1,
    });
    // Zero balls is a valid table, but not a game anyone would choose.
    expect(parseSettings({ startingBalls: 0 }).startingBalls).toBe(250);
  });

  it('snaps a saved volume rather than refusing it', () => {
    expect(parseSettings({ volume: 0.33 }).volume).toBe(0.3);
    expect(parseSettings({ volume: 5 }).volume).toBe(1);
    expect(parseSettings({ volume: 0 }).volume).toBe(0);
  });

  it('gives the defaults for anything that is not an object, and never throws', () => {
    for (const raw of [null, undefined, 0, 'settings', true, [99, 250, 1]]) {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('ignores extra fields', () => {
    expect(parseSettings({ ...DEFAULT_SETTINGS, cheat: true })).toEqual(DEFAULT_SETTINGS);
  });
});
