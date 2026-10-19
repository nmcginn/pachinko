// Headless Monte Carlo runner: launch N balls on a board and print the
// start-pocket rate, out rate, and spins per ¥1000, at one handle power or
// across a sweep of powers. The simulation is src/game/montecarlo.ts; this
// file parses arguments and spreads the balls over worker threads.
//
//   npx tsx tools/montecarlo.ts --board classic --balls 100000 --power 0.62 --seed 1
//   npx tsx tools/montecarlo.ts --balls 10000 --sweep 0:1:0.05
//
// Results depend only on the board, power, ball count, and seed, never on
// the number of workers: every ball draws from its own rng stream, and the
// batches' integer tallies add up the same in any order. Stdout is therefore
// byte-for-byte identical across runs; timing goes to stderr.

import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import {
  type Summary,
  type Tally,
  addTally,
  createTally,
  runBatch,
  summarize,
} from '../src/game/montecarlo';
import { type Board, BoardError, parseBoard } from '../src/sim/board';

const USAGE = `Usage: npx tsx tools/montecarlo.ts [options]

Launch balls on a board headlessly and print start-pocket rate, out rate,
and spins per ¥1000 (start-pocket entries per 250 balls launched).

Options:
  --board <name>         Board in boards/<name>.json (default: classic)
  --balls <n>            Balls to launch, per power (default: 100000)
  --power <0..1>         Launch handle power (default: 0.62)
  --sweep <from:to:step> Run every power from..to in steps, print a table,
                         and mark the best. Replaces --power.
  --seed <n>             RNG seed, an integer in [0, 2^32) (default: 1)
  --workers <n>          Worker threads (default: one per CPU, up to 8).
                         Changes speed only, never results.
  --json                 Print results as JSON instead of text
  -h, --help             Show this help

Results go to stdout and are identical for the same options. Timing goes
to stderr.`;

/** Balls per unit of work handed to a worker. Small enough to balance load, big enough to amortise messages. */
const BATCH_BALLS = 1000;

interface Job {
  readonly power: number;
  readonly seed: number;
  readonly first: number;
  readonly count: number;
}

interface WorkerInit {
  readonly boardData: unknown;
}

function fail(message: string): never {
  console.error(`montecarlo: ${message}`);
  process.exit(2);
}

function parseIntArg(name: string, raw: string, min: number, max: number): number {
  const v = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(v) || v < min || v > max) {
    fail(`--${name} must be a whole number in [${min}, ${max}], got "${raw}"`);
  }
  return v;
}

function parsePower(name: string, raw: string): number {
  const v = Number(raw);
  if (raw.trim() === '' || !(v >= 0 && v <= 1)) fail(`--${name} must be in [0, 1], got "${raw}"`);
  return v;
}

/** Powers from:to:step, inclusive, rounded so 0.1-style steps don't drift. */
function parseSweep(raw: string): number[] {
  const parts = raw.split(':');
  if (parts.length !== 3) fail(`--sweep must be from:to:step, got "${raw}"`);
  const [fromRaw, toRaw, stepRaw] = parts as [string, string, string];
  const from = parsePower('sweep from', fromRaw);
  const to = parsePower('sweep to', toRaw);
  const step = Number(stepRaw);
  if (!(step > 0) || to < from) fail(`--sweep needs from ≤ to and step > 0, got "${raw}"`);
  const n = Math.floor((to - from) / step + 1e-9);
  return Array.from({ length: n + 1 }, (_, i) => Math.round((from + i * step) * 1e9) / 1e9);
}

function loadBoard(name: string): { board: Board; data: unknown } {
  if (!/^[\w-]+$/.test(name)) fail(`--board must be a board name like "classic", got "${name}"`);
  const path = fileURLToPath(new URL(`../boards/${name}.json`, import.meta.url));
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`can't read board "${name}" (${path}): ${(e as Error).message}`);
  }
  try {
    return { board: parseBoard(data), data };
  } catch (e) {
    if (e instanceof BoardError) fail(`board "${name}" is ${e.message}`);
    throw e;
  }
}

/**
 * Worker bootstrap. tsx's loader doesn't carry over into worker threads, so
 * each worker registers it, then loads this file, which sees it is not the
 * main thread and serves batches.
 */
const WORKER_BOOT = `import('tsx/esm/api')
  .then(({ register }) => { register(); return import(${JSON.stringify(import.meta.url)}); })`;

/** A fixed set of workers that run batches on demand. */
class Pool {
  private readonly workers: Worker[];

  constructor(boardData: unknown, size: number) {
    const init: WorkerInit = { boardData };
    this.workers = Array.from(
      { length: size },
      () => new Worker(WORKER_BOOT, { eval: true, workerData: init }),
    );
  }

  /** Run every job, each worker taking the next one as it finishes, and sum the tallies. */
  run(jobs: readonly Job[]): Promise<Tally> {
    const total = createTally();
    let next = 0;
    let done = 0;
    return new Promise((resolve, reject) => {
      if (jobs.length === 0) {
        resolve(total);
        return;
      }
      const feed = (w: Worker) => {
        const job = jobs[next++];
        if (job) w.postMessage(job);
      };
      for (const w of this.workers) {
        w.removeAllListeners('message');
        w.removeAllListeners('error');
        w.on('message', (t: Tally) => {
          addTally(total, t);
          done += 1;
          if (done === jobs.length) resolve(total);
          else feed(w);
        });
        w.on('error', reject);
        feed(w);
      }
    });
  }

