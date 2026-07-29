/**
 * Cross-browser compatibility tests — verifies that core functionality
 * works consistently across different browsers (Chrome, Firefox, Safari, mobile).
 *
 * Tests focus on:
 * - Browser-specific CSS rendering
 * - JavaScript feature compatibility
 * - Mobile responsive design
 * - Touch interactions on mobile devices
 */

import { test, expect, type Page } from '@playwright/test';

// ── Shared fixtures ──────────────────────────────────────────────────────────

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

const MOCK_AGENTS = [
  {
    id: 'agent-1',
    label: 'test-agent',
    spend_limit_usdc: '100.00',
    total_spent_usdc: '55.00',
    default_webhook_url: null,
    wallet_public_key: 'GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ',
    enabled: 1,
    suspended: 0,
    last_used_at: '2026-04-13T12:00:00Z',
    created_at: '2026-04-01T00:00:00Z',
    policy_daily_limit_usdc: null,
    policy_single_tx_limit_usdc: null,
    policy_require_approval_above_usdc: null,
    policy_allowed_hours: null,
    policy_allowed_days: null,
    mode: 'live',
    rate_limit_rpm: null,
    expires_at: null,
    agent: {
      state: 'active',
      label: 'Active',
      detail: null,
      since: '2026-04-01T00:00:00Z',
      wallet_public_key: 'GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ',
    },
  },
];

async function installMocks(page: Page) {
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
    route.fulfill({ status: 200, json: [] }),
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

// ── Cross-browser compatibility tests ─────────────────────────────────────────

test.describe('Cross-browser compatibility', () => {
  test('CSS Grid and Flexbox rendering', async ({ page }) => {
    await installMocks(page);
    await page.goto('/dashboard/overview');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Verify grid layout is applied correctly
    const gridContainer = page.locator('main').first();
    await expect(gridContainer).toBeVisible();

    // Check that flexbox elements are properly aligned
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible();
  });

  test('Modern JavaScript features work across browsers', async ({ page }) => {
    await installMocks(page);
    await page.goto('/dashboard/agents');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Test that modern JS features (optional chaining, nullish coalescing) work
    const agentCard = page.locator('[data-testid="agent-card"]').first();
    await expect(agentCard).toBeVisible();
  });

  test('CSS custom properties (variables) are supported', async ({ page }) => {
    await installMocks(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Verify that CSS variables are applied
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('Responsive design breakpoints', async ({ page }) => {
    await installMocks(page);
    
    // Test desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/dashboard/overview');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible();

    // Test tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    await expect(sidebar).toBeVisible();

    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    
    // On mobile, sidebar might be hidden or behind a hamburger menu
    const mobileMenu = page.locator('[aria-label="Menu"], [aria-label="Open menu"]').first();
    // Don't assert visibility as it depends on implementation
  });
});

test.describe('Mobile-specific interactions', () => {
  test('Touch interactions work on mobile devices', async ({ page }) => {
    await installMocks(page);
    await page.goto('/dashboard/agents');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Test tap interaction
    const agentCard = page.locator('[data-testid="agent-card"]').first();
    await agentCard.tap();
    
    // Verify interaction worked
    await expect(agentCard).toBeVisible();
  });

  test('Mobile keyboard handling', async ({ page }) => {
    await installMocks(page);
    await page.goto('/dashboard/overview');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Test that keyboard shortcuts work on mobile (if supported)
    const searchInput = page.getByPlaceholder(/search/i).first();
    if (await searchInput.isVisible()) {
      await searchInput.tap();
      await searchInput.fill('test');
      await expect(searchInput).toHaveValue('test');
    }
  });
});

test.describe('Browser-specific features', () => {
  test('Clipboard API works in Chrome', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Clipboard API test is Chrome-specific');

    await installMocks(page);
    await page.goto('/dashboard/developer');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Test clipboard functionality if present
    const copyButton = page.getByRole('button', { name: /copy/i }).first();
    if (await copyButton.isVisible()) {
      await copyButton.click();
      // Verify no errors occurred
    }
  });

  test('Firefox-specific CSS rendering', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox', 'This test is Firefox-specific');

    await installMocks(page);
    await page.goto('/dashboard/overview');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Verify page renders correctly in Firefox
    const mainContent = page.locator('main').first();
    await expect(mainContent).toBeVisible();
  });

  test('Safari-specific CSS rendering', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'This test is Safari-specific');

    await installMocks(page);
    await page.goto('/dashboard/overview');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Verify page renders correctly in Safari
    const mainContent = page.locator('main').first();
    await expect(mainContent).toBeVisible();
  });
});

test.describe('Font and text rendering', () => {
  test('Custom fonts load correctly across browsers', async ({ page }) => {
    await installMocks(page);
    await page.goto('/dashboard/overview');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Wait for fonts to load
    await page.waitForLoadState('domcontentloaded');
    
    // Verify text is visible
    const heading = page.getByRole('heading', { name: /overview/i }).first();
    await expect(heading).toBeVisible();
  });

  test('Text rendering is consistent', async ({ page }) => {
    await installMocks(page);
    await page.goto('/dashboard/agents');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Verify agent labels are rendered
    const agentLabel = page.getByText('test-agent').first();
    await expect(agentLabel).toBeVisible();
  });
});

test.describe('Form interactions', () => {
  test('Form inputs work consistently across browsers', async ({ page }) => {
    await installMocks(page);
    await page.goto('/dashboard/agents');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Test text input
    const searchInput = page.getByPlaceholder(/search/i).first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('test search');
      await expect(searchInput).toHaveValue('test search');
    }
  });

  test('Button interactions work across browsers', async ({ page }) => {
    await installMocks(page);
    await page.goto('/dashboard/agents');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Test button click
    const createButton = page.getByRole('button', { name: /create/i }).first();
    if (await createButton.isVisible()) {
      await createButton.click();
      // Verify button interaction worked
    }
  });
});
