import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest config scoped to the unit-test corner of the web app.
// Tests run under Node with happy-dom disabled (we're only exercising
// pure helpers + permission logic right now, not component rendering).
// Full component testing via @testing-library/react lands in a later
// phase when we have Playwright e2e covering the interactive flows.
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  },
  test: {
    coverage: {
      reporter: ['text', 'html'],
      include: ['app/dashboard/_lib/**/*.ts', 'app/dashboard/_ui/**/*.{ts,tsx}', 'app/components/**/*.{ts,tsx}']
    },
    projects: [{
      extends: true,
      test: {
        environment: 'node',
        include: ['app/dashboard/_lib/**/*.test.ts', 'app/dashboard/_ui/**/*.test.ts', 'app/components/**/*.test.tsx'],
        exclude: ['**/node_modules/**', '**/.next/**', '**/e2e/**']
      }
    }, {
      extends: true,
      plugins: [
      // The plugin will run tests for the stories defined in your Storybook config
      // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
      storybookTest({
        configDir: path.join(dirname, '.storybook')
      })],
      test: {
        name: 'storybook',
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({}),
          instances: [{
            browser: 'chromium'
          }]
        }
      }
    }]
  }
});