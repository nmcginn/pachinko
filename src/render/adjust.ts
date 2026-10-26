// Nail adjustment (M7) on screen: on the canvas, an outline round the
// playfield while editing, a ring on every moved nail, and on the selected
// one a brighter ring with a line back to where it started; in the DOM, the
// panel that says which nail is selected, where it is and how far it has
// moved, or why the last move was refused. data-* attributes mirror the
// numbers for tests.

import { type Adjust, NAIL_STEP_M, selectedOffset } from '../game/adjust';
import type { Board } from '../sim/board';
import { NAIL_RADIUS_M } from '../sim/world';
import type { BoardView } from './board';
import type { CanvasView } from './canvas';

/** Edit marks: a cool blue that reads against the green field and the brass nails. */
const EDIT = '#6fd3ff';
const MOVED_RING_RADII = 3;
const SELECTED_RING_RADII = 5;

/** Draw the edit marks over the board and balls. Nothing outside edit mode: play shows the board plain. */
export function drawAdjust(view: CanvasView, bv: BoardView, board: Board, adjust: Adjust): void {
  if (!adjust.editing) return;
  const { ctx } = view;
  const px = (x: number) => bv.ox + x * bv.scale;
  const py = (y: number) => bv.oy - y * bv.scale;
  const r = Math.max(1, NAIL_RADIUS_M * bv.scale);

  ctx.strokeStyle = EDIT;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(px(0), py(board.heightM), board.widthM * bv.scale, board.heightM * bv.scale);
  ctx.setLineDash([]);

  ctx.lineWidth = Math.max(1, r * 0.5);
  ctx.beginPath();
  for (const i of adjust.offsets.keys()) {
    const n = board.nails[i];
    if (!n || i === adjust.selected) continue;
    const ring = Math.max(4, r * MOVED_RING_RADII);
    ctx.moveTo(px(n.x) + ring, py(n.y));
    ctx.arc(px(n.x), py(n.y), ring, 0, 2 * Math.PI);
  }
  ctx.stroke();

  const i = adjust.selected;
  const n = i === null ? undefined : board.nails[i];
  if (i === null || !n) return;
  const home = adjust.original[i];
  ctx.lineWidth = Math.max(1.5, r * 0.7);
  if (home && (home.x !== n.x || home.y !== n.y)) {
    // Where it started: a small hollow mark and a line to it.
    ctx.beginPath();
    ctx.moveTo(px(home.x), py(home.y));
    ctx.lineTo(px(n.x), py(n.y));
    ctx.moveTo(px(home.x) + r, py(home.y));
    ctx.arc(px(home.x), py(home.y), r, 0, 2 * Math.PI);
    ctx.stroke();
  }
  const ring = Math.max(7, r * SELECTED_RING_RADII);
  ctx.beginPath();
  ctx.arc(px(n.x), py(n.y), ring, 0, 2 * Math.PI);
  ctx.stroke();
}

/** Millimetres to one decimal place, the nudge resolution. */
const mm = (m: number) => (m * 1000).toFixed(1);
/** An offset in steps as signed millimetres. */
const offsetMm = (steps: number) =>
  `${steps > 0 ? '+' : steps < 0 ? '−' : ''}${mm(Math.abs(steps) * NAIL_STEP_M)}`;

/** What the panel says about the selection: pure, for tests. */
export function describeSelection(adjust: Adjust, board: Board): string {
  const offset = selectedOffset(adjust);
  const n = adjust.selected === null ? undefined : board.nails[adjust.selected];
  if (!offset || !n) return 'Click or tap a nail to select it';
  const moved =
    offset.dx === 0 && offset.dy === 0
      ? 'not moved'
      : `moved ${offsetMm(offset.dx)}, ${offsetMm(offset.dy)} mm`;
  return `Nail ${adjust.selected} at ${mm(n.x)}, ${mm(n.y)} mm, ${moved}`;
}

export interface AdjustPanel {
  update(adjust: Adjust, board: Board): void;
}

export interface AdjustPanelElements {
  readonly toggle: HTMLElement;
  readonly panel: HTMLElement;
  readonly selection: HTMLElement;
  readonly problem: HTMLElement;
  /** Gets the `editing` class while editing, for the page's styles. */
  readonly root: HTMLElement;
}

export function createAdjustPanel(els: AdjustPanelElements): AdjustPanel {
  // Only touch the DOM when something changed.
  let shown = '';
  return {
    update(adjust, board) {
      const offset = selectedOffset(adjust);
      const selection = describeSelection(adjust, board);
      const key = [adjust.editing, selection, adjust.problem, adjust.offsets.size].join('|');
      if (key === shown) return;
      shown = key;
      els.root.classList.toggle('editing', adjust.editing);
      els.toggle.setAttribute('aria-pressed', String(adjust.editing));
      els.toggle.textContent = adjust.editing ? 'Done adjusting' : 'Adjust nails';
      els.panel.hidden = !adjust.editing;
      els.selection.textContent = selection;
      els.problem.textContent = adjust.problem ?? '';
      els.panel.dataset['selected'] = adjust.selected === null ? '' : String(adjust.selected);
      els.panel.dataset['offset'] = offset ? `${offset.dx},${offset.dy}` : '';
      els.panel.dataset['moved'] = String(adjust.offsets.size);
    },
  };
}
