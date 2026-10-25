// Frame work-time meter for the debug overlay and M6's frame-time check:
// how long each frame's sim steps and drawing took, over the last few
// seconds of frames, with how many balls were in play. Pure: it is fed the
// timings and never reads a clock itself.

export interface FrameTimeStats {
  /** Frames in the window: windowFrames once it has filled. */
  frames: number;
  meanMs: number;
  /** 95th percentile, nearest rank: no more than 5% of frames took longer. */
  p95Ms: number;
  maxMs: number;
  /** Fewest balls in play in any frame of the window. */
  minBalls: number;
  meanBalls: number;
}

export interface FrameTimeMeter {
  /** Record one frame's work time in ms and the balls in play. Invalid times are ignored. */
  sample(workMs: number, balls: number): void;
  /** Stats over the last windowFrames frames, or null before the first. */
  stats(): FrameTimeStats | null;
}

/** About 2 s at 60 Hz. */
export const FRAME_TIME_WINDOW = 120;

export function createFrameTimeMeter(windowFrames = FRAME_TIME_WINDOW): FrameTimeMeter {
  if (!(Number.isInteger(windowFrames) && windowFrames > 0)) {
    throw new RangeError(`windowFrames must be a whole number > 0, got ${windowFrames}`);
  }
  // Ring buffers: the oldest frame is overwritten once the window is full.
  const times = new Float64Array(windowFrames);
  const balls = new Float64Array(windowFrames);
  let next = 0;
  let count = 0;

  return {
    sample(workMs, inPlay) {
      if (!(Number.isFinite(workMs) && workMs >= 0)) return;
      times[next] = workMs;
      balls[next] = inPlay;
      next = (next + 1) % windowFrames;
      count = Math.min(count + 1, windowFrames);
    },
    stats() {
      if (count === 0) return null;
      const t = times.slice(0, count).sort();
      const b = balls.subarray(0, count);
      let sumMs = 0;
      let sumBalls = 0;
      let minBalls = Infinity;
      for (let i = 0; i < count; i++) {
        sumMs += t[i] ?? 0;
        sumBalls += b[i] ?? 0;
        minBalls = Math.min(minBalls, b[i] ?? 0);
      }
      return {
        frames: count,
        meanMs: sumMs / count,
        p95Ms: t[Math.ceil(0.95 * count) - 1] ?? 0,
        maxMs: t[count - 1] ?? 0,
        minBalls,
        meanBalls: sumBalls / count,
      };
    },
  };
}
