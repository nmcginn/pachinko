// Board drawing. Until M2 brings a real board, this draws a placeholder frame
// in the board's portrait proportions so layout and DPR scaling can be checked.

import type { CanvasView } from './canvas';

const BACKGROUND = '#14161a';
const FRAME = '#c9a227';
const LABEL = '#e8e4d8';
/** Placeholder board proportions (width / height). Real geometry arrives with boards/classic.json in M2. */
const BOARD_ASPECT = 0.8;

export function drawBoard(view: CanvasView): void {
  const { ctx, cssWidth: w, cssHeight: h } = view;
  view.resetTransform();

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, w, h);

  const margin = 16;
  const boardH = Math.max(0, Math.min(h - 2 * margin, (w - 2 * margin) / BOARD_ASPECT));
  const boardW = boardH * BOARD_ASPECT;
  const x = (w - boardW) / 2;
  const y = (h - boardH) / 2;

  // Hairline frame: a 1 CSS px stroke on half-pixel offsets. At DPR 2 this is
  // exactly two device pixels wide; blur here means the scaling is wrong.
  ctx.strokeStyle = FRAME;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(boardW), Math.round(boardH));

  ctx.fillStyle = LABEL;
  ctx.font = '500 24px Jost, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Pachinko', w / 2, h / 2);
}
