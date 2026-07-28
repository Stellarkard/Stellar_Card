import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // single-file admin tests don't need parallelism
  retries: process.env.CI ? 2 : 0,
  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,
  // Increase timeout for CI (Next.js cold start can be slow).
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github'], ['list']]
    : [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Capture screenshots on failure for CI debugging.
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
    // Record video only on retry to save disk.
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Start Next.js dev server before running tests.
  // The backend is mocked via page.route() — no backend process needed.
  webServer: {
    command: 'npm run dev -- --port 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
