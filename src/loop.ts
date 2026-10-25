// Fixed-timestep frame loop.
//
// The display runs at whatever rate the browser gives us; the sim always
// advances in exact SIM_STEP_S increments. Each frame we add the elapsed wall
// time to an accumulator, take as many whole steps as fit, and hand the
// leftover fraction (alpha) to the renderer so it can interpolate.
//
// Nothing here touches the DOM directly: the host (requestAnimationFrame, the
// document's visibility) is injected, so the logic is unit-testable under Node.

export interface FixedStepClock {
  readonly stepS: number;
  /** Longest frame we will simulate. Anything beyond is dropped, not caught up. */
  readonly maxFrameS: number;
  accumulatorS: number;
}

export interface ClockAdvance {
  /** Whole sim steps to run this frame. */
  steps: number;
  /** Leftover fraction of a step, in [0, 1). Use it to interpolate rendering. */
  alpha: number;
  /** Wall time discarded because the frame was longer than maxFrameS. */
  droppedS: number;
}

export function createClock(stepS: number, maxFrameS: number): FixedStepClock {
  if (!(stepS > 0)) throw new RangeError(`stepS must be positive, got ${stepS}`);
  if (!(maxFrameS >= stepS)) {
    throw new RangeError(`maxFrameS (${maxFrameS}) must be at least stepS (${stepS})`);
  }
  return { stepS, maxFrameS, accumulatorS: 0 };
}

/**
 * Feed one frame's wall time into the clock. Negative or non-finite input
 * (clock skew, a bogus timestamp) counts as zero rather than running the sim
 * backwards or forever.
 */
export function advanceClock(clock: FixedStepClock, frameDtS: number): ClockAdvance {
  const dtS = Number.isFinite(frameDtS) && frameDtS > 0 ? frameDtS : 0;
  const usedS = Math.min(dtS, clock.maxFrameS);
  const droppedS = dtS - usedS;

  clock.accumulatorS += usedS;
  // floor() on the ratio rather than a subtract-in-a-loop: one division, and
  // the step count can't drift from repeated float subtraction.
  const steps = Math.floor(clock.accumulatorS / clock.stepS);
  clock.accumulatorS -= steps * clock.stepS;
  // Guard the float edge where the remainder lands a hair outside [0, stepS).
  if (clock.accumulatorS < 0) clock.accumulatorS = 0;
  const alpha = Math.min(clock.accumulatorS / clock.stepS, 1 - Number.EPSILON);

  return { steps, alpha, droppedS };
}

export interface FrameHost {
  requestFrame(callback: (nowMs: number) => void): number;
  cancelFrame(handle: number): void;
  /** A clock in ms (performance.now). Needed only for LoopCallbacks.measured. */
  now?(): number;
}

export interface FrameInfo {
  /** Wall time since the previous frame, in seconds. Zero on the first frame after (re)start. */
  frameDtS: number;
  steps: number;
  alpha: number;
  droppedS: number;
}

export interface LoopCallbacks {
  /** Advance the sim by exactly one fixed step. */
  step(): void;
  /** Draw the current state. Must not advance the sim. */
  render(frame: FrameInfo): void;
  /**
   * After render, with the frame's work time: this frame's steps and its
   * render, by the host's `now`, in ms. Called only when the host has one.
   */
  measured?(workMs: number, frame: FrameInfo): void;
}

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export function createLoop(host: FrameHost, clock: FixedStepClock, callbacks: LoopCallbacks): Loop {
  let running = false;
  let handle: number | null = null;
  let lastMs: number | null = null;

  const tick = (nowMs: number): void => {
    handle = null;
    if (!running) return;
    // The first frame after a (re)start only sets the time base. Without this,
    // coming back to a hidden tab would try to simulate the whole absence.
    const frameDtS = lastMs === null ? 0 : (nowMs - lastMs) / 1000;
    lastMs = nowMs;

    // The rAF timestamp is the frame's start, not when this callback runs,
    // so work time takes its own reading before and after.
    const startMs = host.now?.();
    const { steps, alpha, droppedS } = advanceClock(clock, frameDtS);
    for (let i = 0; i < steps; i++) callbacks.step();
    const frame = { frameDtS, steps, alpha, droppedS };
    callbacks.render(frame);
    if (startMs !== undefined && host.now && callbacks.measured) {
      callbacks.measured(host.now() - startMs, frame);
    }

    if (running) handle = host.requestFrame(tick);
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastMs = null;
      handle = host.requestFrame(tick);
    },
    stop() {
      if (!running) return;
      running = false;
      lastMs = null;
      if (handle !== null) host.cancelFrame(handle);
      handle = null;
    },
    get running() {
      return running;
    },
  };
}

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Run the loop only while the page is visible. Applies the current state
 * immediately, then follows visibilitychange. Returns an unbind function.
 */
export function bindVisibility(loop: Loop, source: VisibilitySource): () => void {
  const sync = (): void => {
    if (source.hidden) loop.stop();
    else loop.start();
  };
  sync();
  source.addEventListener('visibilitychange', sync);
  return () => source.removeEventListener('visibilitychange', sync);
}
