// Ball drawing. Interpolates each ball between its position at the start of
// the latest step and its current one, by the frame loop's leftover alpha,
// so motion stays smooth whatever the display rate. Reads the world only.
//
// Each ball is a polished steel sphere lit from the upper left: a radial
// shade from a bright core to a dark rim, a hard white specular highlight,
// and a faint green bounce light off the playfield at the lower right. That
// costs two gradients, so it is drawn once into a sprite at the ball's size
// in device pixels and stamped for every ball.

import { type Ball, BALL_RADIUS_M } from '../sim/world';
import type { BoardView } from './board';
import type { CanvasView } from './canvas';

/** Shade from the lit side to the rim, as [offset, colour] radial-gradient stops. */
const STEEL: readonly (readonly [number, string])[] = [
  [0, '#f4f6f8'],
  [0.35, '#c9ced5'],
  [0.75, '#7b828c'],
  [1, '#3c4148'],
];
/** Pure white, so nothing else on the board is this bright (the e2e test relies on it). */
const SPECULAR = '#ffffff';
const BOUNCE = 'rgb(120 200 150 / 0.35)';

/** Light direction, as a fraction of the radius from the centre: up and to the left. */
export const LIGHT = { x: -0.35, y: -0.4 } as const;
/** Specular highlight radius, as a fraction of the ball's. */
export const SPECULAR_RADIUS = 0.28;

/** Where to draw a ball, in metres: alpha of the way from its previous position to its current one. */
export function interpolate(ball: Readonly<Ball>, alpha: number): { x: number; y: number } {
  return {
    x: ball.prevX + (ball.x - ball.prevX) * alpha,
    y: ball.prevY + (ball.y - ball.prevY) * alpha,
  };
}

/**
 * Sprite size in device pixels for a ball of `radiusPx` CSS pixels: its
 * diameter at the device ratio plus a pixel each side for antialiasing,
 * rounded up so the edge is never clipped.
 */
export function spriteSizePx(radiusPx: number, dpr: number): number {
  return Math.ceil(2 * radiusPx * dpr) + 2;
}

interface Sprite {
  readonly canvas: HTMLCanvasElement;
  readonly key: string;
}

let sprite: Sprite | null = null;

/** The ball sprite for this radius and device ratio, redrawn only when either changes (a resize, a zoom). */
function ballSprite(radiusPx: number, dpr: number): HTMLCanvasElement {
  const key = `${radiusPx}@${dpr}`;
  if (sprite?.key === key) return sprite.canvas;
  const size = spriteSizePx(radiusPx, dpr);
  const canvas = sprite?.canvas ?? document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const r = radiusPx * dpr;
  const c = size / 2;
  const lx = c + LIGHT.x * r;
  const ly = c + LIGHT.y * r;
  ctx.clearRect(0, 0, size, size);

  const shade = ctx.createRadialGradient(lx, ly, 0, lx, ly, r * 1.45);
  for (const [at, colour] of STEEL) shade.addColorStop(at, colour);
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, 2 * Math.PI);
  ctx.fill();

  // Bounce light, clipped to the ball.
  ctx.save();
  ctx.clip();
  const bounce = ctx.createRadialGradient(c - LIGHT.x * r, c - LIGHT.y * r, 0, c, c, r);
  bounce.addColorStop(0, BOUNCE);
  bounce.addColorStop(0.6, 'rgb(120 200 150 / 0)');
  ctx.fillStyle = bounce;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // Hard highlight: a solid core with a short soft edge.
  const sr = Math.max(0.75, SPECULAR_RADIUS * r);
  const spot = ctx.createRadialGradient(lx, ly, 0, lx, ly, sr);
  spot.addColorStop(0, SPECULAR);
  spot.addColorStop(0.55, SPECULAR);
  spot.addColorStop(1, 'rgb(255 255 255 / 0)');
  ctx.fillStyle = spot;
  ctx.beginPath();
  ctx.arc(lx, ly, sr, 0, 2 * Math.PI);
  ctx.fill();

  sprite = { canvas, key };
  return canvas;
}

export function drawBalls(
  view: CanvasView,
  bv: BoardView,
  balls: readonly Readonly<Ball>[],
  alpha: number,
): void {
  if (balls.length === 0) return;
  const { ctx } = view;
  const r = Math.max(1.5, BALL_RADIUS_M * bv.scale);
  // The view's transform is CSS to device pixels; its x scale is the device ratio.
  const dpr = ctx.getTransform().a || 1;
  const image = ballSprite(r, dpr);
  const half = image.width / dpr / 2;
  const size = image.width / dpr;
  for (const ball of balls) {
    const p = interpolate(ball, alpha);
    ctx.drawImage(image, bv.ox + p.x * bv.scale - half, bv.oy - p.y * bv.scale - half, size, size);
  }
}
