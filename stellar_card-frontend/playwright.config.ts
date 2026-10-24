import { defineConfig, devices } from '@playwright/test';

// This config covers the automated, CI-safe suite in `e2e/` only — a
// mocked-backend smoke test with no external dependencies. The Domino's
// live-site script lives in `e2e-manual/` under its own
// `playwright.manual.config.ts` and is never picked up here (see that
// file's docstring for why it must stay opt-in).
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
  // CI gets a machine-readable JUnit report (for annotations), an HTML
  // report that .github/workflows/e2e.yml uploads as an artifact on
  // failure alongside traces/screenshots, and inline `github` annotations.
  // Local runs stay terse.
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'test-results/junit.xml' }],
        ['github'],
      ]
    : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Traces only kick in on retry; a screenshot on every failed attempt
    // (including the first, non-retried one) gives a faster first signal
    // for a CI failure without waiting for the retry to reproduce it.
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
    // Record video only on retry to save disk.
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
    {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
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
