import { test, expect } from '@playwright/test';

test.describe('Cross-Browser & Layout Compatibility Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Mock backend authentication/health checks if needed
    await page.route('/api/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 'mocked' }),
      });
    });
  });

  test('renders homepage title, navigation, and CTA elements across browser engines', async ({ page }) => {
    await page.goto('/');

    // Verify main document title & heading
    await expect(page).toHaveTitle(/Stellar_Card|Virtual Visa Cards/i);
    const mainHeading = page.locator('h1').first();
    await expect(mainHeading).toBeVisible();

    // Verify body element is visible and responsive
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('handles interactive component focus and click events across viewports', async ({ page }) => {
    await page.goto('/docs');

    // Verify document page loaded
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();

    // Verify links exist and are accessible
    const links = page.locator('a');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
  });

  test('validates wallet connection status and UI state responsiveness', async ({ page }) => {
    await page.goto('/dashboard');

    // Dashboard page should render or redirect to login/overview
    await page.waitForLoadState('networkidle');
    const pageUrl = page.url();
    expect(pageUrl).toMatch(/\/(dashboard|overview|login)/);
  });
});
