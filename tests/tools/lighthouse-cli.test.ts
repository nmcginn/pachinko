// tools/lighthouse.ts's arguments. The audit itself needs a browser, so it
// runs in CI's lighthouse job, not here.

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const run = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'tools/lighthouse.ts', ...args], {
    encoding: 'utf8',
  });

describe('tools/lighthouse.ts', { timeout: 30_000 }, () => {
  it('prints usage with --help', () => {
    const r = run('--help');
    expect(r.status).toBe(0);
    for (const flag of ['--runs', '--threshold', '--preset', '--url', '--chrome', '--json'])
      expect(r.stdout).toContain(flag);
  });

  it.each([
    [['--runs', '0'], '--runs'],
    [['--runs', '2.5'], '--runs'],
    [['--threshold', '101'], '--threshold'],
    [['--threshold', 'high'], '--threshold'],
    [['--preset', 'tablet'], '--preset'],
    [['--chrome', '/no/such/browser'], 'no browser'],
  ])('refuses %j with a message, before starting anything', (args, message) => {
    const r = run(...args);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(message);
  });
});
