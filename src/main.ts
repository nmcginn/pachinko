// Boot: size the canvas, start the fixed-step loop, pause it while hidden.

import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import './style.css';

import { bindVisibility, createClock, createLoop } from './loop';
import { attachCanvas } from './render/canvas';
import { createDebugOverlay } from './render/debug';
import { drawBoard } from './render/board';
import { SIM_STEP_S, createWorld, stepWorld } from './sim/world';

/**
 * Longest frame we simulate. A slower frame (a long GC pause, a debugger
 * break) drops the excess instead of running hundreds of catch-up steps.
 */
const MAX_FRAME_S = 0.1;

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`#${id} missing or not a ${type.name}`);
  return el;
}

const view = attachCanvas(byId('board', HTMLCanvasElement));
const overlay = createDebugOverlay(byId('debug', HTMLElement));
const world = createWorld();

const loop = createLoop(
  {
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
  },
  createClock(SIM_STEP_S, MAX_FRAME_S),
  {
    step: () => stepWorld(world),
    render: (frame) => {
      drawBoard(view);
      overlay.update(frame, world);
    },
  },
);

bindVisibility(loop, document);
