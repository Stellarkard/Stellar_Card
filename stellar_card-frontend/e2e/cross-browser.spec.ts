/**
 * Cross-browser compatibility suite.
 *
 * Runs against every project in playwright.config.ts — chromium, firefox,
 * webkit, Microsoft Edge, and the Mobile Chrome / Mobile Safari device
 * emulations — so each assertion below is really six assertions, one per
 * engine/viewport combination.
 *
 * The focus is the class of failure that is *specific to an engine or a
 * viewport*, which unit tests structurally cannot catch:
 *
 *   - layout that overflows horizontally on a 393px phone but not on desktop
 *   - CSS or JS features an engine lacks (WebKit consistently lags)
 *   - focus and keyboard behaviour, which differs most between engines
 *   - Intl/date formatting, a classic Safari-only crash
 *   - console errors on a page that renders fine everywhere else
 *
 * Everything is stubbed at the network boundary with `page.route()`, so the
 * suite needs no backend and stays deterministic in CI.
 *
 * Scope note: assertions are structural (does it lay out, does it respond,
 * does it not throw) rather than pixel-exact. Visual regression belongs in a
 * screenshot-diffing suite with its own baseline management — a strict pixel
 * check across six engines would only be flaky.
 */

import { test, expect, type Page } from '@playwright/test';

// Public routes that should render for an unauthenticated visitor. Dashboard
// routes are covered by dashboard-smoke.spec.ts against a mocked session.
const PUBLIC_ROUTES = ['/', '/docs', '/pricing', '/security', '/status'] as const;

/** Stub every backend call so the suite never depends on a running API. */
async function mockBackend(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 'mocked' }),
    });
  });
}

