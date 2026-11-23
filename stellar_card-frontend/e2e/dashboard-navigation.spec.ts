/**
 * End-to-end: complete user login + dashboard navigation flow.
 *
 * Exercises the golden path a real operator takes against a fully mocked
 * backend (no API process required — see the `webServer` block in
 * playwright.config.ts, which boots Next.js and stubs the network here):
 *
 *   1. Sign in with an emailed one-time code (AuthGate login form →
 *      verify → HttpOnly session cookie) and land on the dashboard.
 *   2. Move between Overview → Orders → Merchants → Settings via the
 *      sidebar (real client-side routing, not full page reloads).
 *   3. Assert each page's data (KPI tiles, order table, merchant grid)
 *      loads and that no error boundary (app/error.tsx or
 *      app/global-error.tsx) is ever rendered.
 *
 * The suite inherits every project from playwright.config.ts, so these
 * assertions run headless on Chromium and Firefox (plus the other
 * configured engines/viewports). The click-through navigation needs the
 * desktop sidebar, so that single test is skipped on phone viewports; the
 * page.goto()-based data tests below it run everywhere.
 */

import { test, expect, type Page, type Route } from '@playwright/test';

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000';

// Name of the HttpOnly session cookie the Next.js verify route sets
// (see app/lib/admin-session.ts). Mirrored here so the mock matches prod.
const SESSION_COOKIE = 'stellar_card_admin_session';

// Strings rendered only by the route-level (app/error.tsx) and root-layout
// (app/global-error.tsx) error boundaries. Seeing any of these means a page
// crashed instead of rendering its data.
const ERROR_BOUNDARY_MARKERS = [
  'Something broke',
  'Something really broke',
  'This is our fault, not yours',
] as const;

// ── Mock data ────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 'user-id-1',
  email: 'owner@example.com',
  role: 'owner',
  is_platform_owner: false,
};

const MOCK_DASHBOARD_INFO = {
  id: 'dash-id-1',
  name: 'Test Dashboard',
  spend_limit_usdc: null,
  frozen: false,
  network: 'mainnet',
  created_at: '2026-04-01T00:00:00Z',
  stats: {
    total_orders: 3,
    total_gmv: 40.5,
    delivered: 1,
    failed: 1,
    refunded: 0,
    pending: 1,
    active_keys: 1,
    pending_approvals: 0,
  },
};

