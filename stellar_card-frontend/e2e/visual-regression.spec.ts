/**
 * Dashboard visual-regression suite.
 *
 * Captures golden screenshots of the dashboard's three most-viewed screens —
 * Overview, Orders and Settings — and diffs every later run against them with
 * Playwright's pixelmatch comparator, so an unintended CSS or layout change
 * fails loudly instead of shipping unnoticed.
 *
 * Determinism: a screenshot is only a useful baseline if the same input always
 * produces the same pixels. Everything volatile is therefore either pinned
 * before the page boots (theme + first-run onboarding flag in localStorage)
 * or excluded from the comparison with `mask:` — the relative "2d ago" strings
 * `timeAgo()` renders, and the order-id fragments that are random UUIDs
 * against the real backend.
 *
 * Opt-in: a pixel diff is only meaningful once reviewed baselines exist, and
 * running without them fails on the missing golden file. The suite therefore
 * skips unless `PW_VISUAL=1`, and baselines are captured on the `chromium`
 * project only (font rasterisation differs enough between engines that a
 * multi-engine pixel diff is flaky by construction — see the note in
 * cross-browser.spec.ts).
 *
 *   Capture / refresh baselines:
 *     PW_VISUAL=1 npx playwright test e2e/visual-regression.spec.ts \
 *       --project=chromium --update-snapshots
 *   Compare against them:
 *     PW_VISUAL=1 npx playwright test e2e/visual-regression.spec.ts --project=chromium
 */

import { test, expect, type Page, type Route } from '@playwright/test';

// ── Shared fixtures ──────────────────────────────────────────────────────────
// Data mirrors the mocked backend used by dashboard-smoke.spec.ts so the two
// suites exercise the pages against the same payload shapes.

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

const MOCK_ORDERS = [
  {
    id: 'order-1',
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
];

const MOCK_MERCHANT = {
  id: 'a6c7a007-016b-4f90-9180-0a173cfeaf57',
  name: 'Visa® eReward Card',
  logo_url: 'https://example.com/logo.png',
  card_image_url: 'https://example.com/card.png',
  country: 'US',
  currency: 'USD',
  discount_pct: 4.5,
  min_amount: 5,
  max_amount: 500,
  redeem_location: 'online',
  redeem_type: 'link',
  enabled: true,
  description: 'Test merchant',
};

const MOCK_ALERT_RULE = {
  id: 'rule-1',
  dashboard_id: 'dash-id-1',
  name: 'Test rule',
  kind: 'ctx_auth_dead',
  config: {},
  enabled: true,
  snoozed_until: null,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};

const MOCK_AUDIT_ENTRY = {
  id: 1,
  dashboard_id: 'dash-id-1',
  actor_user_id: 'user-id-1',
  actor_email: 'owner@example.com',
  actor_role: 'owner',
  action: 'agent.create',
  resource_type: 'agent',
  resource_id: 'agent-1',
  details: { label: 'test-agent' },
  ip: '127.0.0.1',
  user_agent: 'visual-regression-test',
  created_at: '2026-04-13T12:00:00Z',
};

const MOCK_WEBHOOK_DELIVERY = {
  id: 1,
  dashboard_id: 'dash-id-1',
  api_key_id: 'agent-1',
  url: 'https://example.com/webhook',
  method: 'POST',
  request_body: { order_id: 'order-1', status: 'delivered' },
  response_status: 200,
  response_body: '{"ok":true}',
  latency_ms: 45,
  error: null,
  signature: 'sha256=abc123',
  created_at: '2026-04-13T12:00:00Z',
};

// ── Mock installation ────────────────────────────────────────────────────────
// Every endpoint DashboardProvider and the dashboard shell reach for is stubbed
// so the suite needs no backend and no network — the same technique the smoke
// and a11y suites use.

async function installMocks(page: Page) {
  await page.route('**/api/auth/me', (route: Route) =>
    route.fulfill({ status: 200, json: { user: MOCK_USER } }),
  );
  await page.route('**/api/auth/logout', (route: Route) =>
    route.fulfill({ status: 200, json: { ok: true } }),
  );

  await page.route('**/api/admin-proxy/dashboard', (route: Route) =>
    route.fulfill({ status: 200, json: MOCK_DASHBOARD_INFO }),
  );
  // The three legacy list endpoints return bare arrays (not wrapped objects).
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
    route.fulfill({ status: 200, json: { merchants: [MOCK_MERCHANT] } }),
  );
  await page.route('**/api/admin-proxy/dashboard/alert-rules', (route: Route) =>
    route.fulfill({ status: 200, json: { rules: [MOCK_ALERT_RULE] } }),
  );
  await page.route('**/api/admin-proxy/dashboard/alert-firings**', (route: Route) =>
    route.fulfill({ status: 200, json: { firings: [] } }),
  );
  await page.route('**/api/admin-proxy/dashboard/audit-log**', (route: Route) =>
    route.fulfill({ status: 200, json: { entries: [MOCK_AUDIT_ENTRY] } }),
  );
  await page.route('**/api/admin-proxy/dashboard/webhook-deliveries**', (route: Route) =>
    route.fulfill({ status: 200, json: { deliveries: [MOCK_WEBHOOK_DELIVERY] } }),
  );

  // SSE stream — attach and end immediately; the dashboard's reconnect backoff
  // fires on a 2s timer the test never waits for, and the empty body carries no
  // `data:` line so it can't trigger a mid-screenshot refetch.
  await page.route('**/api/admin-proxy/dashboard/stream', (route: Route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: ':connected\n\n',
    }),
  );

  // Horizon balance polling for the agent's wallet — return an empty account.
  await page.route('**horizon.stellar.org/accounts/**', (route: Route) =>
    route.fulfill({ status: 200, json: { balances: [] } }),
  );
}

