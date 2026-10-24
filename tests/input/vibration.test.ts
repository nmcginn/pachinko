import { describe, expect, it } from 'vitest';
import type { Haptics } from '../../src/haptics/haptics';
import {
  VIBRATION_CODE,
  VIBRATION_STORAGE_KEY,
  bindVibration,
  hapticsSupported,
  loadVibration,
} from '../../src/input/vibration';

function fakeHaptics(startEnabled = true): Haptics {
  let enabled = startEnabled;
  return {
    get enabled() {
      return enabled;
    },
    setEnabled(value) {
      enabled = value;
    },
    play: () => undefined,
  };
}

function fakeButton() {
  const target = new EventTarget();
  const attrs = new Map<string, string>();
  return Object.assign(target, {
    textContent: '',
    hidden: true,
    attrs,
    setAttribute: (name: string, value: string) => attrs.set(name, value),
  });
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  } as Storage;
}

const throwing = (): Storage => {
  throw new Error('SecurityError: storage blocked');
};

function setup(storage: () => Storage = memoryStorage, enabled = true) {
  const target = new EventTarget();
  const button = fakeButton();
  const haptics = fakeHaptics(enabled);
  const unbind = bindVibration(target, button as unknown as HTMLElement, haptics, storage);
  const key = (props: Record<string, unknown>) => {
    const e = new Event('keydown');
    Object.assign(e, { repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...props });
    target.dispatchEvent(e);
  };
  return { target, button, haptics, unbind, key };
}

describe('haptics support', () => {
  const withVibrate = { vibrate: () => true } as unknown as Navigator;
  const without = {} as Navigator;

  it('needs both the Vibration API and a touch screen', () => {
    expect(hapticsSupported(withVibrate, true)).toBe(true);
    // Desktop Chrome: the API, but no motor.
    expect(hapticsSupported(withVibrate, false)).toBe(false);
    // iOS Safari: a touch screen, but no API.
    expect(hapticsSupported(without, true)).toBe(false);
    expect(hapticsSupported(without, false)).toBe(false);
  });
});

describe('vibration toggle', () => {
  it('shows the button with the starting state', () => {
    const on = setup().button;
    expect(on.hidden).toBe(false);
    expect(on.attrs.get('aria-pressed')).toBe('true');
    expect(on.textContent).toBe('Vibration on');
    const off = setup(memoryStorage, false).button;
    expect(off.attrs.get('aria-pressed')).toBe('false');
    expect(off.textContent).toBe('Vibration off');
  });

  it('a click or the V key toggles it, and the button follows', () => {
    expect(VIBRATION_CODE).toBe('KeyV');
    const { button, haptics, key } = setup();
    button.dispatchEvent(new Event('click'));
    expect(haptics.enabled).toBe(false);
    expect(button.attrs.get('aria-pressed')).toBe('false');
    expect(button.textContent).toBe('Vibration off');
    key({ code: 'KeyV' });
    expect(haptics.enabled).toBe(true);
    expect(button.attrs.get('aria-pressed')).toBe('true');
    expect(button.textContent).toBe('Vibration on');
  });

  it('ignores key repeat, modified presses, other keys, and everything after unbinding', () => {
    const { button, haptics, key, unbind } = setup();
    key({ code: 'KeyV', repeat: true });
    key({ code: 'KeyV', ctrlKey: true });
    key({ code: 'KeyV', metaKey: true });
    key({ code: 'KeyV', altKey: true });
    key({ code: 'KeyM' });
    expect(haptics.enabled).toBe(true);
    unbind();
    key({ code: 'KeyV' });
    button.dispatchEvent(new Event('click'));
    expect(haptics.enabled).toBe(true);
  });

  it('remembers the choice across visits', () => {
    const store = memoryStorage();
    expect(loadVibration(() => store)).toBe(true);
    const { key } = setup(() => store);
    key({ code: 'KeyV' });
    expect(store.getItem(VIBRATION_STORAGE_KEY)).toBe('0');
    expect(loadVibration(() => store)).toBe(false);
    key({ code: 'KeyV' });
    expect(loadVibration(() => store)).toBe(true);
  });

  it('still toggles when storage is unavailable, and starts with vibration on', () => {
    expect(loadVibration(throwing)).toBe(true);
    const { haptics, key } = setup(throwing);
    key({ code: 'KeyV' });
    expect(haptics.enabled).toBe(false);
  });
});
