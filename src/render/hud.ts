// HUD: ball counter and the launch handle's power, as DOM over the canvas.
// Hold indicators join it in M4. data-* attributes mirror the numbers so
// tests can read them without parsing text.

import type { Economy } from '../game/economy';
import type { FireControl } from '../game/fire';
import { powerToDialAngleDeg } from '../input/launcher';

export interface Hud {
  update(economy: Readonly<Economy>, fire: Readonly<FireControl>, inPlay: number): void;
}

export interface HudElements {
  /** Ball counter. */
  readonly balls: HTMLElement;
  /** The handle dial; its knob rotates with the power. */
  readonly handle: HTMLElement;
  readonly knob: HTMLElement;
  readonly power: HTMLElement;
}

export function createHud(els: HudElements): Hud {
  // Only touch the DOM when something changed.
  let shownBalls = NaN;
  let shownPower = NaN;
  let shownHeld: boolean | null = null;
  let shownInPlay = NaN;
  let shownStarts = NaN;
  let shownLaunched = NaN;

  return {
    update(economy, fire, inPlay) {
      if (economy.balls !== shownBalls) {
        shownBalls = economy.balls;
        els.balls.textContent = `Balls ${economy.balls}`;
        els.balls.dataset['balls'] = String(economy.balls);
      }
      if (economy.entries.start !== shownStarts) {
        shownStarts = economy.entries.start;
        els.balls.dataset['starts'] = String(economy.entries.start);
      }
      if (economy.launched !== shownLaunched) {
        shownLaunched = economy.launched;
        els.balls.dataset['launched'] = String(economy.launched);
      }
      if (inPlay !== shownInPlay) {
        shownInPlay = inPlay;
        els.balls.dataset['inPlay'] = String(inPlay);
      }
      if (fire.power !== shownPower) {
        shownPower = fire.power;
        const pct = Math.round(fire.power * 100);
        els.power.textContent = `${pct}%`;
        els.handle.dataset['power'] = fire.power.toFixed(3);
        els.handle.setAttribute('aria-valuenow', String(pct));
        els.knob.style.transform = `rotate(${powerToDialAngleDeg(fire.power)}deg)`;
      }
      if (fire.held !== shownHeld) {
        shownHeld = fire.held;
        els.handle.classList.toggle('held', fire.held);
      }
    },
  };
}
