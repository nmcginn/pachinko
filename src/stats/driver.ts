// Main-thread side of the live stats (M7): posts game/livestats.ts's next
// batch to the worker, one at a time, and takes the replies back. The
// worker is injected, so tests can run the batches in-process.

import {
  type LiveStats,
  type StatsJob,
  type StatsReply,
  finishJob,
  nextJob,
} from '../game/livestats';

/** What the driver needs of a Worker. */
export interface StatsWorker {
  postMessage(job: StatsJob): void;
  addEventListener(type: 'message', fn: (e: { readonly data: StatsReply }) => void): void;
  addEventListener(type: 'error', fn: (e: { readonly message?: string }) => void): void;
}

export interface StatsDriver {
  /** Send the next batch if none is in flight. Call after measure() or stopMeasuring(). */
  pump(): void;
}

/**
 * Drive `stats` on `worker`. Calls `changed` whenever a batch lands or
 * fails, so the page can show it.
 */
export function createStatsDriver(
  worker: StatsWorker,
  stats: LiveStats,
  changed: () => void,
): StatsDriver {
  /** Why the worker died, once it has: it takes no more jobs. */
  let dead: string | null = null;
  const pump = (): void => {
    if (dead !== null) {
      // An edit clears a batch's error; a dead worker's stays.
      if (stats.current !== null) stats.error ??= dead;
      return;
    }
    const job = nextJob(stats);
    if (job) worker.postMessage(job);
  };
  worker.addEventListener('message', (e) => {
    if (finishJob(stats, e.data)) changed();
    pump();
  });
  // A worker that fails to load or throws outside serveJob is done for:
  // fail the job in flight, and every run after it.
  worker.addEventListener('error', (e) => {
    dead = e.message || 'the worker failed';
    const job = stats.running;
    if (job) finishJob(stats, { key: job.key, first: job.first, error: dead });
    else if (stats.current !== null) stats.error = dead;
    changed();
  });
  return { pump };
}
