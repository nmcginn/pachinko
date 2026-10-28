import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /frametime\.spec\.ts$/,
    },
    // The frame-time budget (M6) is measured after every other test has
    // finished, alone, so another test's load can't eat into it: the live
    // stats test keeps a Web Worker busy for several seconds.
    {
      name: 'frametime',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /frametime\.spec\.ts$/,
      dependencies: ['chromium'],
    },
  ],
  // Smoke tests run against the production build, which is what Pages serves.
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
