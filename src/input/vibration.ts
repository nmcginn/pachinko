// Vibration toggle: the button, or the V key anywhere. Shown only where
// haptics work (a touch screen with the Vibration API), since a switch that
// does nothing is worse than none. Remembered in localStorage when the
// browser allows it, like the mute toggle (input/mute.ts).

import type { Haptics } from '../haptics/haptics';

export const VIBRATION_CODE = 'KeyV';
export const VIBRATION_STORAGE_KEY = 'pachinko.vibration';

/**
 * Whether this device can buzz for the player. Desktop Chrome has
 * navigator.vibrate but no motor, so a coarse (touch) primary pointer is
 * required too.
 */
export function hapticsSupported(nav: Navigator, coarsePointer: boolean): boolean {
  return typeof nav.vibrate === 'function' && coarsePointer;
}

/** The remembered choice, or true (vibration on) when there is none or storage is unavailable. */
export function loadVibration(storage: () => Storage): boolean {
  try {
    return storage().getItem(VIBRATION_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function saveVibration(storage: () => Storage, enabled: boolean): void {
  try {
    storage().setItem(VIBRATION_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Not remembered; the toggle still applies for this visit.
  }
}

/** Show the button's state: aria-pressed means vibration is on. */
export function showVibration(button: HTMLElement, enabled: boolean): void {
  button.setAttribute('aria-pressed', String(enabled));
  button.textContent = enabled ? 'Vibration on' : 'Vibration off';
}

/**
 * Show the button and toggle on a click or the V key on `target`. Returns
 * an unbind function. `storage` is a getter because reading `localStorage`
 * itself can throw.
 */
export function bindVibration(
  target: EventTarget,
  button: HTMLElement,
  haptics: Haptics,
  storage: () => Storage,
): () => void {
  const toggle = (): void => {
    haptics.setEnabled(!haptics.enabled);
    showVibration(button, haptics.enabled);
    saveVibration(storage, haptics.enabled);
  };
  const click = (): void => toggle();
  const down = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (k.code === VIBRATION_CODE && !k.repeat && !k.ctrlKey && !k.metaKey && !k.altKey) toggle();
  };
  showVibration(button, haptics.enabled);
  button.hidden = false;
  button.addEventListener('click', click);
  target.addEventListener('keydown', down);
  return () => {
    button.removeEventListener('click', click);
    target.removeEventListener('keydown', down);
  };
}
