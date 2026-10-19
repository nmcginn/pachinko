import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function run(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'tools/montecarlo.ts', ...args], {
    encoding: 'utf8',
  });
}

const json = (...args: string[]) => {
  const r = run(...args, '--json');
  expect(r.stderr).toMatch(/montecarlo: .* s on \d+ workers?/);
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
};

// Each test spawns the tool (and its worker threads) several times.
describe('tools/montecarlo.ts', { timeout: 30_000 }, () => {
  it('prints usage with --help', () => {
    const r = run('--help');
    expect(r.status).toBe(0);
    for (const flag of ['--board', '--balls', '--power', '--sweep', '--seed', '--workers']) {
      expect(r.stdout).toContain(flag);
    }
  });

  it('prints start rate, out rate, and spins per ¥1000 for the documented command line', () => {
    const r = run('--board', 'classic', '--balls', '300', '--power', '0.62', '--seed', '1');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('board classic, power 0.62, 300 balls, seed 1');
    expect(r.stdout).toMatch(/start pocket +\d+\.\d\d%/);
    expect(r.stdout).toMatch(/out-hole +\d+\.\d\d%/);
    expect(r.stdout).toMatch(/spins per ¥1000 +\d+\.\d\d ± \d+\.\d\d/);
  });

  it('gives identical results across runs and worker counts', () => {
    const args = ['--balls', '800', '--power', '0', '--seed', '5'];
    const one = json(...args, '--workers', '1');
    const three = json(...args, '--workers', '3');
    const again = json(...args, '--workers', '3');
    expect(three).toEqual(one);
    expect(again).toEqual(one);
    expect(one).toMatchObject({ board: 'classic', seed: 5, power: 0, launched: 800 });
    const { start, out, foul } = one.entries;
    expect(start + out + foul + one.lost + one.stuck).toBe(800);
  });

  it('sweeps powers into a table and marks the best', () => {
    const sweep = json('--balls', '200', '--sweep', '0:0.1:0.05', '--workers', '2');
    expect(sweep.rows.map((r: { power: number }) => r.power)).toEqual([0, 0.05, 0.1]);
    const best = Math.max(...sweep.rows.map((r: { spinsPer1000Yen: number }) => r.spinsPer1000Yen));
    const bestRow = sweep.rows.find((r: { power: number }) => r.power === sweep.best);
    expect(bestRow.spinsPer1000Yen).toBe(best);

    const text = run('--balls', '100', '--sweep', '0.9:1:0.1', '--workers', '1');
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('spins/¥1000');
    expect(text.stdout.match(/^ {2}\d\.\d{3} /gm)).toHaveLength(2);
    expect(text.stdout).toContain('← best');
  });

  it('runs zero balls', () => {
    const r = json('--balls', '0', '--workers', '2');
    expect(r).toMatchObject({ launched: 0, spinsPer1000Yen: 0 });
  });

  it('rejects bad arguments with a message and exit status 2', () => {
    const bad: string[][] = [
      ['--power', '1.5'],
      ['--power', 'abc'],
      ['--balls', '-3'],
      ['--balls', '2.5'],
      ['--seed', '4294967296'],
      ['--workers', '0'],
      ['--sweep', '0:1'],
      ['--sweep', '1:0:0.1'],
      ['--sweep', '0:1:0'],
      ['--board', 'no-such-board'],
      ['--board', '../package'],
      ['--nope'],
    ];
    for (const args of bad) {
      // One ball, so a bad flag that slipped through would still finish fast.
      const r = run(...args, ...(args[0] === '--balls' ? [] : ['--balls', '1']));
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stderr, args.join(' ')).toMatch(/^montecarlo: /);
    }
  });
});
