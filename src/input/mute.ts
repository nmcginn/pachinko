// Mute toggle: the sound button, or the M key anywhere. The choice is
// remembered in localStorage when the browser allows it; when it doesn't
// (a private window, blocked site data), muting still works for the visit.

import type { Sound } from '../audio/sound';

export const MUTE_CODE = 'KeyM';
export const MUTE_STORAGE_KEY = 'pachinko.muted';

/** The remembered choice, or false (sound on) when there is none or storage is unavailable. */
export function loadMuted(storage: () => Storage): boolean {
  try {
    return storage().getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(storage: () => Storage, muted: boolean): void {
  try {
    storage().setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Not remembered; the toggle still applies for this visit.
  }
}

/** Show the button's state: aria-pressed means muted. */
export function showMuted(button: HTMLElement, muted: boolean): void {
  button.setAttribute('aria-pressed', String(muted));
  button.textContent = muted ? 'Sound off' : 'Sound on';
}

/**
 * Toggle on a button click or the M key on `target`. Returns an unbind
 * function. `storage` is a getter because reading `localStorage` itself
 * can throw.
 */
export function bindMute(
  target: EventTarget,
  button: HTMLElement,
  sound: Sound,
  storage: () => Storage,
): () => void {
  const toggle = (): void => {
    sound.setMuted(!sound.muted);
    showMuted(button, sound.muted);
    saveMuted(storage, sound.muted);
  };
  const click = (): void => toggle();
  const down = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (k.code === MUTE_CODE && !k.repeat && !k.ctrlKey && !k.metaKey && !k.altKey) toggle();
  };
  showMuted(button, sound.muted);
  button.addEventListener('click', click);
  target.addEventListener('keydown', down);
  return () => {
    button.removeEventListener('click', click);
    target.removeEventListener('keydown', down);
  };
}
