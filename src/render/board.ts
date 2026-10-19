// Board drawing: playfield, rails, nails, and pockets, from the board data.
// Sim coordinates are metres with y up; here they become CSS pixels with y
// down, fitted to the canvas with a margin.

import type { Board, PocketKind } from '../sim/board';
import { NAIL_RADIUS_M } from '../sim/world';
import type { CanvasView } from './canvas';

const BACKGROUND = '#14161a';
const PLAYFIELD = '#1f3a2c';
const RAIL = '#c9ccd2';
const NAIL = '#c9a227';
const POCKET_FILL: Record<PocketKind, string> = {
  start: 'rgb(230 80 60 / 0.75)',
  out: 'rgb(0 0 0 / 0.6)',
  foul: 'rgb(120 120 130 / 0.5)',
};
const MARGIN_PX = 16;

/** Metres-to-pixels mapping: px = ox + x·scale, py = oy − y·scale. */
export interface BoardView {
  readonly scale: number;
  readonly ox: number;
  readonly oy: number;
}

/** Largest scale that fits the whole board in the canvas with a margin, centred. */
export function fitBoard(
  cssWidth: number,
  cssHeight: number,
  widthM: number,
  heightM: number,
  marginPx = MARGIN_PX,
): BoardView {
  const scale = Math.max(
    0,
    Math.min((cssWidth - 2 * marginPx) / widthM, (cssHeight - 2 * marginPx) / heightM),
  );
  return {
    scale,
    ox: (cssWidth - widthM * scale) / 2,
    oy: (cssHeight + heightM * scale) / 2,
  };
}

export function drawBoard(view: CanvasView, board: Board): BoardView {
  const { ctx, cssWidth: w, cssHeight: h } = view;
  view.resetTransform();
  const bv = fitBoard(w, h, board.widthM, board.heightM);
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
