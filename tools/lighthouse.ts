// Lighthouse performance check (M8's acceptance: performance ≥ 90). Serves
// the production build in dist/ with `vite preview`, runs Lighthouse's
// performance category against it several times in headless Chromium, and
// prints each run's score and metrics. Exits 1 if the median score is under
// the threshold, or if any run failed.
//
//   npm run build && npx tsx tools/lighthouse.ts
//   npx tsx tools/lighthouse.ts --runs 5 --preset desktop
//   npx tsx tools/lighthouse.ts --url https://example.pages.dev/
//
// Lighthouse's default is a mid-range phone on a slow 4G link with a 4×
// CPU slowdown, simulated; that is what the threshold is checked against
// unless --preset desktop. The browser is Playwright's Chromium (the one
// `npx playwright install chromium` fetches) unless CHROME_PATH or
// --chrome names another.

import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type LhrLike, type RunResult, formatRun, judge, readRun } from './lighthouse-score';

const USAGE = `Usage: npx tsx tools/lighthouse.ts [options]

Run Lighthouse's performance category against the production build (dist/,
served with vite preview) and check the median score.

Options:
  --runs <n>         Lighthouse runs; the median score is judged (default: 3)
  --threshold <n>    Lowest passing median score, 0 to 100 (default: 90)
  --preset <name>    mobile (default: Lighthouse's throttled phone) or desktop
  --url <url>        Audit this URL instead of serving dist/
  --chrome <path>    Chromium or Chrome binary (default: CHROME_PATH, else
                     Playwright's Chromium)
  --json             Print the runs and verdict as JSON
  -h, --help         Show this help`;

function fail(message: string): never {
  console.error(`lighthouse: ${message}`);
  process.exit(2);
}

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    threshold: { type: 'string', default: '90' },
    preset: { type: 'string', default: 'mobile' },
    url: { type: 'string' },
    chrome: { type: 'string' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 20)
  fail(`--runs must be a whole number from 1 to 20, got ${values.runs}`);
const threshold = Number(values.threshold);
if (!(threshold >= 0 && threshold <= 100))
  fail(`--threshold must be from 0 to 100, got ${values.threshold}`);
if (values.preset !== 'mobile' && values.preset !== 'desktop')
  fail(`--preset must be mobile or desktop, got ${values.preset}`);

// The heavy modules load only once the arguments are good, so a mistake is
// reported at once.
const chromePath =
  values.chrome ??
  process.env['CHROME_PATH'] ??
  (await import('@playwright/test')).chromium.executablePath();
if (!existsSync(chromePath))
  fail(
    `no browser at ${chromePath}: run \`npx playwright install chromium\`, or set CHROME_PATH or --chrome`,
  );

const { preview } = await import('vite');
const chromeLauncher = await import('chrome-launcher');
const { default: lighthouse } = await import('lighthouse');
const { default: desktopConfig } = await import('lighthouse/core/config/desktop-config.js');

let server: Awaited<ReturnType<typeof preview>> | null = null;
let url = values.url;
if (url === undefined) {
  if (!existsSync('dist/index.html')) fail('no dist/index.html: run `npm run build` first');
  server = await preview({ logLevel: 'warn', preview: { port: 4180, strictPort: false } });
  url = server.resolvedUrls?.local[0];
  if (!url) fail('vite preview did not report a URL');
}

const chrome = await chromeLauncher.launch({
  chromePath,
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
});

const results: RunResult[] = [];
const errors: string[] = [];
try {
  for (let i = 1; i <= runs; i++) {
    const result = await lighthouse(
      url,
      { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance'] },
      values.preset === 'desktop' ? desktopConfig : undefined,
    );
    if (!result) {
      errors.push(`run ${i}: Lighthouse returned nothing`);
      continue;
    }
    // The LHR type is Lighthouse's own; LhrLike is the part read here.
    const run = readRun(result.lhr as unknown as LhrLike);
    if (run instanceof Error) {
      errors.push(`run ${i}: ${run.message}`);
      continue;
    }
    results.push(run);
    if (!values.json) console.log(formatRun(i, run));
  }
} finally {
  chrome.kill();
  await server?.close();
}

const verdict = results.length > 0 ? judge(results, threshold) : null;
if (values.json) {
  console.log(
    JSON.stringify({ url, preset: values.preset, threshold, runs: results, errors, verdict }),
  );
} else {
  for (const e of errors) console.error(e);
  if (verdict)
    console.log(
      `${values.preset}: median ${verdict.medianScore} (runs ${verdict.minScore} to ${verdict.maxScore}), ` +
        `threshold ${threshold}: ${verdict.pass && errors.length === 0 ? 'pass' : 'FAIL'}`,
    );
}
process.exit(verdict?.pass && errors.length === 0 ? 0 : 1);
