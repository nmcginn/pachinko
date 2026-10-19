// Generates boards/classic.json, the default board, from a few design
// parameters. It wrote the first version of the board (M2). From then on the
// JSON is the source of truth: nail-adjust mode (M7) and any tuning edit the
// JSON directly, and rerunning this would overwrite those edits. Kept so the
// geometry's design intent stays reviewable.
//
//   npx tsx tools/gen-classic-board.ts > boards/classic.json
//
// Layout (metres, origin bottom-left, y up). The playfield is a circle,
// bounded by the outer guide rail. The launch lane runs up the left side
// between the outer rail and an inner rail, 17 mm apart, and the inner rail
// stops at about 11 o'clock: a ball shot up the lane follows the outer rail
// over the top and drops into the nail field. The floor slopes to the
// out-hole at the bottom centre; the start pocket (ヘソ) is a cup above it,
// flanked by the two ヘソ nails.

const W = 0.5;
const H = 0.53;
const CX = 0.25;
const CY = 0.27;
/** Outer guide rail. */
const R_OUTER = 0.235;
/** Inner rail: the field side of the launch lane. Lane is 17 mm wide; the ball is 11 mm. */
const R_INNER = R_OUTER - 0.017;
/** Ball centre line in the lane. */
const R_LANE = (R_OUTER + R_INNER) / 2;

/** Outer rail runs from the lane bottom, clockwise over the top, down the right side. */
const OUTER_FROM_DEG = 240;
const OUTER_TO_DEG = -60;
/**
 * Return bumper (戻りゴム): a short rail from the outer rail into the field
 * at about 2 o'clock. A shot strong enough to stay on the outer rail past
 * the top hits it and bounces back into the field, instead of running round
 * the rim to the floor. Its root is an outer-rail vertex, so no gap.
 */
const RETURN_ROOT_DEG = 27.5;
const RETURN_TIP_DEG = 20;
const RETURN_TIP_R = 0.208;
/** Inner rail runs from the lane bottom up to here, where balls enter the field. */
const INNER_TO_DEG = 125;
/** Arcs are polylines with a vertex every this many degrees. */
const ARC_STEP_DEG = 2.5;

const LAUNCH_DEG = 232;
/** Foul pocket: the bottom of the lane, below the launch point. */
const FOUL_FROM_DEG = 235;

const OUT_HALF_WIDTH = 0.02;
const OUT_Y = 0.04;

const START_X = CX;
const START_TOP_Y = 0.168;
const START_BOTTOM_Y = 0.15;
/** Half the cup's inside width. 17 mm inside, so a ball has 6 mm of play. */
const CUP_HALF_WIDTH = 0.0085;
/** ヘソ nails: 14.5 mm apart centre to centre, a 12.5 mm gap for an 11 mm ball. */
const HESO_HALF_SPACING = 0.00725;
const HESO_Y = 0.178;

/** Nail field: staggered rows. */
const ROW_PITCH = 0.019;
const COL_PITCH = 0.028;
const FIELD_TOP_Y = 0.445;
const FIELD_BOTTOM_Y = 0.11;
/** Nails stay inside this radius, clear of both rails by more than a ball. */
const FIELD_RADIUS = 0.2;

const round = (v: number) => Math.round(v * 1e4) / 1e4;
const pt = (x: number, y: number): [number, number] => [round(x), round(y)];
const polar = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return pt(CX + r * Math.cos(a), CY + r * Math.sin(a));
};

function arc(r: number, fromDeg: number, toDeg: number): [number, number][] {
  const n = Math.ceil(Math.abs(toDeg - fromDeg) / ARC_STEP_DEG);
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) out.push(polar(r, fromDeg + ((toDeg - fromDeg) * i) / n));
  return out;
}

const outer = arc(R_OUTER, OUTER_FROM_DEG, OUTER_TO_DEG);
const inner = arc(R_INNER, OUTER_FROM_DEG, INNER_TO_DEG);
const innerBottom = inner[0] as [number, number];
const outerBottom = outer[0] as [number, number];
const outerRightEnd = outer[outer.length - 1] as [number, number];

