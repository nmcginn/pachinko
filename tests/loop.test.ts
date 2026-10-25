import { describe, expect, it } from 'vitest';
import {
  advanceClock,
  bindVisibility,
  createClock,
  createLoop,
  type FrameHost,
  type FrameInfo,
  type VisibilitySource,
} from '../src/loop';

const STEP_S = 1 / 2000;

describe('advanceClock', () => {
  it('takes no steps for a zero-length frame', () => {
    const clock = createClock(STEP_S, 0.1);
    expect(advanceClock(clock, 0)).toEqual({ steps: 0, alpha: 0, droppedS: 0 });
  });

  it('takes whole steps and carries the remainder', () => {
    const clock = createClock(STEP_S, 0.1);
    const r = advanceClock(clock, 2.5 * STEP_S);
    expect(r.steps).toBe(2);
    expect(r.alpha).toBeCloseTo(0.5, 9);
    // The carried half step completes on the next half-step frame.
    expect(advanceClock(clock, 0.5 * STEP_S).steps).toBe(1);
  });

  it('accumulates frames shorter than one step', () => {
    const clock = createClock(STEP_S, 0.1);
    let steps = 0;
    for (let i = 0; i < 10; i++) steps += advanceClock(clock, STEP_S / 10).steps;
    // Ten tenths make one step, give or take float rounding on the last one.
    expect(steps).toBeGreaterThanOrEqual(0);
    expect(steps).toBeLessThanOrEqual(1);
    expect(steps + advanceClock(clock, STEP_S / 10).steps).toBe(1);
  });

  it('runs 2000 steps per second of wall time at 60 Hz without drift', () => {
    const clock = createClock(STEP_S, 0.1);
    let steps = 0;
    for (let i = 0; i < 60 * 60; i++) steps += advanceClock(clock, 1 / 60).steps;
    // One simulated minute: 120 000 steps, off by at most one to float rounding.
    expect(Math.abs(steps - 120_000)).toBeLessThanOrEqual(1);
  });

  it('keeps alpha in [0, 1) across uneven frames', () => {
    const clock = createClock(STEP_S, 0.1);
    const frames = [0.0167, 0.0333, 0.0001, 0.0083, 0.05, 1e-7, 0.016];
    for (const dt of frames) {
      const { alpha } = advanceClock(clock, dt);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('caps a long frame at maxFrameS and reports what it dropped', () => {
    const clock = createClock(STEP_S, 0.1);
    const r = advanceClock(clock, 5);
    expect(r.steps).toBe(200);
    expect(r.droppedS).toBeCloseTo(4.9, 9);
  });

  it('treats negative, NaN and infinite frame times as zero', () => {
    for (const dt of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const clock = createClock(STEP_S, 0.1);
      expect(advanceClock(clock, dt)).toEqual({ steps: 0, alpha: 0, droppedS: 0 });
    }
  });

  it('rejects a non-positive step and a cap shorter than a step', () => {
    expect(() => createClock(0, 0.1)).toThrow(RangeError);
    expect(() => createClock(-STEP_S, 0.1)).toThrow(RangeError);
    expect(() => createClock(Number.NaN, 0.1)).toThrow(RangeError);
    expect(() => createClock(STEP_S, STEP_S / 2)).toThrow(RangeError);
  });

  it('is deterministic: the same frame sequence gives the same steps', () => {
    const frames = Array.from({ length: 500 }, (_, i) => 0.01 + ((i * 7919) % 13) / 1000);
    const run = () => {
      const clock = createClock(STEP_S, 0.1);
      return frames.map((dt) => advanceClock(clock, dt).steps);
    };
    expect(run()).toEqual(run());
  });
});

/** A requestAnimationFrame stand-in driven by the test. */
function fakeHost() {
  let next = 1;
  const pending = new Map<number, (nowMs: number) => void>();
  const host: FrameHost = {
    requestFrame(cb) {
      const id = next++;
      pending.set(id, cb);
      return id;
    },
    cancelFrame(id) {
      pending.delete(id);
    },
  };
  return {
    host,
    get pending() {
      return pending.size;
    },
    /** Fire every pending callback at time nowMs, as a browser frame would. */
    frame(nowMs: number) {
      const cbs = [...pending.values()];
      pending.clear();
      for (const cb of cbs) cb(nowMs);
    },
  };
}

function recordingLoop() {
  const raf = fakeHost();
  const frames: FrameInfo[] = [];
  let steps = 0;
  const loop = createLoop(raf.host, createClock(STEP_S, 0.1), {
    step: () => void steps++,
    render: (f) => void frames.push(f),
  });
  return {
    raf,
    loop,
    frames,
    get steps() {
      return steps;
    },
  };
}

describe('createLoop', () => {
  it('does nothing until started', () => {
    const t = recordingLoop();
    expect(t.loop.running).toBe(false);
    expect(t.raf.pending).toBe(0);
  });

  it('uses the first frame as a time base, then steps by elapsed time', () => {
    const t = recordingLoop();
    t.loop.start();
    t.raf.frame(1000);
    expect(t.steps).toBe(0);
    expect(t.frames[0]).toMatchObject({ frameDtS: 0, steps: 0 });

    t.raf.frame(1010); // 10 ms = 20 steps
    expect(t.steps).toBe(20);
    expect(t.frames[1]?.steps).toBe(20);
    expect(t.frames[1]?.frameDtS).toBeCloseTo(0.01, 12);
  });

  it('renders once per frame even when no step fits', () => {
    const t = recordingLoop();
    t.loop.start();
    t.raf.frame(0);
    t.raf.frame(0.1); // 0.1 ms, a fifth of a step
    expect(t.frames).toHaveLength(2);
    expect(t.steps).toBe(0);
  });

  it('start() twice does not double-schedule', () => {
    const t = recordingLoop();
    t.loop.start();
    t.loop.start();
    expect(t.raf.pending).toBe(1);
  });

  it('stop() cancels the pending frame and stepping halts', () => {
    const t = recordingLoop();
    t.loop.start();
    t.raf.frame(0);
    t.raf.frame(10);
    t.loop.stop();
    expect(t.loop.running).toBe(false);
    expect(t.raf.pending).toBe(0);
    const before = t.steps;
    t.raf.frame(5000);
    expect(t.steps).toBe(before);
  });

  it('does not catch up on time spent stopped', () => {
    const t = recordingLoop();
    t.loop.start();
    t.raf.frame(0);
    t.raf.frame(10);
    t.loop.stop();
    t.loop.start();
    t.raf.frame(60_000); // a minute later: re-establishes the time base
    expect(t.steps).toBe(20);
    t.raf.frame(60_010);
    expect(t.steps).toBe(40);
  });

  it('can be stopped from inside render without scheduling another frame', () => {
    const raf = fakeHost();
    const loop = createLoop(raf.host, createClock(STEP_S, 0.1), {
      step: () => {},
      render: () => loop.stop(),
    });
    loop.start();
    raf.frame(0);
    expect(loop.running).toBe(false);
    expect(raf.pending).toBe(0);
  });
});

describe('createLoop work timing', () => {
  /** A loop whose host clock the steps and render advance: 0.01 ms a step, 2 ms a render. */
  function timedLoop(withNow = true) {
    const raf = fakeHost();
    let clockMs = 0;
    const host: FrameHost = withNow ? { ...raf.host, now: () => clockMs } : raf.host;
    const measured: [number, FrameInfo][] = [];
    const loop = createLoop(host, createClock(STEP_S, 0.1), {
      step: () => void (clockMs += 0.01),
      render: () => void (clockMs += 2),
      measured: (workMs, frame) => void measured.push([workMs, frame]),
    });
    return { raf, loop, measured };
  }

  it("reports each frame's steps plus render, after render", () => {
    const t = timedLoop();
    t.loop.start();
    t.raf.frame(0);
    t.raf.frame(10); // 20 steps
    expect(t.measured).toHaveLength(2);
    expect(t.measured[0]?.[0]).toBeCloseTo(2, 9);
    expect(t.measured[1]?.[0]).toBeCloseTo(20 * 0.01 + 2, 9);
    expect(t.measured[1]?.[1]).toMatchObject({ steps: 20 });
  });

  it('times the work, not the gap since the last frame', () => {
    const t = timedLoop();
    t.loop.start();
    t.raf.frame(0);
    t.raf.frame(100); // a long gap: capped at 0.1 s, 200 steps
    expect(t.measured[1]?.[0]).toBeCloseTo(200 * 0.01 + 2, 9);
  });

  it('reports nothing when the host has no clock', () => {
    const t = timedLoop(false);
    t.loop.start();
    t.raf.frame(0);
    t.raf.frame(10);
    expect(t.measured).toEqual([]);
  });
});

function fakeDocument(hidden: boolean) {
  const listeners = new Set<() => void>();
  const doc: VisibilitySource & { hidden: boolean } = {
    hidden,
    addEventListener: (_type, l) => void listeners.add(l),
    removeEventListener: (_type, l) => void listeners.delete(l),
  };
  return {
    doc,
    listeners,
    set(nextHidden: boolean) {
      doc.hidden = nextHidden;
      for (const l of listeners) l();
    },
  };
}

describe('bindVisibility', () => {
  it('starts immediately when the page is visible', () => {
    const t = recordingLoop();
    bindVisibility(t.loop, fakeDocument(false).doc);
    expect(t.loop.running).toBe(true);
  });

  it('stays stopped when the page loads hidden', () => {
    const t = recordingLoop();
    bindVisibility(t.loop, fakeDocument(true).doc);
    expect(t.loop.running).toBe(false);
    expect(t.raf.pending).toBe(0);
  });

  it('pauses while hidden and resumes without a catch-up burst', () => {
    const t = recordingLoop();
    const d = fakeDocument(false);
    bindVisibility(t.loop, d.doc);
    t.raf.frame(0);
    t.raf.frame(10);
    expect(t.steps).toBe(20);

    d.set(true);
    expect(t.loop.running).toBe(false);
    t.raf.frame(30_000);
    expect(t.steps).toBe(20);

    d.set(false);
    t.raf.frame(30_000);
    t.raf.frame(30_010);
    expect(t.steps).toBe(40);
  });

  it('unbinding stops following visibility changes', () => {
    const t = recordingLoop();
    const d = fakeDocument(false);
    const unbind = bindVisibility(t.loop, d.doc);
    unbind();
    expect(d.listeners.size).toBe(0);
    d.set(true);
    expect(t.loop.running).toBe(true);
  });
});
