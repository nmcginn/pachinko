// Ball drawing. Interpolates each ball between its position at the start of
// the latest step and its current one, by the frame loop's leftover alpha,
// so motion stays smooth whatever the display rate. Reads the world only.

import { type Ball, BALL_RADIUS_M } from '../sim/world';
import type { BoardView } from './board';
import type { CanvasView } from './canvas';

const BALL = '#d9dde3';
const BALL_EDGE = '#7d838c';

/** Where to draw a ball, in metres: alpha of the way from its previous position to its current one. */
export function interpolate(ball: Readonly<Ball>, alpha: number): { x: number; y: number } {
  return {
    x: ball.prevX + (ball.x - ball.prevX) * alpha,
    y: ball.prevY + (ball.y - ball.prevY) * alpha,
  };
}

export function drawBalls(
  view: CanvasView,
  bv: BoardView,
  balls: readonly Readonly<Ball>[],
  alpha: number,
): void {
  const { ctx } = view;
  const r = Math.max(1.5, BALL_RADIUS_M * bv.scale);
  ctx.fillStyle = BALL;
  ctx.strokeStyle = BALL_EDGE;
  ctx.lineWidth = 1;
  for (const ball of balls) {
    const p = interpolate(ball, alpha);
    ctx.beginPath();
    ctx.arc(bv.ox + p.x * bv.scale, bv.oy - p.y * bv.scale, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
}