const rails = [
  { id: 'outer', points: outer },
  { id: 'inner', points: inner },
  { id: 'return', points: [polar(R_OUTER, RETURN_ROOT_DEG), polar(RETURN_TIP_R, RETURN_TIP_DEG)] },
  // Closes the bottom of the launch lane, under the foul pocket.
  { id: 'lane-stop', points: [innerBottom, outerBottom] },
  { id: 'floor-left', points: [innerBottom, pt(CX - OUT_HALF_WIDTH, OUT_Y)] },
  { id: 'floor-right', points: [outerRightEnd, pt(CX + OUT_HALF_WIDTH, OUT_Y)] },
  {
    id: 'start-cup',
    points: [
      pt(START_X - CUP_HALF_WIDTH, START_TOP_Y),
      pt(START_X - CUP_HALF_WIDTH, START_BOTTOM_Y),
      pt(START_X + CUP_HALF_WIDTH, START_BOTTOM_Y),
      pt(START_X + CUP_HALF_WIDTH, START_TOP_Y),
    ],
  },
];

const pockets = [
  {
    id: 'start',
    kind: 'start',
    // Inside the cup, below its rim. A ball's centre can only get here between the walls.
    polygon: [
      pt(START_X - CUP_HALF_WIDTH + 0.0005, START_TOP_Y - 0.003),
      pt(START_X + CUP_HALF_WIDTH - 0.0005, START_TOP_Y - 0.003),
      pt(START_X + CUP_HALF_WIDTH - 0.0005, START_BOTTOM_Y + 0.0005),
      pt(START_X - CUP_HALF_WIDTH + 0.0005, START_BOTTOM_Y + 0.0005),
    ],
  },
  {
    id: 'out',
    kind: 'out',
    polygon: [
      pt(CX - OUT_HALF_WIDTH, OUT_Y),
      pt(CX + OUT_HALF_WIDTH, OUT_Y),
      pt(CX + OUT_HALF_WIDTH, 0.005),
      pt(CX - OUT_HALF_WIDTH, 0.005),
    ],
  },
  {
    id: 'foul',
    kind: 'foul',
    // Annular sector across the lane, just above the lane stop.
    polygon: [
      polar(R_INNER + 0.0005, FOUL_FROM_DEG),
      polar(R_OUTER - 0.0005, FOUL_FROM_DEG),
      polar(R_OUTER - 0.0005, OUTER_FROM_DEG - 0.5),
      polar(R_INNER + 0.0005, OUTER_FROM_DEG - 0.5),
    ],
  },
];

/** Height of the floor rails at x, so nails stay clear of them. */
function floorY(x: number): number {
  const [lx, ly] = innerBottom;
  const [rx, ry] = outerRightEnd;
  if (x < CX) return ly + ((OUT_Y - ly) * (x - lx)) / (CX - OUT_HALF_WIDTH - lx);
  return ry + ((OUT_Y - ry) * (rx - x)) / (rx - CX - OUT_HALF_WIDTH);
}

const nails: [number, number][] = [
  pt(CX - HESO_HALF_SPACING, HESO_Y),
  pt(CX + HESO_HALF_SPACING, HESO_Y),
];
for (let row = 0; ; row++) {
  const y = FIELD_TOP_Y - row * ROW_PITCH;
  if (y < FIELD_BOTTOM_Y) break;
  // Rows are centred on the board, alternate rows offset by half a pitch.
  const offset = (row % 2) * (COL_PITCH / 2);
  for (let k = -10; k <= 10; k++) {
    const x = CX + k * COL_PITCH + offset;
    if (Math.hypot(x - CX, y - CY) > FIELD_RADIUS) continue;
    if (y < floorY(x) + 0.025) continue;
    // Keep the start pocket and its approach clear except for the ヘソ nails.
    if (Math.abs(x - START_X) < 0.03 && y > START_BOTTOM_Y - 0.02 && y < HESO_Y + 0.02) continue;
    nails.push(pt(x, y));
  }
}

const launcherAt = polar(R_LANE, LAUNCH_DEG);
const board = {
  name: 'classic',
  widthM: W,
  heightM: H,
  nails,
  rails,
  pockets,
  launcher: {
    x: launcherAt[0],
    y: launcherAt[1],
    // Tangent to the lane, heading clockwise (up the left side).
    angleDeg: LAUNCH_DEG - 90,
    minSpeedMps: 3.2,
  },
};

process.stdout.write(JSON.stringify(board) + '\n');
