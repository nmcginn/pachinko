// Boot: load the board, size the canvas, wire the launch handle and the debug
// keys, and run the fixed-step loop, paused while the tab is hidden.

import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import './style.css';

import classicBoard from '../boards/classic.json';
import { collectCues, createCueTracker, drainCues } from './audio/cues';
import { bindUnlock, createSound } from './audio/sound';
import { createTable, stepTable } from './game/table';
import { createHaptics } from './haptics/haptics';
import { bindDebugKeys } from './input/debug';
import { bindDial, bindKeyboard, createHolds } from './input/launcher';
import { bindMute, loadMuted } from './input/mute';
import { bindVibration, hapticsSupported, loadVibration } from './input/vibration';
import { bindVisibility, createClock, createLoop } from './loop';
import { drawBalls } from './render/balls';
import { drawBoard, drawGlints } from './render/board';
import { attachCanvas } from './render/canvas';
import { createFlash } from './render/celebration';
import { createDebugOverlay } from './render/debug';
import { collectGlints, createGlints } from './render/glints';
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

const canvas = byId('board', HTMLCanvasElement);
const view = attachCanvas(canvas);
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

// Sound starts on the first interaction, never before (bindUnlock).
const storage = (): Storage => localStorage;
const sound = createSound(
  { createContext: () => new AudioContext() },
  { muted: loadMuted(storage) },
);
bindUnlock(window, sound);
bindMute(window, byId('mute', HTMLButtonElement), sound, storage);
// Haptics on touch screens with the Vibration API, after the first
// interaction (browsers block vibrate() before one). Where
// navigator.userActivation is missing, the first interaction is our own
// count, the same as the sound's.
let interacted = false;
bindUnlock(window, { unlock: () => (interacted = true) });
const haptics = hapticsSupported(navigator, window.matchMedia('(pointer: coarse)').matches)
  ? createHaptics(
      {
        vibrate: (pattern) => navigator.vibrate(pattern),
        now: () => performance.now(),
        activated: () => navigator.userActivation?.hasBeenActive ?? interacted,
      },
      { enabled: loadVibration(storage) },
    )
  : null;
if (haptics) bindVibration(window, byId('vibration', HTMLButtonElement), haptics, storage);
const cues = createCueTracker(table);
const glints = createGlints(table.world);
// No screen flash for players who ask for less motion (M8 builds on this).
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const flash = createFlash(byId('flash', HTMLElement), () => reducedMotion.matches);

const loop = createLoop(
  {
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
  },
  createClock(SIM_STEP_S, MAX_FRAME_S),
  {
    step: () => {
      stepTable(table);
      collectCues(cues, table);
      collectGlints(glints, table.world);
    },
    render: (frame) => {
      const frameCues = drainCues(cues);
      sound.play(frameCues);
      haptics?.play(frameCues);
      const bv = drawBoard(view, table.board, table.world.gates, REEL_BAND_PX);
      const glinting = drawGlints(view, bv, table.board, glints, table.world.steps);
      // For tests: nails glinting in this frame. Only written when it changes.
      if (canvas.dataset['glints'] !== String(glinting))
        canvas.dataset['glints'] = String(glinting);
      drawBalls(view, bv, table.world.balls, frame.alpha);
      hud.update(table.economy, table.fire, table.world.balls.length);
      reel.update(table.machine);
      flash.update(table.machine);
      overlay.update(frame, table.world);
    },
  },
);

bindVisibility(loop, document);
