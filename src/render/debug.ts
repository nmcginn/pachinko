// Debug overlay: FPS, sim steps per frame and frame work time, as a DOM
// layer over the canvas. The visible text refreshes once per meter window so
// it is readable; the step data-* attributes update every frame so tests
// can observe the loop, and the frame-time ones with the text.

import type { FrameInfo } from '../loop';
import type { World } from '../sim/world';
import { createFpsMeter } from './fps';
import { createFrameTimeMeter } from './frametime';

export interface DebugOverlay {
  update(frame: FrameInfo, world: Readonly<World>): void;
  /** One frame's work time (steps and render) in ms, and the balls in play then. */
  measured(workMs: number, balls: number): void;
}

export function createDebugOverlay(el: HTMLElement): DebugOverlay {
  const meter = createFpsMeter(0.5);
  const frameTime = createFrameTimeMeter();
  el.textContent = 'FPS –\nsteps/frame –';

  return {
    update(frame, world) {
      el.dataset['simSteps'] = String(world.steps);
      el.dataset['stepsPerFrame'] = String(frame.steps);
      const stats = meter.sample(frame.frameDtS, frame.steps);
      if (!stats) return;
      let text =
        `FPS ${stats.fps.toFixed(0)}\n` +
        `steps/frame ${stats.stepsPerFrame.toFixed(1)}\n` +
        `sim ${world.timeS.toFixed(1)} s`;
      const ft = frameTime.stats();
      if (ft) {
        text +=
          `\nframe ${ft.meanMs.toFixed(1)} ms, p95 ${ft.p95Ms.toFixed(1)}\n` +
          `balls ${world.balls.length}`;
        // Over the last FRAME_TIME_WINDOW frames.
        el.dataset['frameFrames'] = String(ft.frames);
        el.dataset['frameMeanMs'] = ft.meanMs.toFixed(3);
        el.dataset['frameP95Ms'] = ft.p95Ms.toFixed(3);
        el.dataset['frameMaxMs'] = ft.maxMs.toFixed(3);
        el.dataset['frameMinBalls'] = String(ft.minBalls);
        el.dataset['frameMeanBalls'] = ft.meanBalls.toFixed(2);
      }
      el.textContent = text;
    },
    measured(workMs, balls) {
      frameTime.sample(workMs, balls);
    },
  };
}
