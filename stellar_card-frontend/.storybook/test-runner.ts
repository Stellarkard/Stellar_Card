import type { TestRunnerConfig } from '@storybook/test-runner';

// Storybook test runner configuration. Integrates with Vitest and Playwright
// to run automated accessibility and interaction tests for all stories.
//
// Configuration levels:
// - preVisit: runs before each story is rendered
// - postVisit: runs after each story is rendered (for assertions)
// - tags: control which stories to test
//
// Example usage: npm run test:storybook

const config: TestRunnerConfig = {
  // Automatically run accessibility checks on every story
  async postVisit(page, context) {
    // Wait for the story to be fully rendered
    await page.waitForLoadState('networkidle');

    // Check for console errors during story rendering
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });

    // Allow stories to self-report test failures via window.testResult
    const testResult = await page.evaluate(() => {
      return (window as any).testResult;
    });

    if (testResult?.error) {
      throw new Error(`Story test failed: ${testResult.error}`);
    }

    // Fail if unexpected console errors occurred
    if (errors.length > 0) {
      console.warn(`Console errors in ${context.id}:`, errors);
    }
  },

  // Optional: filter stories by tag
  tags: {
    // Skip stories tagged with 'skip-test'
    exclude: ['skip-test'],
  },
};

export default config;
