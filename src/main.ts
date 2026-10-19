// Boot: load the board, size the canvas, wire the launch handle and the debug
// keys, and run the fixed-step loop, paused while the tab is hidden.

import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import './style.css';

import classicBoard from '../boards/classic.json';
import { createTable, stepTable } from './game/table';
import { bindDebugKeys } from './input/debug';
import { bindDial, bindKeyboard, createHolds } from './input/launcher';
import { bindVisibility, createClock, createLoop } from './loop';
import { drawBalls } from './render/balls';
import { drawBoard } from './render/board';
import { attachCanvas } from './render/canvas';
import { createDebugOverlay } from './render/debug';
import { createHud } from './render/hud';
import { REEL_BAND_PX, createReel } from './render/reel';
import { parseBoard } from './sim/board';
import { SIM_STEP_S } from './sim/world';

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
const hud = createHud({
  balls: byId('balls', HTMLElement),
  handle: byId('handle', HTMLElement),
  knob: byId('handle-knob', HTMLElement),
  power: byId('handle-power', HTMLElement),
});
const reelPanel = byId('reel', HTMLElement);
const reel = createReel({
  panel: reelPanel,
  digits: [...reelPanel.querySelectorAll<HTMLElement>('.reel-digit')],
  holds: [...reelPanel.querySelectorAll<HTMLElement>('.reel-hold')],
  status: byId('reel-status', HTMLElement),
});
/**
 * Seed for the launch spread and the lottery: `?seed=N` pins it (for tests and bug reports),
 * otherwise each page load gets a fresh one. Frame timing still varies, so
 * a pinned seed gives the same shot speeds, not necessarily the same game.
 */
function pickSeed(): number {
  const raw = new URLSearchParams(location.search).get('seed');
  const n = raw === null ? NaN : Number(raw);
  if (Number.isInteger(n) && n >= 0 && n < 2 ** 32) return n;
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

const table = createTable(parseBoard(classicBoard), { seed: pickSeed() });

const holds = createHolds(table.fire);
bindKeyboard(window, table.fire, holds);
bindDial(byId('handle', HTMLElement), table.fire, holds);
bindDebugKeys(window, table.machine);

const loop = createLoop(
  {
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
  },
  createClock(SIM_STEP_S, MAX_FRAME_S),
  {
    step: () => stepTable(table),
    render: (frame) => {
      const bv = drawBoard(view, table.board, table.world.gates, REEL_BAND_PX);
      drawBalls(view, bv, table.world.balls, frame.alpha);
      hud.update(table.economy, table.fire, table.world.balls.length);
      reel.update(table.machine);
      overlay.update(frame, table.world);
    },
  },
);

bindVisibility(loop, document);
