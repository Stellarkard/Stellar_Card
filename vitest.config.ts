import { defineConfig } from 'vitest/config';

// Repo-wide config checks only — sub-packages (stellar_card-sdk,
// stellar_card-backend, stellar_card-frontend) run their own test
// suites with their own runners/configs and must not be picked up here.
export default defineConfig({
  test: {
    include: ['test/*.test.mjs'],
  },
});
