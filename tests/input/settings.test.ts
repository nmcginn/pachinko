// The settings panel's wiring (M8), against fake elements and a real table.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../src/game/settings';
import { createTable, stepTable } from '../../src/game/table';
import {
  BALL_CHOICES,
  CLOSE_CODE,
  ODDS_CHOICES,
  SETTINGS_STORAGE_KEY,
  type SettingsElements,
  bindSettings,
  loadSettings,
} from '../../src/input/settings';
import { parseBoard } from '../../src/sim/board';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));

function memoryStorage(items = new Map<string, string>()): () => Storage {
  const storage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  } as Storage;
  return () => storage;
}

const throwing = (): Storage => {
  throw new Error('SecurityError: storage blocked');
};

function shown() {
  const attrs = new Map<string, string>();
  return Object.assign(new EventTarget(), {
    hidden: true as boolean,
    textContent: '' as string | null,
    attrs,
    dataset: {} as Record<string, string | undefined>,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
  });
}

const field = (value = '') => Object.assign(new EventTarget(), { value });

function setup(
  options: { initial?: Settings; storage?: () => Storage; items?: Map<string, string> } = {},
) {
  const items = options.items ?? new Map<string, string>();
  const storage = options.storage ?? memoryStorage(items);
  const initial = options.initial ?? DEFAULT_SETTINGS;
  const table = createTable(classic, {
    seed: 3,
    startingBalls: initial.startingBalls,
    jackpotProbability: 1 / initial.jackpotOdds,
  });
  const els = {
    toggle: shown(),
    panel: shown(),
    odds: field(),
    balls: field(),
    volume: field(),
    volumeValue: shown(),
    note: shown(),
    newGame: shown(),
    done: new EventTarget(),
  };
  const volumes: number[] = [];
  const log: string[] = [];
  const target = new EventTarget();
  const panel = bindSettings(target, els as unknown as SettingsElements, initial, {
    table,
    sound: { setVolume: (v) => volumes.push(v) },
    storage,
    restarted: () => log.push('restarted'),
    toggled: (open) => log.push(open ? 'opened' : 'closed'),
  });
  const change = (el: EventTarget & { value: string }, value: string, type = 'change') => {
    el.value = value;
    el.dispatchEvent(new Event(type));
  };
  const click = (el: EventTarget) => el.dispatchEvent(new Event('click'));
  const key = (code: string) => {
    const e = new Event('keydown');
    Object.assign(e, { code });
    target.dispatchEvent(e);
  };
  const saved = () => JSON.parse(items.get(SETTINGS_STORAGE_KEY) ?? 'null') as unknown;
  return { table, els, panel, volumes, log, change, click, key, saved, items };
}

describe('settings: storage', () => {
  it('loads the defaults when nothing is saved, or storage is blocked', () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
  });

  it('loads what was saved, field by field', () => {
    const items = new Map([[SETTINGS_STORAGE_KEY, '{"jackpotOdds":199,"startingBalls":7}']]);
    expect(loadSettings(memoryStorage(items))).toEqual({
      jackpotOdds: 199,
      startingBalls: 250,
      volume: 1,
    });
  });

  it('loads the defaults from a corrupt save', () => {
    const items = new Map([[SETTINGS_STORAGE_KEY, '{"jackpotOdds":']]);
    expect(loadSettings(memoryStorage(items))).toEqual(DEFAULT_SETTINGS);
  });

  it('still applies a change when storage is blocked', () => {
    const { change, els, table, panel } = setup({ storage: throwing });
    change(els.odds, '319');
    expect(table.machine.jackpotProbability).toBe(1 / 319);
    expect(panel.settings.jackpotOdds).toBe(319);
  });
});

describe('settings: the choices', () => {
  it('offers every option with a readable label', () => {
    expect(ODDS_CHOICES).toEqual([
      { value: '99', label: '1 in 99' },
      { value: '199', label: '1 in 199' },
      { value: '319', label: '1 in 319' },
    ]);
    expect(BALL_CHOICES.map((c) => c.value)).toEqual(['125', '250', '500', '1250']);
    expect(BALL_CHOICES[1]?.label).toBe('250 balls (¥1,000)');
  });
});

