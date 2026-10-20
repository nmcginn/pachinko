// Board drawing: playfield, rails, nails, pockets, the attacker's lid while
// its gate is closed, and each tulip's wings in its current shape, from the
// board data and the world's gates.
// Sim coordinates are metres with y up; here they become CSS pixels with y
// down, fitted to the canvas with a margin.

import type { Board, PocketKind } from '../sim/board';
import type { Vec2 } from '../sim/vec';
import { type Gate, NAIL_RADIUS_M } from '../sim/world';
import type { CanvasView } from './canvas';

const BACKGROUND = '#14161a';
const PLAYFIELD = '#1f3a2c';
const RAIL = '#c9ccd2';
const NAIL = '#c9a227';
/** The attacker's lid and the tulips' wings: brass-coloured, so they read as parts that move. */
const LID = '#e0b84a';
const POCKET_FILL: Record<PocketKind, string> = {
  start: 'rgb(230 80 60 / 0.75)',
  out: 'rgb(0 0 0 / 0.6)',
  foul: 'rgb(120 120 130 / 0.5)',
  attacker: 'rgb(240 190 60 / 0.55)',
  tulip: 'rgb(220 90 160 / 0.6)',
};
const MARGIN_PX = 16;

/** The moving parts that are solid now: closed lids, and each tulip's wings in its current shape. */
export function gateLines(board: Board, gates: readonly Gate[]): (readonly Vec2[])[] {
  const lines: (readonly Vec2[])[] = [];
  for (const pocket of board.pockets) {
    const open = gates.find((g) => g.id === pocket.id)?.open ?? false;
    if (pocket.lid && !open) lines.push(pocket.lid);
    if (pocket.wings) lines.push(...(open ? pocket.wings.open : pocket.wings.closed));
  }
  return lines;
}

/** Metres-to-pixels mapping: px = ox + x·scale, py = oy − y·scale. */
export interface BoardView {
  readonly scale: number;
  readonly ox: number;
  readonly oy: number;
}

/**
 * Largest scale that fits the whole board in the canvas with a margin,
 * centred in what is left below a band of `topPx` (the reel panel's).
 */
export function fitBoard(
  cssWidth: number,
  cssHeight: number,
  widthM: number,
  heightM: number,
  marginPx = MARGIN_PX,
  topPx = 0,
): BoardView {
  const usableHeight = cssHeight - topPx;
  const scale = Math.max(
    0,
    Math.min((cssWidth - 2 * marginPx) / widthM, (usableHeight - 2 * marginPx) / heightM),
  );
  return {
    scale,
    ox: (cssWidth - widthM * scale) / 2,
    oy: topPx + (usableHeight + heightM * scale) / 2,
  };
}

/**
 * Draw the board below a top band of `topPx`. Gates come from the world: a
 * closed attacker's lid is drawn, and each tulip's wings in its state.
 */
export function drawBoard(
  view: CanvasView,
  board: Board,
  gates: readonly Gate[],
  topPx = 0,
): BoardView {
  const { ctx, cssWidth: w, cssHeight: h } = view;
  view.resetTransform();
  const bv = fitBoard(w, h, board.widthM, board.heightM, MARGIN_PX, topPx);
  const px = (x: number) => bv.ox + x * bv.scale;
  const py = (y: number) => bv.oy - y * bv.scale;

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PLAYFIELD;
  ctx.fillRect(px(0), py(board.heightM), board.widthM * bv.scale, board.heightM * bv.scale);

  for (const pocket of board.pockets) {
    ctx.fillStyle = POCKET_FILL[pocket.kind];
    ctx.beginPath();
    for (const p of pocket.polygon) ctx.lineTo(px(p.x), py(p.y));
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = RAIL;
  ctx.lineWidth = Math.max(1, 0.0015 * bv.scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const rail of board.rails) {
    ctx.beginPath();
    for (const p of rail.points) ctx.lineTo(px(p.x), py(p.y));
    ctx.stroke();
  }

  ctx.strokeStyle = LID;
  ctx.lineWidth = Math.max(2, 0.0025 * bv.scale);
  for (const line of gateLines(board, gates)) {
    ctx.beginPath();
    for (const p of line) ctx.lineTo(px(p.x), py(p.y));
    ctx.stroke();
  }

  ctx.fillStyle = NAIL;
  const r = Math.max(1, NAIL_RADIUS_M * bv.scale);
  ctx.beginPath();
  for (const n of board.nails) {
    ctx.moveTo(px(n.x) + r, py(n.y));
    ctx.arc(px(n.x), py(n.y), r, 0, 2 * Math.PI);
  }
  ctx.fill();
  return bv;
}