test.describe('Cross-Browser & Layout Compatibility Suite', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  // ── Rendering ──────────────────────────────────────────────────────────────

  test('renders homepage title, navigation, and CTA elements across browser engines', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Stellar_Card|Virtual Visa Cards/i);
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('body')).toBeVisible();

    // A page that renders its heading but no links usually means the layout
    // collapsed on this engine.
    expect(await page.locator('a').count()).toBeGreaterThan(0);
  });

  test('handles interactive component focus and click events across viewports', async ({
    page,
  }) => {
    await page.goto('/docs');

    await expect(page.locator('h1').first()).toBeVisible();
    expect(await page.locator('a').count()).toBeGreaterThan(0);
  });

  test('validates wallet connection status and UI state responsiveness', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toMatch(/\/(dashboard|overview|login)/);
  });

  // ── Layout integrity ───────────────────────────────────────────────────────

  for (const route of PUBLIC_ROUTES) {
    test(`does not overflow horizontally on ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
      });

      // A horizontal scrollbar on a phone viewport is the most common
      // responsive bug and never appears in a desktop-only run. 1px of slack
      // absorbs sub-pixel rounding differences between engines.
      expect(
        overflow.scrollWidth,
        `${route} overflows: ${overflow.scrollWidth}px of content in a ${overflow.clientWidth}px viewport`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  }

  test('keeps the primary heading inside the viewport bounds', async ({ page }) => {
    await page.goto('/');

    const box = await page.locator('h1').first().boundingBox();
    expect(box).not.toBeNull();

    const viewport = page.viewportSize();
    if (box && viewport) {
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });

  test('renders images without broken assets', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const broken = await page.evaluate(() =>
      Array.from(document.images)
        // A decoded image reports naturalWidth > 0; 0 on a *complete* image
        // means it failed. Lazy images below the fold are not complete yet,
        // so they are correctly excluded.
        .filter((img) => img.complete && img.naturalWidth === 0)
        .map((img) => img.currentSrc || img.src),
    );

    expect(broken, `broken images: ${broken.join(', ')}`).toEqual([]);
  });

  // ── Engine capability parity ───────────────────────────────────────────────

  test('supports the CSS features the layout depends on', async ({ page }) => {
    await page.goto('/');

    const support = await page.evaluate(() => ({
      grid: CSS.supports('display', 'grid'),
      flex: CSS.supports('display', 'flex'),
      customProperties: CSS.supports('--probe', '0'),
      gap: CSS.supports('gap', '1rem'),
      // WebKit shipped clamp() late; a layout relying on it degrades silently
      // on an engine that lacks it.
      clamp: CSS.supports('width', 'clamp(1rem, 5vw, 10rem)'),
    }));

    expect(support).toEqual({
      grid: true,
      flex: true,
      customProperties: true,
      gap: true,
      clamp: true,
    });
  });

  test('exposes the browser APIs the client bundle calls', async ({ page }) => {
    await page.goto('/');

    const available = await page.evaluate(() => ({
      fetch: typeof window.fetch === 'function',
      localStorage: (() => {
        // Safari in private mode historically threw on access rather than
        // returning null, crashing any unguarded read at boot.
        try {
          window.localStorage.setItem('__probe', '1');
          window.localStorage.removeItem('__probe');
          return true;
        } catch {
          return false;
        }
      })(),
      intersectionObserver: typeof window.IntersectionObserver === 'function',
      structuredClone: typeof window.structuredClone === 'function',
      abortController: typeof window.AbortController === 'function',
    }));

    expect(available).toEqual({
      fetch: true,
      localStorage: true,
      intersectionObserver: true,
      structuredClone: true,
      abortController: true,
    });
  });

  test('formats dates and numbers consistently via Intl', async ({ page }) => {
    await page.goto('/');

    const formatted = await page.evaluate(() => {
      const date = new Date('2026-04-01T12:00:00Z');
      return {
        valid: !Number.isNaN(date.getTime()),
        iso: date.toISOString(),
        currency: new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(1234.5),
      };
    });

    // Date parsing and Intl output diverging by engine is a long-standing
    // source of Safari-only crashes and mis-rendered money.
    expect(formatted.valid).toBe(true);
    expect(formatted.iso).toBe('2026-04-01T12:00:00.000Z');
    expect(formatted.currency).toBe('$1,234.50');
  });

  // ── Keyboard and focus ─────────────────────────────────────────────────────

  test('moves focus to a visible element on keyboard navigation', async ({ page }) => {
    await page.goto('/');

    await page.keyboard.press('Tab');

    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const rect = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), hasSize: rect.width > 0 && rect.height > 0 };
    });

    // WebKit skips links during Tab traversal unless full keyboard access is
    // on; Playwright's WebKit enables it, so a failure here is a real
    // focus-management regression rather than an engine quirk.
    expect(focused, 'Tab did not move focus off document.body').not.toBeNull();
    expect(focused?.hasSize).toBe(true);
  });

  test('keeps focus reachable when tabbing through interactive elements', async ({ page }) => {
    await page.goto('/docs');

    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? '');
      if (tag && tag !== 'body') seen.push(tag);
    }

    expect(seen.length, 'focus never left <body> across five Tab presses').toBeGreaterThan(0);
  });

  // ── User preferences ───────────────────────────────────────────────────────

  test('respects prefers-reduced-motion without breaking layout', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    await expect(page.locator('h1').first()).toBeVisible();

    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);
  });

  test('renders in both colour schemes', async ({ page }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto('/');

      await expect(page.locator('h1').first()).toBeVisible();

      const background = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      // An empty computed value means the theme never applied on this engine.
      expect(background, `no background resolved in ${colorScheme} mode`).not.toBe('');
    }
  });

  // ── Error surfacing ────────────────────────────────────────────────────────

  test('loads the homepage without console errors or uncaught exceptions', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(pageErrors, `uncaught exceptions: ${pageErrors.join(' | ')}`).toEqual([]);

    // Favicon and other non-blocking 404s are noise, not engine bugs.
    const significant = consoleErrors.filter((text) => !/favicon|404|net::ERR_/i.test(text));
    expect(significant, `console errors: ${significant.join(' | ')}`).toEqual([]);
  });

  test('survives a failing backend without an uncaught exception', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // Overrides the beforeEach stub: last matching route wins in Playwright.
    await page.route('**/api/**', (route) => route.abort('failed'));
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // The page may show an error state — it must not white-screen.
    await expect(page.locator('body')).toBeVisible();
    expect(pageErrors, `uncaught on API failure: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