  close(): Promise<number[]> {
    return Promise.all(this.workers.map((w) => w.terminate()));
  }
}

function jobsFor(power: number, seed: number, balls: number): Job[] {
  const jobs: Job[] = [];
  for (let first = 0; first < balls; first += BATCH_BALLS) {
    jobs.push({ power, seed, first, count: Math.min(BATCH_BALLS, balls - first) });
  }
  return jobs;
}

interface Row extends Summary {
  readonly power: number;
  readonly entries: Tally['entries'];
  readonly lost: number;
  readonly stuck: number;
}

function row(power: number, tally: Tally): Row {
  return {
    power,
    ...summarize(tally),
    entries: tally.entries,
    lost: tally.lost,
    stuck: tally.stuck,
  };
}

const pct = (r: number) => `${(100 * r).toFixed(2)}%`;

function printRun(name: string, seed: number, r: Row): void {
  const n = r.launched;
  console.log(`board ${name}, power ${r.power}, ${n} balls, seed ${seed}`);
  console.log(`  start pocket     ${pct(r.startRate).padStart(7)}  (${r.entries.start})`);
  console.log(`  out-hole         ${pct(r.outRate).padStart(7)}  (${r.entries.out})`);
  console.log(`  foul             ${pct(r.foulRate).padStart(7)}  (${r.entries.foul})`);
  if (r.lost > 0) console.log(`  left the board            (${r.lost})`);
  if (r.stuck > 0) console.log(`  stuck in play             (${r.stuck})`);
  console.log(
    `  spins per ¥1000  ${r.spinsPer1000Yen.toFixed(2)} ± ${r.spinsPer1000YenSe.toFixed(2)} (1 s.e.)`,
  );
}

function printSweep(name: string, seed: number, balls: number, rows: readonly Row[], best: Row) {
  console.log(`board ${name}, ${balls} balls per power, seed ${seed}`);
  console.log('  power   start     out    foul  stuck  spins/¥1000');
  for (const r of rows) {
    const mark = r === best ? '  ← best' : '';
    console.log(
      `  ${r.power.toFixed(3)} ${pct(r.startRate).padStart(7)} ${pct(r.outRate).padStart(7)} ` +
        `${pct(r.foulRate).padStart(7)} ${String(r.stuck).padStart(6)}  ` +
        `${r.spinsPer1000Yen.toFixed(2).padStart(6)} ± ${r.spinsPer1000YenSe.toFixed(2)}${mark}`,
    );
  }
}

async function main(): Promise<void> {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        board: { type: 'string', default: 'classic' },
        balls: { type: 'string', default: '100000' },
        power: { type: 'string', default: '0.62' },
        sweep: { type: 'string' },
        seed: { type: 'string', default: '1' },
        workers: { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
    }));
  } catch (e) {
    fail(`${(e as Error).message}\nRun with --help for usage.`);
  }
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const balls = parseIntArg('balls', values.balls, 0, 1e9);
  const seed = parseIntArg('seed', values.seed, 0, 2 ** 32 - 1);
  const powers = values.sweep ? parseSweep(values.sweep) : [parsePower('power', values.power)];
  const workers =
    values.workers === undefined
      ? Math.min(8, availableParallelism())
      : parseIntArg('workers', values.workers, 1, 64);
  const { board, data } = loadBoard(values.board);

  const started = performance.now();
  const rows: Row[] = [];
  let ballSteps = 0;
  if (workers === 1) {
    // In-process: same code path the workers run, without threads.
    for (const power of powers) {
      const total = createTally();
      for (const job of jobsFor(power, seed, balls)) addTally(total, runBatch(board, job));
      rows.push(row(power, total));
      ballSteps += total.ballSteps;
    }
  } else {
    const pool = new Pool(data, workers);
    try {
      for (const power of powers) {
        const total = await pool.run(jobsFor(power, seed, balls));
        rows.push(row(power, total));
        ballSteps += total.ballSteps;
      }
    } finally {
      await pool.close();
    }
  }
  const seconds = (performance.now() - started) / 1000;

  if (values.sweep) {
    // Highest rate wins; ties go to the lower power.
    const best = rows.reduce((a, b) => (b.spinsPer1000Yen > a.spinsPer1000Yen ? b : a));
    if (values.json) {
      console.log(JSON.stringify({ board: board.name, seed, balls, rows, best: best.power }));
    } else {
      printSweep(board.name, seed, balls, rows, best);
    }
  } else {
    const r = rows[0] as Row;
    if (values.json) console.log(JSON.stringify({ board: board.name, seed, ...r }));
    else printRun(board.name, seed, r);
  }
  const rate = seconds > 0 ? ballSteps / seconds / 1e6 : 0;
  console.error(
    `montecarlo: ${seconds.toFixed(1)} s on ${workers} worker${workers === 1 ? '' : 's'}, ` +
      `${(ballSteps / 1e6).toFixed(1)} M ball-steps (${rate.toFixed(1)} M/s)`,
  );
}

// Entry point last, so the class and constants above are initialised.
if (!isMainThread) {
  // Worker: build the board once, then run whatever batches arrive.
  const board = parseBoard((workerData as WorkerInit).boardData);
  parentPort?.on('message', (job: Job) => {
    parentPort?.postMessage(runBatch(board, job));
  });
} else {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
