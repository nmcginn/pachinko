// A test board with a tulip: the classic board with one tulip on the left of
// the field, about level with the start pocket, and the nails that would
// overlap it or crowd its wings taken out. Only for tests and measurements.
// Where tulips go on the classic board, and what they pay, are the
// maintainer's to decide (PLAN.md Status); classic.json has none.

import { readFileSync } from 'node:fs';

/** The tulip's centre line. */
export const TULIP_X_M = 0.15;
/** Top of its cup walls, where the wings are hinged. */
export const TULIP_MOUTH_Y_M = 0.17;
/** Half the cup's inside width, as the start cup: 17 mm inside for an 11 mm ball. */
const CUP_HALF_WIDTH_M = 0.0085;
const CUP_DEPTH_M = 0.018;
/** Closed, the wing tips lean in to leave a 12.5 mm gap, the same as the ヘソ nails'. */
const CLOSED_TIP_HALF_GAP_M = 0.00625;
const CLOSED_TIP_RISE_M = 0.012;
/** Open, the wings splay out to tips 38 mm apart. */
const OPEN_TIP_HALF_SPAN_M = 0.019;
const OPEN_TIP_RISE_M = 0.0105;
/** Nails closer than this to the centre line, between these heights, are taken out. */
const CLEAR_HALF_WIDTH_M = 0.03;
const CLEAR_BELOW_M = 0.03;
const CLEAR_ABOVE_M = 0.025;

type Point = [number, number];
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const pt = (x: number, y: number): Point => [r4(x), r4(y)];

/** The two wings for a tip at ±halfSpan, rise above the hinges. */
function wings(halfSpanM: number, riseM: number): Point[][] {
  const x = TULIP_X_M;
  const y = TULIP_MOUTH_Y_M;
  return [
    [pt(x - CUP_HALF_WIDTH_M, y), pt(x - halfSpanM, y + riseM)],
    [pt(x + CUP_HALF_WIDTH_M, y), pt(x + halfSpanM, y + riseM)],
  ];
}

/** Fresh board JSON, ready for parseBoard, so a test can edit it. */
export function tulipBoardData(): Record<string, unknown> {
  const data = JSON.parse(readFileSync('boards/classic.json', 'utf8')) as {
    name: string;
    nails: Point[];
    rails: { id: string; points: Point[] }[];
    pockets: Record<string, unknown>[];
  };
  const x = TULIP_X_M;
  const y = TULIP_MOUTH_Y_M;
  data.name = 'classic-with-tulip';
  data.nails = data.nails.filter(
    ([nx, ny]) =>
      !(Math.abs(nx - x) < CLEAR_HALF_WIDTH_M && ny > y - CLEAR_BELOW_M && ny < y + CLEAR_ABOVE_M),
  );
  data.rails.push({
    id: 'tulip-cup',
    points: [
      pt(x - CUP_HALF_WIDTH_M, y),
      pt(x - CUP_HALF_WIDTH_M, y - CUP_DEPTH_M),
      pt(x + CUP_HALF_WIDTH_M, y - CUP_DEPTH_M),
      pt(x + CUP_HALF_WIDTH_M, y),
    ],
  });
  data.pockets.push({
    id: 'tulip',
    kind: 'tulip',
    // Inside the cup, below its rim, as the start pocket.
    polygon: [
      pt(x - CUP_HALF_WIDTH_M + 0.0005, y - 0.003),
      pt(x + CUP_HALF_WIDTH_M - 0.0005, y - 0.003),
      pt(x + CUP_HALF_WIDTH_M - 0.0005, y - CUP_DEPTH_M + 0.0005),
      pt(x - CUP_HALF_WIDTH_M + 0.0005, y - CUP_DEPTH_M + 0.0005),
    ],
    wings: {
      closed: wings(CLOSED_TIP_HALF_GAP_M, CLOSED_TIP_RISE_M),
      open: wings(OPEN_TIP_HALF_SPAN_M, OPEN_TIP_RISE_M),
    },
  });
  return data;
}
