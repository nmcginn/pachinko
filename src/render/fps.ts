// Frame-rate and steps-per-frame meter for the debug overlay. Pure: it is fed
// frame durations and step counts, and never reads a clock itself.

export interface FrameStats {
  fps: number;
  stepsPerFrame: number;
}

export interface FpsMeter {
  /** Record one frame. Returns fresh stats when a window completes, else null. */
  sample(frameDtS: number, steps: number): FrameStats | null;
}

/** Averages over windows of at least `windowS` seconds of wall time. */
export function createFpsMeter(windowS = 0.5): FpsMeter {
  if (!(windowS > 0)) throw new RangeError(`windowS must be positive, got ${windowS}`);
  let elapsedS = 0;
  let frames = 0;
  let steps = 0;

  return {
    sample(frameDtS, frameSteps) {
      // A zero-length frame (first frame after resume) has no rate to measure.
      if (!(frameDtS > 0)) return null;
      elapsedS += frameDtS;
      frames += 1;
      steps += frameSteps;
      // Tolerance so 30 frames of 1/60 s close a 0.5 s window despite float rounding.
      if (elapsedS < windowS - 1e-9) return null;
      const stats = { fps: frames / elapsedS, stepsPerFrame: steps / frames };
      elapsedS = 0;
      frames = 0;
      steps = 0;
      return stats;
    },
  };
}
