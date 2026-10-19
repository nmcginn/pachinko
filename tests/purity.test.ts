// The sim/game purity guardrail is enforced by lint config. This checks that
// the config actually catches what CLAUDE.md forbids, so a config edit can't
// silently switch it off.

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

describe('sim/game purity lint rules', () => {
  const forbidden: [string, string][] = [
    ['Math.random', 'export const x = Math.random();\n'],
    ['Date', 'export const x = Date.now();\n'],
    ['new Date', 'export const x = new Date();\n'],
    ['performance', 'export const x = performance.now();\n'],
    ['window', 'export const x = window.innerWidth;\n'],
    ['document', 'export const x = document.title;\n'],
  ];

  for (const dir of ['src/sim', 'src/game']) {
    for (const [name, code] of forbidden) {
      it(`rejects ${name} in ${dir}`, async () => {
        const ids = await ruleIds(code, `${dir}/__probe__.ts`);
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.every((id) => id.startsWith('no-restricted') || id === 'no-undef')).toBe(true);
      });
    }
  }

  it('allows the same code in render/', async () => {
    const ids = await ruleIds(
      'export const x = Math.random() + Date.now();\n',
      'src/render/__probe__.ts',
    );
    expect(ids).toEqual([]);
  });

  it('allows ordinary Math in sim/', async () => {
    const ids = await ruleIds('export const x = Math.hypot(3, 4);\n', 'src/sim/__probe__.ts');
    expect(ids).toEqual([]);
  });
});