const MOCK_AGENTS = [
  {
    id: 'agent-1',
    label: 'test-agent',
    spend_limit_usdc: '100.00',
    total_spent_usdc: '10.00',
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

const MOCK_ORDERS = [
  {
    id: 'order-0001',
    status: 'delivered',
    amount_usdc: '10.00',
    payment_asset: 'usdc',
    error: null,
    created_at: '2026-04-12T10:00:00Z',
    updated_at: '2026-04-12T10:00:30Z',
    stellar_txid: 'abc123def456',
    card_brand: 'VISA',
    api_key_id: 'agent-1',
    api_key_label: 'test-agent',
  },
  {
    id: 'order-0002',
    status: 'failed',
    amount_usdc: '25.50',
    payment_asset: 'usdc',
    error: 'card_declined',
    created_at: '2026-04-12T11:00:00Z',
    updated_at: '2026-04-12T11:00:05Z',
    stellar_txid: 'def456abc123',
    card_brand: null,
    api_key_id: 'agent-1',
    api_key_label: 'test-agent',
  },
  {
    id: 'order-0003',
    status: 'pending_payment',
    amount_usdc: '5.00',
    payment_asset: 'usdc',
    error: null,
    created_at: '2026-04-12T12:00:00Z',
    updated_at: '2026-04-12T12:00:00Z',
    stellar_txid: null,
    card_brand: null,
    api_key_id: 'agent-1',
    api_key_label: 'test-agent',
  },
];

const MOCK_MERCHANTS = [
  {
    id: 'a6c7a007-016b-4f90-9180-0a173cfeaf57',
    name: 'Visa® eReward Card',
    logo_url: 'https://example.com/visa.png',
    card_image_url: 'https://example.com/visa-card.png',
    country: 'US',
    currency: 'USD',
    min_amount: 5,
    max_amount: 500,
    redeem_location: 'online',
    redeem_type: 'link',
    enabled: true,
    description: 'Prepaid Visa card usable anywhere Visa is accepted online.',
  },
  {
    id: 'b7d8b118-127c-4a01-8291-1b284dfb0a68',
    name: 'Amazon Gift Card',
    logo_url: 'https://example.com/amazon.png',
    card_image_url: 'https://example.com/amazon-card.png',
    country: 'US',
    currency: 'USD',
    min_amount: 10,
    max_amount: 1000,
    redeem_location: 'online',
    redeem_type: 'code',
    enabled: true,
    description: 'Amazon.com gift card redeemable for anything on Amazon.',
  },
];

// ── Mock installation ────────────────────────────────────────────────────────

interface SessionState {
  /** When true, /api/auth/me resolves to MOCK_USER; otherwise it 401s. */
  authenticated: boolean;
}

/**
 * Installs every network mock the dashboard needs. `session.authenticated`
 * is read live by the /api/auth/me handler so the login flow can flip it
 * from the (mocked) verify response, exactly like a real session cookie.
 */
async function installMocks(page: Page, session: SessionState): Promise<void> {
  // Auth — `me` reflects the live session flag; `verify` flips it and drops
  // the HttpOnly session cookie the dashboard's server layer would set.
  await page.route('**/api/auth/me', (route: Route) =>
    session.authenticated
      ? route.fulfill({ status: 200, json: { user: MOCK_USER } })
      : route.fulfill({ status: 401, json: { error: 'unauthorized' } }),
  );
  await page.route('**/api/auth/login', (route: Route) =>
    route.fulfill({ status: 200, json: { ok: true } }),
  );
  await page.route('**/api/auth/verify', async (route: Route) => {
    session.authenticated = true;
    await page.context().addCookies([
      {
        name: SESSION_COOKIE,
        value: 'mock-signed-session-token',
        url: BASE_URL,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await route.fulfill({ status: 200, json: { user: MOCK_USER } });
  });
  await page.route('**/api/auth/logout', (route: Route) => {
    session.authenticated = false;
    return route.fulfill({ status: 200, json: { ok: true } });
  });

  // Admin proxy — bare-array list endpoints vs. wrapped objects, matching
  // the real backend shapes (see _lib/api.ts jsonList normaliser).
  await page.route('**/api/admin-proxy/dashboard', (route: Route) =>
    route.fulfill({ status: 200, json: MOCK_DASHBOARD_INFO }),
  );
  await page.route('**/api/admin-proxy/dashboard/api-keys**', (route: Route) =>
    route.fulfill({ status: 200, json: MOCK_AGENTS }),
  );
  await page.route('**/api/admin-proxy/dashboard/orders**', (route: Route) =>
    route.fulfill({ status: 200, json: MOCK_ORDERS }),
  );
  await page.route('**/api/admin-proxy/dashboard/approval-requests**', (route: Route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('**/api/admin-proxy/dashboard/merchants', (route: Route) =>
    route.fulfill({ status: 200, json: { merchants: MOCK_MERCHANTS } }),
  );
  await page.route('**/api/admin-proxy/dashboard/alert-rules', (route: Route) =>
    route.fulfill({
      status: 200,
      json: { rules: [], available_kinds: [], is_platform_owner: false },
    }),
  );
  await page.route('**/api/admin-proxy/dashboard/alert-firings**', (route: Route) =>
    route.fulfill({ status: 200, json: { firings: [] } }),
  );
  await page.route('**/api/admin-proxy/dashboard/audit-log**', (route: Route) =>
    route.fulfill({ status: 200, json: { entries: [] } }),
  );
  await page.route('**/api/admin-proxy/dashboard/webhook-deliveries**', (route: Route) =>
    route.fulfill({ status: 200, json: { deliveries: [] } }),
  );
  // Only fetched on the Settings page for platform owners; stubbed anyway so
  // the suite stays green if that flag is ever flipped in MOCK_USER.
  await page.route('**/api/admin-proxy/dashboard/platform-wallet', (route: Route) =>
    route.fulfill({ status: 200, json: { public_key: 'GZERO000000000000000000000000000000000000000000000000000', network: 'mainnet' } }),
  );

  // Live SSE stream — attach and immediately end so the provider's reconnect
  // backoff handles it quietly (it just retries on a short timer).
  await page.route('**/api/admin-proxy/dashboard/stream', (route: Route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: ':connected\n\n',
    }),
  );

  // Horizon balance polling — return an empty account so the wallet poller
  // settles on { xlm: '0', usdc: '0' } without erroring.
  await page.route('**horizon.stellar.org/accounts/**', (route: Route) =>
    route.fulfill({ status: 200, json: { balances: [] } }),
  );
}

// ── Error collectors ─────────────────────────────────────────────────────────

/** Mirrors dashboard-smoke's filters: ignore Next dev-server noise. */
function attachErrorCollectors(page: Page): { errors: string[]; consoleErrors: string[] } {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (
      text.includes('[Fast Refresh]') ||
      text.includes('Failed to load resource') ||
      text.includes('Download the React DevTools') ||
      text.includes('hydration')
    ) {
      return;
    }
    consoleErrors.push(text);
  });
  return { errors, consoleErrors };
}

// ── Assertion helpers ────────────────────────────────────────────────────────

/** Fails if any route-level / global error boundary text is on the page. */
async function expectNoErrorBoundary(page: Page): Promise<void> {
  for (const marker of ERROR_BOUNDARY_MARKERS) {
    await expect(
      page.getByText(marker, { exact: false }),
      `unexpected error boundary text "${marker}"`,
    ).toHaveCount(0);
  }
}

/** Clicks a sidebar link (real client-side navigation). Desktop only. */
async function navigateVia(page: Page, label: string): Promise<void> {
  await page
    .locator('.dashboard-sidebar')
    .first()
    .getByRole('link', { name: label, exact: true })
    .click();
}

// ── Login flow ───────────────────────────────────────────────────────────────

test.describe('User login flow', () => {
  test('signs in with an emailed OTP and lands on the dashboard', async ({ page }) => {
    const session: SessionState = { authenticated: false };
    await installMocks(page, session);
    const { errors, consoleErrors } = attachErrorCollectors(page);

    await page.goto('/dashboard/overview');

    // Unauthenticated → AuthGate sign-in splash.
    await expect(page.getByText('Sign in to your operator dashboard')).toBeVisible();

    // Step 1: request a one-time code.
    await page.getByPlaceholder('you@example.com').fill(MOCK_USER.email);
    await page.getByRole('button', { name: 'Send code', exact: true }).click();

    // Step 2: submit the code.
    const codeInput = page.getByPlaceholder('6-digit code');
    await expect(codeInput).toBeVisible();
    await codeInput.fill('123456');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // Verify sets the session cookie and reloads into the dashboard.
    await expect(page.locator('main')).toContainText('Overview', { timeout: 15_000 });
    await expect(page.getByText('Sign in to your operator dashboard')).toHaveCount(0);

    // The mocked session cookie was written to the browser context.
    const cookieNames = (await page.context().cookies()).map((c) => c.name);
    expect(cookieNames).toContain(SESSION_COOKIE);

    await expectNoErrorBoundary(page);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});

// ── Authenticated dashboard navigation + data loading ────────────────────────

test.describe('Dashboard navigation (authenticated session)', () => {
  test.beforeEach(async ({ page, context }) => {
    const session: SessionState = { authenticated: true };
    await installMocks(page, session);
    // Seed the mocked HttpOnly session cookie so the page is treated as
    // signed-in (the "mock session cookies" approach).
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: 'mock-signed-session-token',
        url: BASE_URL,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
  });

  test('navigates Overview → Orders → Merchants → Settings via the sidebar', async ({ page }) => {
    // The desktop sidebar is hidden on phone viewports; skip the
    // click-through there. The goto-based data tests below cover mobile.
    test.skip(
      (page.viewportSize()?.width ?? 1280) <= 768,
      'Desktop sidebar is hidden on mobile viewports',
    );

    const { errors, consoleErrors } = attachErrorCollectors(page);

    // ── Overview ──
    await page.goto('/dashboard/overview');
    await expect(page.locator('main')).toContainText('Overview');
    await expect(page.getByText('Recent activity', { exact: true })).toBeVisible();
    const overviewTable = page.getByRole('table').first();
    await expect(overviewTable).toBeVisible();
    await expect(overviewTable.getByText('Delivered')).toBeVisible();
    await expectNoErrorBoundary(page);

    // ── Orders ──
    await navigateVia(page, 'Orders');
    await expect(page).toHaveURL(/\/dashboard\/orders$/);
    await expect(page.locator('main')).toContainText('Orders');
    const ordersTable = page.getByRole('table').first();
    await expect(ordersTable).toBeVisible();
    // One header row + one row per mocked order.
    await expect(ordersTable.getByRole('row')).toHaveCount(MOCK_ORDERS.length + 1);
    await expect(ordersTable.getByText('Delivered')).toBeVisible();
    await expect(ordersTable.getByText('Failed')).toBeVisible();
    await expect(ordersTable.getByText('$25.50', { exact: true })).toBeVisible();
    await expectNoErrorBoundary(page);

    // ── Merchants ──
    await navigateVia(page, 'Merchants');
    await expect(page).toHaveURL(/\/dashboard\/merchants$/);
    await expect(page.locator('main')).toContainText('Merchants');
    for (const m of MOCK_MERCHANTS) {
      await expect(page.getByText(m.name).first()).toBeVisible();
    }
    await expect(page.getByText('More merchants coming')).toBeVisible();
    await expectNoErrorBoundary(page);

    // ── Settings ──
    await navigateVia(page, 'Settings');
    await expect(page).toHaveURL(/\/dashboard\/settings$/);
    await expect(page.locator('main')).toContainText('Settings');
    await expect(page.getByText('Account', { exact: true })).toBeVisible();
    await expect(page.getByText('Appearance', { exact: true })).toBeVisible();
    await expect(page.getByText(MOCK_USER.email).first()).toBeVisible();
    await expectNoErrorBoundary(page);

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  // ── Per-page data loading (runs on every engine / viewport) ──

  test('loads the orders table without an error boundary', async ({ page }) => {
    const { errors, consoleErrors } = attachErrorCollectors(page);
    await page.goto('/dashboard/orders');
    await expect(page.locator('main')).toContainText('Orders');

    const table = page.getByRole('table').first();
    await expect(table).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(MOCK_ORDERS.length + 1);
    // Column headers prove the full row rendered.
    for (const header of ['Order', 'Agent', 'Amount', 'Asset', 'Status', 'When']) {
      await expect(table.getByText(header, { exact: true })).toBeVisible();
    }
    await expectNoErrorBoundary(page);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('loads the overview recent-activity table without an error boundary', async ({ page }) => {
    const { errors, consoleErrors } = attachErrorCollectors(page);
    await page.goto('/dashboard/overview');
    await expect(page.locator('main')).toContainText('Overview');

    await expect(page.getByText('Recent activity', { exact: true })).toBeVisible();
    const table = page.getByRole('table').first();
    await expect(table).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(MOCK_ORDERS.length + 1);
    await expect(table.getByText('Delivered')).toBeVisible();
    await expectNoErrorBoundary(page);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('loads the merchants grid without an error boundary', async ({ page }) => {
    const { errors, consoleErrors } = attachErrorCollectors(page);
    await page.goto('/dashboard/merchants');
    await expect(page.locator('main')).toContainText('Merchants');

    for (const m of MOCK_MERCHANTS) {
      await expect(page.getByText(m.name).first()).toBeVisible();
    }
    await expect(page.getByText('More merchants coming')).toBeVisible();
    await expectNoErrorBoundary(page);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('loads the settings page without an error boundary', async ({ page }) => {
    const { errors, consoleErrors } = attachErrorCollectors(page);
    await page.goto('/dashboard/settings');
    await expect(page.locator('main')).toContainText('Settings');

    await expect(page.getByText('Account', { exact: true })).toBeVisible();
    await expect(page.getByText('Appearance', { exact: true })).toBeVisible();
    await expect(page.getByText('Notifications', { exact: true })).toBeVisible();
    await expect(page.getByText('Local data', { exact: true })).toBeVisible();
    await expectNoErrorBoundary(page);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});