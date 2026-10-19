import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function run(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'tools/montecarlo.ts', ...args], {
    encoding: 'utf8',
  });
}

describe('tools/montecarlo.ts', () => {
  it('prints usage with --help', () => {
    const r = run('--help');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('--balls');
    expect(r.stdout).toContain('--seed');
  });

  it('accepts the documented command line and says it is not implemented yet', () => {
    const r = run('--board', 'classic', '--balls', '100000', '--power', '0.62', '--seed', '1');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('not implemented');
  });

  it('rejects an unknown flag', () => {
    expect(run('--nope').status).not.toBe(0);
  });
});
