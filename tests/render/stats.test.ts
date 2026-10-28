import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type StatsJob,
  createLiveStats,
  finishJob,
  measure,
  nextJob,
} from '../../src/game/livestats';
import { createTally } from '../../src/game/montecarlo';
import { createStatsPanel, describeStats } from '../../src/render/stats';
import { moveNail, parseBoard } from '../../src/sim/board';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
const nudged = moveNail(classic, 1, { x: 0.2574, y: 0.178 });

/** Answer the next job with `starts` start-pocket entries out of its balls. */
function answer(stats: ReturnType<typeof createLiveStats>, starts: number): StatsJob {
  const job = nextJob(stats) as StatsJob;
  const tally = createTally();
  tally.launched = job.count;
  tally.entries.start = starts;
  tally.entries.out = job.count - starts;
  finishJob(stats, { key: job.key, first: job.first, tally });
  return job;
}

describe('describeStats', () => {
  it('says it is measuring before the first batch', () => {
    const stats = createLiveStats();
    measure(stats, nudged, classic, 0.2);
    const v = describeStats(stats, 0.2);
    expect(v.title).toBe('Spins per ¥1000 at 20% power');
    expect(v.current.text).toBe('This board: measuring…');
    expect(v.baseline?.text).toBe('As loaded: measuring…');
    expect(v.change).toBeNull();
    expect(v.balls).toBe(0);
    expect(v.error).toBeNull();
  });

  it('gives each board its spins, standard error, start rate and balls, and the change', () => {
    const stats = createLiveStats();
    measure(stats, nudged, classic, 0.2);
    answer(stats, 116); // This board: 11.6% of 1000.
    let v = describeStats(stats, 0.2);
    expect(v.current.text).toBe('This board: 29.0 ± 2.5 (start 11.6%, 1,000 balls)');
    expect(v.change).toBeNull();
    answer(stats, 88);
    v = describeStats(stats, 0.2);
    expect(v.baseline?.text).toBe('As loaded: 22.0 ± 2.2 (start 8.8%, 1,000 balls)');
    expect(v.change).toBe('Change: +7.0');
    expect(v.balls).toBe(1000);
    expect(v.baselineBalls).toBe(1000);
  });

  it('shows one line for an unmoved board, and a fall as a minus', () => {
    const stats = createLiveStats();
    measure(stats, classic, classic, 0.5);
    answer(stats, 18);
    let v = describeStats(stats, 0.5);
    expect(v.title).toBe('Spins per ¥1000 at 50% power');
    expect(v.current.text).toBe('Board as loaded: 4.5 ± 1.1 (start 1.8%, 1,000 balls)');
    expect(v.baseline).toBeNull();
    expect(v.change).toBeNull();
    expect(v.baselineBalls).toBe(1000);

    measure(stats, nudged, classic, 0.5);
    answer(stats, 10);
    v = describeStats(stats, 0.5);
    expect(v.change).toBe('Change: −2.0');
  });

  it('says why the run stopped', () => {
    const stats = createLiveStats();
    measure(stats, classic, classic, 0.2);
    const job = nextJob(stats) as StatsJob;
    finishJob(stats, { key: job.key, first: job.first, error: 'boom' });
    expect(describeStats(stats, 0.2).error).toBe('Stats stopped: boom');
  });

  it('measures nothing outside edit mode', () => {
    const v = describeStats(createLiveStats(), 0.2);
    expect(v.current.text).toBe('Board as loaded: measuring…');
    expect(v.balls).toBe(0);
  });
});

describe('createStatsPanel', () => {
  const element = () => ({ hidden: false, textContent: '', dataset: {} as Record<string, string> });

  it('fills the lines, hides the empty ones, and mirrors the numbers in data-*', () => {
    const els = {
      root: element(),
      title: element(),
      current: element(),
      baseline: element(),
      change: element(),
      error: element(),
    };
    const panel = createStatsPanel(els as never);
    const stats = createLiveStats();
    measure(stats, classic, classic, 0.2);
    panel.update(stats, 0.2);
    expect(els.title.textContent).toBe('Spins per ¥1000 at 20% power');
    expect(els.baseline.hidden).toBe(true);
    expect(els.change.hidden).toBe(true);
    expect(els.error.hidden).toBe(true);
    expect(els.root.dataset).toEqual({
      power: '0.200',
      balls: '0',
      spins: '',
      baselineBalls: '0',
      baselineSpins: '',
    });

    answer(stats, 88);
    measure(stats, nudged, classic, 0.2);
    answer(stats, 116);
    panel.update(stats, 0.2);
    expect(els.current.textContent).toBe('This board: 29.0 ± 2.5 (start 11.6%, 1,000 balls)');
    expect(els.baseline.hidden).toBe(false);
    expect(els.change.textContent).toBe('Change: +7.0');
    expect(els.root.dataset).toEqual({
      power: '0.200',
      balls: '1000',
      spins: '29.00',
      baselineBalls: '1000',
      baselineSpins: '22.00',
    });
  });
});
