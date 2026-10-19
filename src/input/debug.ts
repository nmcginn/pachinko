// Debug keys. J forces a jackpot: the next spin hits, ahead of any held
// spins, so a full 10-round sequence can be played on demand (M4).

import { type Machine, forceJackpot } from '../game/machine';

export const FORCE_JACKPOT_CODE = 'KeyJ';

/** Debug keys on the whole window. Returns an unbind function. */
export function bindDebugKeys(target: Window, machine: Machine): () => void {
  const down = (e: KeyboardEvent): void => {
    if (e.code === FORCE_JACKPOT_CODE && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      forceJackpot(machine);
    }
  };
  target.addEventListener('keydown', down);
  return () => target.removeEventListener('keydown', down);
}