// ── Determinism helpers ──────────────────────────────────────────────────────

// PW_VISUAL gates the whole suite: pixel diffs require reviewed, committed
// baselines, so a fresh checkout (or CI, before the PNGs land) must not fail
// on missing golden files. See the file docstring + README for both commands.
const VISUAL_ENABLED = process.env.PW_VISUAL === '1';

// `timeAgo()` output, e.g. "just now", "12m ago", "7mo ago". The exact value
// depends on when the suite runs, so any element carrying one is masked rather
// than compared.
const RELATIVE_TIME = /^(just now|\d+(?:s|m|h|d|mo|y) ago)$/;

const THEME_STORAGE_KEY = 'stellar_card.theme';
const ONBOARDING_STORAGE_KEY = 'sc_onboarding_done';

/**
 * Pin the browser-local state the shell reads on boot, before any page script
 * runs (`addInitScript` re-applies on every navigation):
 *   · the first-run onboarding modal never opens — it would cover the very
 *     pixels under test;
 *   · the colour theme is fixed to dark rather than inherited from the host,
 *     so a machine with a light OS preference still matches the baseline.
 */
async function primeDeterministicStorage(page: Page) {
  await page.addInitScript(
    ({ themeKey, onboardingKey }) => {
      window.localStorage.setItem(onboardingKey, '1');
      window.localStorage.setItem(themeKey, 'dark');
    },
    { themeKey: THEME_STORAGE_KEY, onboardingKey: ONBOARDING_STORAGE_KEY },
  );
}

/**
 * Stub the backend, pin local state, navigate, and wait until the page has
 * fully settled — so the screenshot can never race a late render.
 */
async function openDashboard(page: Page, path: string, heading: RegExp) {
  await installMocks(page);
  await primeDeterministicStorage(page);

  await page.goto(path);

  // DashboardProvider authenticates, then fans out to four endpoints in
  // parallel; the lazy-loaded spend chart fetches its own chunk afterwards.
  // `networkidle` waits for all of it, and the heading doubles as a gate so we
  // never screenshot the centered "Loading…" splash.
  await page.waitForLoadState('networkidle', { timeout: 10_000 });
  await expect(page.locator('main')).toContainText(heading, { timeout: 5_000 });

  // The spend chart is its own chunk; wait for the placeholder to give way so
  // the shot can't capture a half-rendered card.
  await expect(page.getByText(/Loading chart/)).toHaveCount(0);

  // Park the cursor off-canvas — a stray hover on a nav item or row would bake
  // hover styling into the baseline.
  await page.mouse.move(-1, -1);
}

// ── Visual regression ────────────────────────────────────────────────────────

test.describe('Dashboard visual regression', () => {
  test.beforeEach(() => {
    // Baselines are keyed by project name ("<name>-<projectName>-<platform>.png"),
    // so every extra engine would need its own baseline; capture on Chromium.
    test.skip(
      test.info().project.name !== 'chromium',
      'Visual baselines are captured on the chromium project only',
    );
    // Opt-in — see the file docstring and README for the baseline commands.
    test.skip(!VISUAL_ENABLED, 'Visual regression is opt-in — run with PW_VISUAL=1 (see README)');
  });

  test('overview', async ({ page }) => {
    await openDashboard(page, '/dashboard/overview', /Overview/);

    await expect(page).toHaveScreenshot('overview.png', {
      animations: 'disabled',
      mask: [
        // Page subtitle: "<dashboard name> · created <relative time>".
        page.getByText(/· created /),
        // "When" column of the Recent activity table.
        page.getByText(RELATIVE_TIME),
      ],
    });
  });

  test('orders', async ({ page }) => {
    await openDashboard(page, '/dashboard/orders', /Orders/);

    await expect(page).toHaveScreenshot('orders.png', {
      animations: 'disabled',
      mask: [
        // "Order" column — the first 8 characters of a backend order id (a
        // random UUID against the real backend).
        page.locator('table tbody tr td:first-child'),
        // "When" column — a relative timestamp.
        page.getByText(RELATIVE_TIME),
      ],
    });
  });

  test('settings', async ({ page }) => {
    await openDashboard(page, '/dashboard/settings', /Settings/);

    await expect(page).toHaveScreenshot('settings.png', {
      animations: 'disabled',
      mask: [
        // "Member since" value — a relative timestamp.
        page.getByText(RELATIVE_TIME),
      ],
    });
  });
});
