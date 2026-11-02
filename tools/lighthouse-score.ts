// Pure helpers for tools/lighthouse.ts (M8: Lighthouse performance ≥ 90):
// reading one run's numbers out of a Lighthouse result, and judging a set
// of runs. Kept apart from the tool so they are unit-tested without a
// browser.

/** The parts of a Lighthouse result (LHR) this reads. */
export interface LhrLike {
  readonly categories: { readonly performance?: { readonly score: number | null } };
  readonly audits: Readonly<Record<string, { readonly numericValue?: number } | undefined>>;
  readonly runtimeError?: { readonly code: string; readonly message: string };
}

/** One run: the performance score out of 100, and the metrics behind it. */
export interface RunResult {
  readonly score: number;
  /** First and Largest Contentful Paint, Total Blocking Time, Speed Index: ms. */
  readonly fcpMs: number;
  readonly lcpMs: number;
  readonly tbtMs: number;
  readonly speedIndexMs: number;
  /** Cumulative Layout Shift, unitless. */
  readonly cls: number;
}

/** Lighthouse's metric audit ids, by RunResult field. */
const METRICS = {
  fcpMs: 'first-contentful-paint',
  lcpMs: 'largest-contentful-paint',
  tbtMs: 'total-blocking-time',
  speedIndexMs: 'speed-index',
  cls: 'cumulative-layout-shift',
} as const;

/** A run's numbers, or an Error saying why it has none (a page that failed to load, a missing metric). */
export function readRun(lhr: LhrLike): RunResult | Error {
  if (lhr.runtimeError) return new Error(`${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
  const score = lhr.categories.performance?.score;
  if (typeof score !== 'number' || !Number.isFinite(score))
    return new Error('no performance score in the result');
  const metrics: Record<string, number> = {};
  for (const [field, id] of Object.entries(METRICS)) {
    const value = lhr.audits[id]?.numericValue;
    if (typeof value !== 'number' || !Number.isFinite(value))
      return new Error(`no value for ${id} in the result`);
    metrics[field] = value;
  }
  return { score: Math.round(score * 100), ...(metrics as Omit<RunResult, 'score'>) };
}

/** The median of a non-empty list: the middle value, or the mean of the two middle ones. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('median of no values');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? NaN;
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] ?? NaN) + hi) / 2;
}

export interface Verdict {
  readonly pass: boolean;
  /** The median score over the runs, the number judged. */
  readonly medianScore: number;
  readonly minScore: number;
  readonly maxScore: number;
}

/**
 * Judge a set of runs against `threshold` (out of 100). The median is
 * judged, not the worst run, as Lighthouse's own guidance on variance
 * advises: one run on a busy machine can lose several points to noise.
 */
export function judge(runs: readonly RunResult[], threshold: number): Verdict {
  if (runs.length === 0) throw new RangeError('no runs to judge');
  const scores = runs.map((r) => r.score);
  const medianScore = median(scores);
  return {
    pass: medianScore >= threshold,
    medianScore,
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
  };
}

/** One line for a run: score and metrics, rounded for reading. */
export function formatRun(i: number, r: RunResult): string {
  return (
    `run ${i}: ${String(r.score).padStart(3)}  ` +
    `FCP ${Math.round(r.fcpMs)} ms  LCP ${Math.round(r.lcpMs)} ms  ` +
    `TBT ${Math.round(r.tbtMs)} ms  SI ${Math.round(r.speedIndexMs)} ms  CLS ${r.cls.toFixed(3)}`
  );
}