describe('settings: the panel', () => {
  it('starts closed, showing the settings it was given', () => {
    const { els, panel } = setup({
      initial: { jackpotOdds: 199, startingBalls: 500, volume: 0.6 },
    });
    expect(panel.open).toBe(false);
    expect(els.panel.hidden).toBe(true);
    expect(els.toggle.attrs.get('aria-expanded')).toBe('false');
    expect([els.odds.value, els.balls.value, els.volume.value]).toEqual(['199', '500', '60']);
    expect(els.volumeValue.textContent).toBe('60%');
    expect(els.note.hidden).toBe(true);
    expect(els.newGame.textContent).toBe('New game');
  });

  it('opens and closes with the button, Done, or Escape, telling the page each time', () => {
    const { els, panel, click, key, log } = setup();
    click(els.toggle);
    expect(panel.open).toBe(true);
    expect(els.panel.hidden).toBe(false);
    expect(els.toggle.attrs.get('aria-expanded')).toBe('true');
    click(els.toggle);
    expect(panel.open).toBe(false);
    click(els.toggle);
    click(els.done);
    expect(panel.open).toBe(false);
    key(CLOSE_CODE);
    expect(log).toEqual(['opened', 'closed', 'opened', 'closed']);
    click(els.toggle);
    key('KeyQ');
    expect(panel.open).toBe(true);
    key(CLOSE_CODE);
    expect(panel.open).toBe(false);
    // setOpen (the page's, when edit mode starts) to the state it is in does nothing.
    panel.setOpen(false);
    expect(log).toEqual(['opened', 'closed', 'opened', 'closed', 'opened', 'closed']);
  });

  it('applies new odds at once, and saves them', () => {
    const { els, table, change, saved } = setup();
    change(els.odds, '199');
    expect(table.machine.jackpotProbability).toBe(1 / 199);
    expect(saved()).toEqual({ jackpotOdds: 199, startingBalls: 250, volume: 1 });
    change(els.odds, '99');
    expect(table.machine.jackpotProbability).toBe(1 / 99);
  });

  it('ignores a value that is not on offer, showing the setting as it was', () => {
    const { els, table, change, saved, panel } = setup();
    change(els.odds, '2');
    change(els.balls, '1000000');
    change(els.volume, 'loud', 'input');
    expect(els.odds.value).toBe('99');
    expect(els.balls.value).toBe('250');
    expect(els.volume.value).toBe('100');
    expect(table.machine.jackpotProbability).toBe(1 / 99);
    expect(panel.settings).toEqual(DEFAULT_SETTINGS);
    expect(saved()).toBeNull();
  });

  it('keeps starting balls for the next new game, and says so', () => {
    const { els, table, change, saved } = setup();
    change(els.balls, '1250');
    expect(table.economy.balls).toBe(250);
    expect(saved()).toMatchObject({ startingBalls: 1250 });
    expect(els.note.hidden).toBe(false);
    expect(els.note.textContent).toBe('New games start with 1,250 balls (¥5,000).');
    change(els.balls, '250');
    expect(els.note.hidden).toBe(true);
  });

  it('sets the volume as the slider moves, snapped to tenths', () => {
    const { els, volumes, change, saved } = setup();
    change(els.volume, '30', 'input');
    change(els.volume, '0', 'input');
    change(els.volume, '-50', 'input');
    expect(volumes).toEqual([0.3, 0, 0]);
    expect(els.volumeValue.textContent).toBe('0%');
    expect(saved()).toMatchObject({ volume: 0 });
  });

  it('starts a new game at once when no ball has been launched', () => {
    const { els, table, change, click, log } = setup();
    change(els.balls, '500');
    change(els.odds, '319');
    click(els.newGame);
    expect(log).toEqual(['restarted']);
    expect(table.economy.balls).toBe(500);
    expect(table.economy.startingBalls).toBe(500);
    expect(table.machine.jackpotProbability).toBe(1 / 319);
    expect(els.note.hidden).toBe(true);
  });

  it('mid-game, asks for a second press before throwing the game away', () => {
    const { els, table, change, click, log } = setup();
    table.fire.held = true;
    for (let i = 0; i < 100; i++) stepTable(table);
    expect(table.economy.launched).toBe(1);
    change(els.balls, '125');

    click(els.newGame);
    expect(log).toEqual([]);
    expect(els.newGame.dataset['confirm']).toBe('true');
    expect(els.newGame.textContent).toBe('Start over: press again');
    expect(els.note.textContent).toBe("This game's 249 balls go; the new one starts with 125.");
    click(els.newGame);
    expect(log).toEqual(['restarted']);
    expect(table.economy.balls).toBe(125);
    expect(els.newGame.dataset['confirm']).toBe('false');
    expect(els.newGame.textContent).toBe('New game');
  });

  it('forgets a half-made new game on any other change, or closing the panel', () => {
    const { els, table, change, click, log } = setup();
    table.fire.held = true;
    for (let i = 0; i < 100; i++) stepTable(table);
    click(els.toggle);
    click(els.newGame);
    change(els.odds, '199');
    expect(els.newGame.dataset['confirm']).toBe('false');
    click(els.newGame);
    click(els.done);
    click(els.toggle);
    click(els.newGame);
    expect(log).toEqual(['opened', 'closed', 'opened']);
    expect(table.economy.launched).toBe(1);
  });

  it('does nothing after unbinding', () => {
    const { els, table, change, click, key, panel, log } = setup();
    panel.unbind();
    change(els.odds, '319');
    click(els.toggle);
    click(els.newGame);
    key(CLOSE_CODE);
    expect(table.machine.jackpotProbability).toBe(1 / 99);
    expect(log).toEqual([]);
  });
});
