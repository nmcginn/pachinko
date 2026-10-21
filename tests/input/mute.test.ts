import { describe, expect, it } from 'vitest';
import type { Sound } from '../../src/audio/sound';
import { MUTE_CODE, MUTE_STORAGE_KEY, bindMute, loadMuted } from '../../src/input/mute';

function fakeSound(startMuted = false): Sound {
  let muted = startMuted;
  return {
    unlocked: false,
    get muted() {
      return muted;
    },
    unlock: () => undefined,
    setMuted(value) {
      muted = value;
    },
    play: () => undefined,
  };
}

function fakeButton() {
  const target = new EventTarget();
  const attrs = new Map<string, string>();
  return Object.assign(target, {
    textContent: '',
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

function setup(storage: () => Storage = memoryStorage, muted = false) {
  const target = new EventTarget();
  const button = fakeButton();
  const sound = fakeSound(muted);
  const unbind = bindMute(target, button as unknown as HTMLElement, sound, storage);
  const key = (props: Record<string, unknown>) => {
    const e = new Event('keydown');
    Object.assign(e, { repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...props });
    target.dispatchEvent(e);
  };
  return { target, button, sound, unbind, key };
}

describe('mute toggle', () => {
  it('shows the starting state on the button', () => {
    expect(setup().button.attrs.get('aria-pressed')).toBe('false');
    const muted = setup(memoryStorage, true).button;
    expect(muted.attrs.get('aria-pressed')).toBe('true');
    expect(muted.textContent).toBe('Sound off');
  });

  it('a click or the M key toggles it, and the button follows', () => {
    expect(MUTE_CODE).toBe('KeyM');
    const { button, sound, key } = setup();
    button.dispatchEvent(new Event('click'));
    expect(sound.muted).toBe(true);
    expect(button.attrs.get('aria-pressed')).toBe('true');
    expect(button.textContent).toBe('Sound off');
    key({ code: 'KeyM' });
    expect(sound.muted).toBe(false);
    expect(button.attrs.get('aria-pressed')).toBe('false');
    expect(button.textContent).toBe('Sound on');
  });

  it('ignores key repeat, modified presses, other keys, and everything after unbinding', () => {
    const { button, sound, key, unbind } = setup();
    key({ code: 'KeyM', repeat: true });
    key({ code: 'KeyM', ctrlKey: true });
    key({ code: 'KeyM', metaKey: true });
    key({ code: 'KeyM', altKey: true });
    key({ code: 'KeyN' });
    expect(sound.muted).toBe(false);
    unbind();
    key({ code: 'KeyM' });
    button.dispatchEvent(new Event('click'));
    expect(sound.muted).toBe(false);
  });

  it('remembers the choice across visits', () => {
    const store = memoryStorage();
    expect(loadMuted(() => store)).toBe(false);
    const { key } = setup(() => store);
    key({ code: 'KeyM' });
    expect(store.getItem(MUTE_STORAGE_KEY)).toBe('1');
    expect(loadMuted(() => store)).toBe(true);
    key({ code: 'KeyM' });
    expect(loadMuted(() => store)).toBe(false);
  });

  it('still toggles when storage is unavailable, and starts with sound on', () => {
    expect(loadMuted(throwing)).toBe(false);
    const { sound, key } = setup(throwing);
    key({ code: 'KeyM' });
    expect(sound.muted).toBe(true);
  });
});
