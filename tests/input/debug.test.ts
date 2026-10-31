import { describe, expect, it } from 'vitest';
import { createMachine } from '../../src/game/machine';
import {
  DEBUG_OVERLAY_CODE,
  FORCE_JACKPOT_CODE,
  bindDebugKeys,
  bindDebugToggle,
} from '../../src/input/debug';
import { createRng } from '../../src/sim/rng';

describe('debug keys', () => {
  function setup() {
    const target = new EventTarget();
    const machine = createMachine(createRng(1));
    const unbind = bindDebugKeys(target as unknown as Window, machine);
    const send = (props: Record<string, unknown>) => {
      const e = new Event('keydown', { cancelable: true });
      Object.assign(e, { repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...props });
      target.dispatchEvent(e);
    };
    return { machine, send, unbind };
  }

  it('J forces a jackpot', () => {
    expect(FORCE_JACKPOT_CODE).toBe('KeyJ');
    const { machine, send } = setup();
    send({ code: 'KeyJ' });
    expect(machine.forced).toBe(true);
  });

  it('ignores key repeat, modified presses, other keys, and everything after unbinding', () => {
    const { machine, send, unbind } = setup();
    send({ code: 'KeyJ', repeat: true });
    send({ code: 'KeyJ', ctrlKey: true });
    send({ code: 'KeyJ', metaKey: true });
    send({ code: 'KeyK' });
    expect(machine.forced).toBe(false);
    unbind();
    send({ code: 'KeyJ' });
    expect(machine.forced).toBe(false);
  });
});

describe('debug overlay toggle', () => {
  function setup(hidden: boolean) {
    const target = new EventTarget();
    // Only `hidden` is used, so a plain object stands in for the element.
    const overlay = { hidden } as HTMLElement;
    let changes = 0;
    const unbind = bindDebugToggle(target as unknown as Window, overlay, () => (changes += 1));
    const send = (props: Record<string, unknown>) => {
      const e = new Event('keydown', { cancelable: true });
      Object.assign(e, { repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...props });
      target.dispatchEvent(e);
    };
    return { overlay, send, unbind, changes: () => changes };
  }

  it('D shows and hides the overlay, and says so each time', () => {
    expect(DEBUG_OVERLAY_CODE).toBe('KeyD');
    const { overlay, send, changes } = setup(true);
    send({ code: 'KeyD' });
    expect(overlay.hidden).toBe(false);
    send({ code: 'KeyD' });
    expect(overlay.hidden).toBe(true);
    expect(changes()).toBe(2);
  });

  it('ignores key repeat, modified presses, other keys, and everything after unbinding', () => {
    const { overlay, send, unbind, changes } = setup(true);
    send({ code: 'KeyD', repeat: true });
    send({ code: 'KeyD', ctrlKey: true });
    send({ code: 'KeyD', altKey: true });
    send({ code: 'KeyJ' });
    expect(overlay.hidden).toBe(true);
    unbind();
    send({ code: 'KeyD' });
    expect(overlay.hidden).toBe(true);
    expect(changes()).toBe(0);
  });
});
