// Settings panel (M8): jackpot odds, starting balls and volume, plus a New
// game button. The choices and their defaults are game/settings.ts's;
// this file keeps them in localStorage (when the browser allows it; when it
// doesn't, they still apply for the visit) and wires the panel.
//
// When each one takes effect:
// - Jackpot odds: at once, for every later start entry. Spins already drawn
//   (held, or on the reel) keep their results, since the lottery decides at
//   entry.
// - Starting balls: from the next new game. Changing them never refills or
//   empties the tray mid-game; the panel says so until a new game starts.
// - Volume: at once.
// - New game: asks for a second press while the current game has launched
//   any balls, so a stray tap can't throw a game away.

import type { Sound } from '../audio/sound';
import {
  type Settings,
  JACKPOT_ODDS,
  STARTING_BALL_OPTIONS,
  isJackpotOdds,
  isStartingBalls,
  jackpotProbability,
  parseSettings,
  snapVolume,
  startingBallsLabel,
} from '../game/settings';
import { setJackpotProbability } from '../game/machine';
import { type Table, newGame } from '../game/table';

export const SETTINGS_STORAGE_KEY = 'pachinko.settings';

/** The saved settings, or the defaults where there are none, they don't parse, or storage is unavailable. */
export function loadSettings(storage: () => Storage): Settings {
  try {
    const raw = storage().getItem(SETTINGS_STORAGE_KEY);
    return parseSettings(raw === null ? null : JSON.parse(raw));
  } catch {
    return parseSettings(null);
  }
}

function saveSettings(storage: () => Storage, settings: Settings): void {
  try {
    storage().setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not remembered; the settings still apply for this visit.
  }
}

/** One choice in a select: its value and what the player reads. */
export interface Choice {
  readonly value: string;
  readonly label: string;
}

export const ODDS_CHOICES: readonly Choice[] = JACKPOT_ODDS.map((n) => ({
  value: String(n),
  label: `1 in ${n}`,
}));

export const BALL_CHOICES: readonly Choice[] = STARTING_BALL_OPTIONS.map((n) => ({
  value: String(n),
  label: startingBallsLabel(n),
}));

/** Fill a `<select>` with its choices. */
export function fillSelect(
  doc: Document,
  select: HTMLSelectElement,
  choices: readonly Choice[],
): void {
  select.replaceChildren(
    ...choices.map((c) => {
      const option = doc.createElement('option');
      option.value = c.value;
      option.textContent = c.label;
      return option;
    }),
  );
}

/** A form control as far as this file uses one. */
interface Field extends EventTarget {
  value: string;
}

/** An element whose visibility and text this file sets. */
interface Shown extends EventTarget {
  hidden: HTMLElement['hidden'];
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  readonly dataset: Record<string, string | undefined>;
}

export interface SettingsElements {
  /** The Settings button: opens and closes the panel. */
  readonly toggle: Shown;
  readonly panel: Shown;
  readonly odds: Field;
  readonly balls: Field;
  /** A range input, 0 to 100 in steps of 10: percent. */
  readonly volume: Field;
  /** Shows the volume as a percentage. */
  readonly volumeValue: Shown;
  /** Says what hasn't taken effect yet (starting balls before a new game), or what a press of New game will do. */
  readonly note: Shown;
  readonly newGame: Shown;
  /** Closes the panel. */
  readonly done: EventTarget;
}

export interface SettingsHost {
  readonly table: Table;
  readonly sound: Pick<Sound, 'setVolume'>;
  readonly storage: () => Storage;
  /** After a new game has replaced the table's world and reset its tray and machine. */
  restarted(): void;
  /** After the panel opened or closed. */
  toggled(open: boolean): void;
}

export interface SettingsPanel {
  readonly settings: Settings;
  readonly open: boolean;
  setOpen(open: boolean): void;
}

export const CLOSE_CODE = 'Escape';

/**
 * Wire the panel to `host`, starting from `initial` (the settings the
 * table and sound were made with). Escape on `target` closes the panel.
 * Returns the panel's state and controls, and an unbind function.
 */
export function bindSettings(
  target: EventTarget,
  els: SettingsElements,
  initial: Settings,
  host: SettingsHost,
): SettingsPanel & { unbind(): void } {
  let settings = initial;
  let open = false;
  /** New game was pressed once, mid-game: the next press starts one. */
  let confirming = false;

  const percent = (v: number) => `${Math.round(v * 100)}%`;
  const show = (): void => {
    els.panel.hidden = !open;
    els.toggle.setAttribute('aria-expanded', String(open));
    els.odds.value = String(settings.jackpotOdds);
    els.balls.value = String(settings.startingBalls);
    els.volume.value = String(Math.round(settings.volume * 100));
    els.volumeValue.textContent = percent(settings.volume);
    els.newGame.textContent = confirming ? 'Start over: press again' : 'New game';
    els.newGame.dataset['confirm'] = String(confirming);
    const { economy } = host.table;
    let note = '';
    if (confirming) {
      note = `This game's ${economy.balls.toLocaleString('en-US')} balls go; the new one starts with ${settings.startingBalls.toLocaleString('en-US')}.`;
    } else if (settings.startingBalls !== economy.startingBalls) {
      note = `New games start with ${startingBallsLabel(settings.startingBalls)}.`;
    }
    els.note.textContent = note;
    els.note.hidden = note === '';
    els.panel.dataset['odds'] = String(settings.jackpotOdds);
    els.panel.dataset['startingBalls'] = String(settings.startingBalls);
    els.panel.dataset['volume'] = String(settings.volume);
  };
  const update = (next: Settings): void => {
    settings = next;
    confirming = false;
    saveSettings(host.storage, settings);
    show();
  };

  const setOpen = (value: boolean): void => {
    if (value === open) return;
    open = value;
    confirming = false;
    show();
    host.toggled(open);
  };

  const onToggle = (): void => setOpen(!open);
  const onOdds = (): void => {
    const n = Number(els.odds.value);
    if (!isJackpotOdds(n)) return show();
    setJackpotProbability(host.table.machine, jackpotProbability(n));
    update({ ...settings, jackpotOdds: n });
  };
  const onBalls = (): void => {
    const n = Number(els.balls.value);
    if (!isStartingBalls(n)) return show();
    update({ ...settings, startingBalls: n });
  };
  const onVolume = (): void => {
    const v = snapVolume(Number(els.volume.value) / 100);
    if (v === null) return show();
    host.sound.setVolume(v);
    update({ ...settings, volume: v });
  };
  const onNewGame = (): void => {
    if (host.table.economy.launched > 0 && !confirming) {
      confirming = true;
      show();
      return;
    }
    confirming = false;
    newGame(host.table, {
      startingBalls: settings.startingBalls,
      jackpotProbability: jackpotProbability(settings.jackpotOdds),
    });
    host.restarted();
    show();
  };
  const onKey = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (k.code === CLOSE_CODE && open) setOpen(false);
  };

  const listeners: [EventTarget, string, () => void][] = [
    [els.toggle, 'click', onToggle],
    [els.odds, 'change', onOdds],
    [els.balls, 'change', onBalls],
    [els.volume, 'input', onVolume],
    [els.newGame, 'click', onNewGame],
    [els.done, 'click', () => setOpen(false)],
  ];
  for (const [el, type, fn] of listeners) el.addEventListener(type, fn);
  target.addEventListener('keydown', onKey);
  show();

  return {
    get settings() {
      return settings;
    },
    get open() {
      return open;
    },
    setOpen,
    unbind() {
      for (const [el, type, fn] of listeners) el.removeEventListener(type, fn);
      target.removeEventListener('keydown', onKey);
    },
  };
}
