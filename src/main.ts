// Boot: load the board, size the canvas, wire the launch handle and the debug
// keys, and run the fixed-step loop, paused while the tab is hidden.

import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import './style.css';

import classicBoard from '../boards/classic.json';
import { collectCues, createCueTracker, drainCues } from './audio/cues';
import { bindUnlock, createSound } from './audio/sound';
import { createAdjust } from './game/adjust';
import { asLoaded, createLiveStats, measure, stopMeasuring } from './game/livestats';
import { createTable, stepTable } from './game/table';
import { createHaptics } from './haptics/haptics';
import { bindAdjust } from './input/adjust';
import { bindBoardFile, browserDownloads } from './input/boardfile';
import { bindDebugKeys } from './input/debug';
import { bindDial, bindKeyboard, createHolds } from './input/launcher';
import { bindMute, loadMuted } from './input/mute';
import { bindVibration, hapticsSupported, loadVibration } from './input/vibration';
import { bindVisibility, createClock, createLoop } from './loop';
import { createAdjustPanel, drawAdjust } from './render/adjust';
import { drawBalls } from './render/balls';
import { type BoardView, drawBoard, drawGlints } from './render/board';
import { attachCanvas } from './render/canvas';
import { createFlash } from './render/celebration';
import { createDebugOverlay } from './render/debug';
import { collectGlints, createGlints } from './render/glints';
import { createHud } from './render/hud';
import { REEL_BAND_PX, createReel } from './render/reel';
import { createStatsPanel } from './render/stats';
import { parseBoard } from './sim/board';
import { createStatsDriver } from './stats/driver';
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

/** Most balls `?inplay=N` will keep in play. */
const MAX_IN_PLAY = 100;

/**
 * Debug load: `?inplay=N` keeps N free balls in play, launched at the
 * handle power (TableOptions.keepInPlay), for checking frame time against
 * M6's budget. Off without it, or for anything but a whole number from 0
 * to MAX_IN_PLAY.
 */
function pickInPlay(): number {
  const raw = new URLSearchParams(location.search).get('inplay');
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= MAX_IN_PLAY ? n : 0;
}

const table = createTable(parseBoard(classicBoard), {
  seed: pickSeed(),
  keepInPlay: pickInPlay(),
});

// Nail adjustment (M7). While editing, the table isn't stepped, and the
// handle's keys and dial do nothing: the arrows nudge or bend the selected nail.
const adjust = createAdjust(table);
const playing = () => !adjust.editing;
const adjustPanel = createAdjustPanel({
  toggle: byId('adjust', HTMLButtonElement),
  panel: byId('adjust-panel', HTMLElement),
  selection: byId('adjust-selection', HTMLElement),
  problem: byId('adjust-problem', HTMLElement),
  root: document.body,
  nudgeMode: byId('mode-nudge', HTMLButtonElement),
  bendMode: byId('mode-bend', HTMLButtonElement),
  arrows: {
    left: byId('nudge-left', HTMLButtonElement),
    right: byId('nudge-right', HTMLButtonElement),
    up: byId('nudge-up', HTMLButtonElement),
    down: byId('nudge-down', HTMLButtonElement),
  },
});
// Live stats (M7): while editing, a Web Worker measures spins per ¥1000 on
// the board as it stands and as it loaded, at the handle's power, a batch
// at a time; each edit redirects the next batch.
const stats = createLiveStats();
const statsPanel = createStatsPanel({
  root: byId('adjust-stats', HTMLElement),
  title: byId('stats-title', HTMLElement),
  current: byId('stats-current', HTMLElement),
  baseline: byId('stats-baseline', HTMLElement),
  change: byId('stats-change', HTMLElement),
  error: byId('stats-error', HTMLElement),
});
const showStats = () => statsPanel.update(stats, table.fire.power);
const statsDriver = createStatsDriver(
  new Worker(new URL('./stats/worker.ts', import.meta.url), { type: 'module' }),
  stats,
  showStats,
);
/** Point the stats at the board as it stands now, or stop them outside edit mode. */
function remeasure(): void {
  if (adjust.editing) {
    measure(stats, table.board, asLoaded(table.board, adjust.original), table.fire.power);
  } else {
    stopMeasuring(stats);
  }
  statsDriver.pump();
  showStats();
}

/** The board's mapping to the canvas in the latest frame, for picking nails. */
let boardView: BoardView | null = null;
bindAdjust(
  window,
  {
    toggle: byId('adjust', HTMLButtonElement),
    canvas,
    left: byId('nudge-left', HTMLButtonElement),
    right: byId('nudge-right', HTMLButtonElement),
    up: byId('nudge-up', HTMLButtonElement),
    down: byId('nudge-down', HTMLButtonElement),
    reset: byId('nudge-reset', HTMLButtonElement),
    nudgeMode: byId('mode-nudge', HTMLButtonElement),
    bendMode: byId('mode-bend', HTMLButtonElement),
  },
  adjust,
  table,
  () => boardView,
  () => {
    adjustPanel.update(adjust, table.board);
    remeasure();
  },
);
// Export and import (M7): the board as it stands to a JSON file, or one
// in its place. An import replaces the table's world, so what is kept per
// world (the glints) starts again with it.
bindBoardFile(
  {
    exportButton: byId('board-export', HTMLButtonElement),
    importButton: byId('board-import', HTMLButtonElement),
    file: byId('board-file', HTMLInputElement),
  },
  adjust,
  table,
  browserDownloads(document),
  () => {
    adjustPanel.update(adjust, table.board);
    remeasure();
  },
  () => (glints = createGlints(table.world)),
);
adjustPanel.update(adjust, table.board);
remeasure();

const holds = createHolds(table.fire);
bindKeyboard(window, table.fire, holds, playing);
bindDial(byId('handle', HTMLElement), table.fire, holds, playing);
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
let glints = createGlints(table.world);
// No screen flash for players who ask for less motion (M8 builds on this).
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const flash = createFlash(byId('flash', HTMLElement), () => reducedMotion.matches);

const loop = createLoop(
  {
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    now: () => performance.now(),
  },
  createClock(SIM_STEP_S, MAX_FRAME_S),
  {
    step: () => {
      // Paused while adjusting nails: the clock runs on, so nothing piles
      // up to catch up on afterwards.
      if (adjust.editing) return;
      stepTable(table);
      collectCues(cues, table);
      collectGlints(glints, table.world);
    },
    render: (frame) => {
      const frameCues = drainCues(cues);
      sound.play(frameCues);
      haptics?.play(frameCues);
      const bv = drawBoard(view, table.board, table.world.gates, REEL_BAND_PX);
      boardView = bv;
      const glinting = drawGlints(view, bv, table.board, glints, table.world.steps);
      // For tests: nails glinting in this frame. Only written when it changes.
      if (canvas.dataset['glints'] !== String(glinting))
        canvas.dataset['glints'] = String(glinting);
      // Paused balls are drawn where they are, not part-way through a step.
      drawBalls(view, bv, table.world.balls, adjust.editing ? 1 : frame.alpha);
      drawAdjust(view, bv, table.board, adjust);
      hud.update(table.economy, table.fire, table.world.balls.length);
      reel.update(table.machine);
      flash.update(table.machine);
      overlay.update(frame, table.world);
    },
    measured: (workMs) => overlay.measured(workMs, table.world.balls.length),
  },
);

bindVisibility(loop, document);
