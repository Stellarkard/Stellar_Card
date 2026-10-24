import { defineConfig, devices } from '@playwright/test';

// Config for e2e-manual/ — scripts that drive REAL third-party sites
// (currently just dominos-order.spec.ts) rather than this app. Deliberately
// separate from playwright.config.ts:
//   - no webServer block: these tests don't touch our Next.js app at all
//   - no retries: retrying a real checkout flow against a live site risks
//     duplicate side effects (e.g. a second order), unlike the idempotent
//     mocked dashboard smoke tests
//   - never referenced by CI — run manually via `npm run test:e2e:dominos`
export default defineConfig({
  testDir: './e2e-manual',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
