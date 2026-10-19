// Headless Monte Carlo runner: drop N balls on a board and print stats.
// The simulation lands in M3; until then this only parses arguments, so the
// command line in PLAN.md and CLAUDE.md is stable from day one.
//
//   npx tsx tools/montecarlo.ts --board classic --balls 100000 --power 0.62 --seed 1

import { parseArgs } from 'node:util';

const USAGE = `Usage: npx tsx tools/montecarlo.ts [options]

Drop balls on a board headlessly and print start-pocket rate, out rate,
and spins per ¥1000.

Options:
  --board <name>    Board in boards/<name>.json (default: classic)
  --balls <n>       Balls to launch (default: 100000)
  --power <0..1>    Launch handle power (default: 0.62)
  --seed <n>        RNG seed (default: 1)
  -h, --help        Show this help

Not implemented yet: the simulation lands in milestone M3.`;

const { values } = parseArgs({
  options: {
    board: { type: 'string', default: 'classic' },
    balls: { type: 'string', default: '100000' },
    power: { type: 'string', default: '0.62' },
    seed: { type: 'string', default: '1' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

console.error('montecarlo: not implemented until M3. Run with --help for usage.');
process.exit(2);
