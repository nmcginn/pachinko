// Debug overlay: FPS and sim steps per frame, as a DOM layer over the canvas.
// The visible text refreshes once per meter window so it is readable; the
// data-* attributes update every frame so tests can observe the loop.

import type { FrameInfo } from '../loop';
import type { World } from '../sim/world';
import { createFpsMeter } from './fps';

export interface DebugOverlay {
  update(frame: FrameInfo, world: Readonly<World>): void;
}

export function createDebugOverlay(el: HTMLElement): DebugOverlay {
  const meter = createFpsMeter(0.5);
  el.textContent = 'FPS –\nsteps/frame –';

  return {
    update(frame, world) {
      el.dataset['simSteps'] = String(world.steps);
      el.dataset['stepsPerFrame'] = String(frame.steps);
      const stats = meter.sample(frame.frameDtS, frame.steps);
      if (stats) {
        el.textContent =
          `FPS ${stats.fps.toFixed(0)}\n` +
          `steps/frame ${stats.stepsPerFrame.toFixed(1)}\n` +
          `sim ${world.timeS.toFixed(1)} s`;
      }
    },
  };
}
