// The live stats in the adjust panel (M7): spins per ¥1000 for the board as
// it stands and as it loaded, at the handle's power, from the Monte Carlo
// running in the worker (game/livestats.ts). data-* attributes mirror the
// numbers for tests.

import { type LiveStats, tallyFor } from '../game/livestats';
import { type Tally, summarize } from '../game/montecarlo';

export interface StatsLine {
  /** Spins per ¥1000, or null before the first batch. */
  readonly spins: number | null;
  readonly text: string;
}

export interface StatsView {
  readonly title: string;
  /** The board as it stands. */
  readonly current: StatsLine;
  /** The board as it loaded; null when no nail has moved (the two are the same board). */
  readonly baseline: StatsLine | null;
  /** current − baseline, in spins per ¥1000; null until both have numbers or with nothing moved. */
  readonly change: string | null;
  /** Why the run stopped, or null. */
  readonly error: string | null;
  readonly balls: number;
  readonly baselineBalls: number;
}

const ballCount = (n: number) => `${n.toLocaleString('en-US')} ball${n === 1 ? '' : 's'}`;
const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1)}`;

function line(label: string, tally: Tally | null): StatsLine {
  if (!tally || tally.launched === 0) return { spins: null, text: `${label}: measuring…` };
  const s = summarize(tally);
  return {
    spins: s.spinsPer1000Yen,
    text:
      `${label}: ${s.spinsPer1000Yen.toFixed(1)} ± ${s.spinsPer1000YenSe.toFixed(1)}` +
      ` (start ${(100 * s.startRate).toFixed(1)}%, ${ballCount(s.launched)})`,
  };
}

/** What the stats part of the panel says: pure, for tests. `power` is the handle's, in [0, 1]. */
export function describeStats(stats: LiveStats, power: number): StatsView {
  const current = tallyFor(stats, stats.current);
  const same = stats.current === stats.baseline;
  const baseline = same ? null : tallyFor(stats, stats.baseline);
  const now = line(same ? 'Board as loaded' : 'This board', current);
  const was = same ? null : line('As loaded', baseline);
  return {
    title: `Spins per ¥1000 at ${Math.round(power * 100)}% power`,
    current: now,
    baseline: was,
    change:
      now.spins !== null && was && was.spins !== null
        ? `Change: ${signed(now.spins - was.spins)}`
        : null,
    error: stats.error === null ? null : `Stats stopped: ${stats.error}`,
    balls: current?.launched ?? 0,
    baselineBalls: (same ? current : baseline)?.launched ?? 0,
  };
}

export interface StatsPanelElements {
  /** Holds the rest, and the data-* attributes. */
  readonly root: HTMLElement;
  readonly title: HTMLElement;
  readonly current: HTMLElement;
  readonly baseline: HTMLElement;
  readonly change: HTMLElement;
  readonly error: HTMLElement;
}

export interface StatsPanel {
  update(stats: LiveStats, power: number): void;
}

export function createStatsPanel(els: StatsPanelElements): StatsPanel {
  // Only touch the DOM when something changed.
  let shown = '';
  return {
    update(stats, power) {
      const v = describeStats(stats, power);
      const key = JSON.stringify(v);
      if (key === shown) return;
      shown = key;
      els.title.textContent = v.title;
      els.current.textContent = v.current.text;
      els.baseline.textContent = v.baseline?.text ?? '';
      els.baseline.hidden = v.baseline === null;
      els.change.textContent = v.change ?? '';
      els.change.hidden = v.change === null;
      els.error.textContent = v.error ?? '';
      els.error.hidden = v.error === null;
      const d = els.root.dataset;
      d['power'] = power.toFixed(3);
      d['balls'] = String(v.balls);
      d['spins'] = v.current.spins === null ? '' : v.current.spins.toFixed(2);
      d['baselineBalls'] = String(v.baselineBalls);
      const baseSpins = v.baseline ? v.baseline.spins : v.current.spins;
      d['baselineSpins'] = baseSpins === null ? '' : baseSpins.toFixed(2);
    },
  };
}
