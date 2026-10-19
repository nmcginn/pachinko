import { describe, expect, it } from 'vitest';
import { createMachine } from '../../src/game/machine';
import { FORCE_JACKPOT_CODE, bindDebugKeys } from '../../src/input/debug';
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
