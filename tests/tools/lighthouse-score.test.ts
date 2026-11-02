// tools/lighthouse-score.ts: reading a Lighthouse result and judging the
// runs against M8's performance threshold.

import { describe, expect, it } from 'vitest';
import {
  type LhrLike,
  type RunResult,
  formatRun,
  judge,
  median,
  readRun,
} from '../../tools/lighthouse-score';

function lhr(score: number | null, over: Partial<Record<string, number>> = {}): LhrLike {
  const values: Record<string, number> = {
    'first-contentful-paint': 800,
    'largest-contentful-paint': 900,
    'total-blocking-time': 50,
    'speed-index': 1000,
    'cumulative-layout-shift': 0.01,
    ...over,
  };
  return {
    categories: { performance: { score } },
    audits: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { numericValue: v }])),
  };
}

const run = (score: number): RunResult => ({
  score,
  fcpMs: 800,
  lcpMs: 900,
  tbtMs: 50,
  speedIndexMs: 1000,
  cls: 0,
});

describe('readRun', () => {
  it('reads the score out of 100 and the metrics', () => {
    expect(readRun(lhr(0.92))).toEqual({
      score: 92,
      fcpMs: 800,
      lcpMs: 900,
      tbtMs: 50,
      speedIndexMs: 1000,
      cls: 0.01,
    });
  });

  it('rounds the score to a whole number, as Lighthouse shows it', () => {
    expect(readRun(lhr(0.895))).toMatchObject({ score: 90 });
    expect(readRun(lhr(0.894))).toMatchObject({ score: 89 });
  });

  it('reads a zero score and zero metrics as numbers, not missing', () => {
    expect(readRun(lhr(0, { 'total-blocking-time': 0 }))).toMatchObject({ score: 0, tbtMs: 0 });
  });

  it('is an error for a run with no score (the page failed)', () => {
    expect(readRun(lhr(null))).toBeInstanceOf(Error);
    expect(readRun({ categories: {}, audits: {} })).toBeInstanceOf(Error);
  });

  it('is an error for a missing or non-numeric metric', () => {
    const missing: LhrLike = { ...lhr(0.9), audits: { ...lhr(0.9).audits, 'speed-index': {} } };
    expect(String(readRun(missing))).toContain('speed-index');
    expect(readRun(lhr(0.9, { 'total-blocking-time': NaN }))).toBeInstanceOf(Error);
  });

  it('passes on Lighthouse’s runtime error', () => {
    const r = readRun({ ...lhr(0.9), runtimeError: { code: 'NO_FCP', message: 'no paint' } });
    expect(String(r)).toContain('NO_FCP');
  });
});

describe('median', () => {
  it('is the middle value of an odd count, in any order', () => {
    expect(median([95, 80, 100])).toBe(95);
    expect(median([7])).toBe(7);
  });

  it('is the mean of the two middle values of an even count', () => {
    expect(median([88, 92, 100, 70])).toBe(90);
  });

  it('does not reorder its input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });

  it('throws for no values', () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('judge', () => {
  it('passes at the threshold exactly, and fails one under', () => {
    expect(judge([run(90)], 90).pass).toBe(true);
    expect(judge([run(89)], 90).pass).toBe(false);
  });

  it('judges the median, so one noisy run does not decide it', () => {
    const v = judge([run(99), run(72), run(97)], 90);
    expect(v).toEqual({ pass: true, medianScore: 97, minScore: 72, maxScore: 99 });
    expect(judge([run(91), run(85), run(88)], 90).pass).toBe(false);
  });

  it('throws for no runs', () => {
    expect(() => judge([], 90)).toThrow(RangeError);
  });
});

describe('formatRun', () => {
  it('prints the score and rounded metrics on one line', () => {
    expect(formatRun(2, { ...run(93), tbtMs: 123.6, cls: 0.0123 })).toBe(
      'run 2:  93  FCP 800 ms  LCP 900 ms  TBT 124 ms  SI 1000 ms  CLS 0.012',
    );
  });
});
