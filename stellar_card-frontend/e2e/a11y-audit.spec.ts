/**
 * Automated accessibility (a11y) audit — runs axe-core against every
 * top-level dashboard route and fails if anyserious violations are found.
 *
 * Uses @axe-core/playwright for integration with Playwright.
 * Runs in CI via the a11y.yml workflow and locally via:
 *   npm run test:a11y
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const MOCK_USER = {
  id: 'user-id-1',
  email: 'owner@example.com',
  role: 'owner',
};

const MOCK_DASHBOARD_INFO = {
  id: 'dash-id-1',
  name: 'Test Dashboard',
  spend_limit_usdc: null,
  frozen: false,
  created_at: '2026-04-01T00:00:00Z',
  stats: {
    total_orders: 12,
    total_gmv: 150,
    delivered: 10,
    failed: 1,
    refunded: 1,
    pending: 0,
    active_keys: 2,
    pending_approvals: 0,
  },
};

const MOCK_AGENTS: unknown[] = [];
const MOCK_ORDERS: unknown[] = [];

async function installMocks(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { user: MOCK_USER } }),
  );
  await page.route('**/api/auth/logout', (route) =>
    route.fulfill({ status: 200, json: { ok: true } }),
  );
  await page.route('**/api/admin-proxy/dashboard', (route) =>
    route.fulfill({ status: 200, json: MOCK_DASHBOARD_INFO }),
  );
  await page.route('**/api/admin-proxy/dashboard/api-keys**', (route) =>
    route.fulfill({ status: 200, json: MOCK_AGENTS }),
  );
  await page.route('**/api/admin-proxy/dashboard/orders**', (route) =>
    route.fulfill({ status: 200, json: MOCK_ORDERS }),
  );
  await page.route('**/api/admin-proxy/dashboard/approval-requests**', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('**/api/admin-proxy/dashboard/merchants', (route) =>
    route.fulfill({ status: 200, json: { merchants: [] } }),
  );
  await page.route('**/api/admin-proxy/dashboard/alert-rules', (route) =>
    route.fulfill({ status: 200, json: { rules: [] } }),
  );
  await page.route('**/api/admin-proxy/dashboard/alert-firings**', (route) =>
    route.fulfill({ status: 200, json: { firings: [] } }),
  );
  await page.route('**/api/admin-proxy/dashboard/audit-log**', (route) =>
    route.fulfill({ status: 200, json: { entries: [] } }),
  );
  await page.route('**/api/admin-proxy/dashboard/webhook-deliveries**', (route) =>
    route.fulfill({ status: 200, json: { deliveries: [] } }),
  );
  await page.route('**/api/admin-proxy/dashboard/stream', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: ':connected\n\n',
    }),
  );
  await page.route('**horizon.stellar.org/accounts/**', (route) =>
    route.fulfill({ status: 200, json: { balances: [] } }),
  );
}

const A11Y_ROUTES = [
  '/dashboard/overview',
  '/dashboard/agents',
  '/dashboard/orders',
  '/dashboard/approvals',
  '/dashboard/analytics',
  '/dashboard/merchants',
  '/dashboard/alerts',
  '/dashboard/audit',
  '/dashboard/developer',
  '/dashboard/settings',
  '/dashboard/teams',
  '/dashboard/feedback',
];

test.describe('Accessibility audit', () => {
  for (const path of A11Y_ROUTES) {
    test(`${path} has no serious accessibility violations`, async ({ page }) => {
      await installMocks(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle', { timeout: 10_000 });

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      // Filter out critical+serious violations (moderate/minor are informational)
      const seriousViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      expect(
        seriousViolations,
        `Accessibility violations on ${path}:\n${seriousViolations
          .map((v) => `  [${v.impact}] ${v.id}: ${v.description}\n    ${v.nodes.map((n) => n.target.join(', ')).join('\n    ')}`)
          .join('\n')}`,
      ).toEqual([]);
    });
  }
});
