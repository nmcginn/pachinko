// Web Worker for the live stats in nail-adjust mode (M7): runs one Monte
// Carlo batch per message and posts the tally back. The scheduling is
// game/livestats.ts's, on the main thread; see src/stats/driver.ts.

import { type StatsJob, serveJob } from '../game/livestats';

// The app compiles with the DOM lib, where `self` is a Window; in a worker
// it is a DedicatedWorkerGlobalScope, whose postMessage takes one argument.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<StatsJob>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (e) => scope.postMessage(serveJob(e.data));
