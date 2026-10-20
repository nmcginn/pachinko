import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    for (const flag of [
      '--board',
      '--balls',
      '--power',
      '--sweep',
      '--seed',
      '--workers',
      '--open',
      '--tulips',
    ]) {
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
    const args = ['--balls', '800', '--power', '0.2', '--seed', '5'];
    const one = json(...args, '--workers', '1');
    const three = json(...args, '--workers', '3');
    const again = json(...args, '--workers', '3');
    expect(three).toEqual(one);
    expect(again).toEqual(one);
    expect(one).toMatchObject({ board: 'classic', seed: 5, power: 0.2, launched: 800 });
    const { start, out, foul, attacker, tulip } = one.entries;
    expect(attacker).toBe(0);
    expect(one.gatesOpen).toBe(false);
    expect(start + out + foul + tulip + one.lost + one.stuck).toBe(800);
  });

  it('holds the attacker open with --open, and reports what it catches', () => {
    const args = ['--balls', '400', '--power', '0.2', '--seed', '5', '--workers', '2'];
    const shut = json(...args);
    const open = json(...args, '--open');
    expect(open.gatesOpen).toBe(true);
    expect(open.entries.attacker).toBeGreaterThan(0);
    expect(open.attackerRate).toBe(open.entries.attacker / 400);
    // The attacker is below the start pocket: start entries can't change.
    expect(open.entries.start).toBe(shut.entries.start);

    const text = run(...args, '--open');
    expect(text.stdout).toContain('attacker open');
    expect(text.stdout).toMatch(/attacker +\d+\.\d\d%/);
    expect(run(...args).stdout).not.toContain('attacker');
    const sweep = run('--balls', '100', '--sweep', '0:0.1:0.1', '--workers', '1', '--open');
    expect(sweep.stdout).toMatch(/power +start +out +foul +attacker/);
  });

  it('reports each tulip while open and while closed, and holds them with --tulips', () => {
    const args = ['--balls', '300', '--power', '0.2', '--seed', '1', '--workers', '2'];
    const play = json(...args);
    expect(play).toMatchObject({ board: 'classic', tulipMode: 'play', launched: 300 });
    expect(play.tulips.map((t: { id: string }) => t.id)).toEqual(['tulip-left', 'tulip-right']);
    const sum = play.tulips.reduce(
      (n: number, t: { openEntries: number; closedEntries: number }) =>
        n + t.openEntries + t.closedEntries,
      0,
    );
    expect(sum).toBe(play.entries.tulip);
    const open = json(...args, '--tulips', 'open').tulips;
    const closed = json(...args, '--tulips', 'closed').tulips;
    for (let k = 0; k < 2; k++) {
      expect(open[k]).toMatchObject({ openShare: 1, closedRate: null });
      expect(closed[k]).toMatchObject({ openShare: 0, openRate: null });
      expect(open[k].openRate).toBeGreaterThan(closed[k].closedRate);
    }

    const text = run(...args);
    expect(text.status).toBe(0);
    for (const id of ['tulip-left', 'tulip-right']) {
      expect(text.stdout).toMatch(new RegExp(`^  ${id} +\\d+\\.\\d\\d% +\\(\\d+\\)`, 'm'));
    }
    expect(text.stdout).toMatch(/while open +(\d+\.\d\d%|—) +\(\d+, open \d+\.\d\d% of the time\)/);
    expect(text.stdout).toMatch(/while closed +\d+\.\d\d% +\(\d+\)/);
    const held = run(...args, '--tulips', 'closed');
    expect(held.stdout).toContain('tulips held closed');
    expect(held.stdout).toMatch(/while open +— +\(0, open 0\.00% of the time\)/);
    const sweep = run('--balls', '100', '--sweep', '0.2:0.3:0.1', '--workers', '1');
    expect(sweep.stdout).toMatch(/power +start +out +foul +tulip +stuck/);
  });

  it('runs a board from a .json path; one without tulips prints no tulip lines', () => {
    const data = JSON.parse(readFileSync('boards/classic.json', 'utf8'));
    data.name = 'bare';
    data.pockets = data.pockets.filter((p: { kind: string }) => p.kind !== 'tulip');
    // And their cups, or balls would come to rest in them.
    data.rails = data.rails.filter((r: { id: string }) => !r.id.startsWith('tulip-'));
    const dir = mkdtempSync(join(tmpdir(), 'montecarlo-'));
    const path = join(dir, 'bare.json');
    writeFileSync(path, JSON.stringify(data));
    const args = ['--board', path, '--balls', '50', '--power', '0.2', '--workers', '1'];
    expect(json(...args)).toMatchObject({ board: 'bare', tulips: [], launched: 50, stuck: 0 });
    const text = run(...args);
    expect(text.stdout).toContain('board bare, power 0.2, 50 balls');
    expect(text.stdout).not.toContain('tulip');
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
      ['--board', 'no-such-dir/board.json'],
      ['--board', 'package.json'],
      ['--tulips', 'ajar'],
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
