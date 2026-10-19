import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['tools/**/*.ts', 'tests/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Guardrail from CLAUDE.md: sim and game code stay pure and deterministic.
    // tsconfig.pure.json already rejects DOM references; this catches the rest.
    files: ['src/sim/**/*.ts', 'src/game/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'sim/game must not read the clock. Pass time in explicitly.' },
        {
          name: 'performance',
          message: 'sim/game must not read the clock. Pass time in explicitly.',
        },
        { name: 'window', message: 'sim/game must not touch the DOM.' },
        { name: 'document', message: 'sim/game must not touch the DOM.' },
        { name: 'globalThis', message: 'sim/game must not reach for host globals.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use sim/rng.ts with an explicit seed.' },
      ],
    },
  },
  prettier,
);
