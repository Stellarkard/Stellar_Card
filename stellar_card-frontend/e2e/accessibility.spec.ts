import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[] }>;
};

const auditedPages = [
  { name: 'home', path: '/' },
  { name: 'dashboard', path: '/dashboard' },
];

for (const auditedPage of auditedPages) {
  test(`${auditedPage.name} has no serious accessibility violations`, async ({ page }) => {
    await page.goto(auditedPage.path);
    await page.addScriptTag({ path: axePath });

    const violations = await page.evaluate(async () => {
      const axe = (window as typeof window & {
        axe: {
          run: (
            context: Document,
            options: { resultTypes: string[] },
          ) => Promise<{ violations: AxeViolation[] }>;
        };
      }).axe;

      const result = await axe.run(document, { resultTypes: ['violations'] });
      return result.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious');
    });

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
}
