import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');

describe('Cross-Browser Testing Suite Configuration', () => {
  const playwrightConfigPath = resolve(rootDir, 'stellar_card-frontend/playwright.config.ts');
  const crossBrowserSpecPath = resolve(rootDir, 'stellar_card-frontend/e2e/cross-browser.spec.ts');
  const e2eWorkflowPath = resolve(rootDir, '.github/workflows/e2e.yml');

  it('verifies playwright.config.ts and cross-browser spec file exist', () => {
    expect(existsSync(playwrightConfigPath)).toBe(true);
    expect(existsSync(crossBrowserSpecPath)).toBe(true);
    expect(existsSync(e2eWorkflowPath)).toBe(true);
  });

  it('validates playwright.config.ts includes multi-browser and mobile viewport projects', () => {
    const content = readFileSync(playwrightConfigPath, 'utf-8');
    expect(content).toContain("name: 'chromium'");
    expect(content).toContain("name: 'firefox'");
    expect(content).toContain("name: 'webkit'");
    expect(content).toContain("name: 'Mobile Chrome'");
    expect(content).toContain("name: 'Mobile Safari'");
    expect(content).toContain("name: 'Microsoft Edge'");
  });

  it('validates e2e.yml workflow runs multi-browser matrix and installs dependencies', () => {
    const content = readFileSync(e2eWorkflowPath, 'utf-8');
    expect(content).toContain('matrix:');
    expect(content).toContain('chromium');
    expect(content).toContain('firefox');
    expect(content).toContain('webkit');
    expect(content).toContain('Mobile Chrome');
    expect(content).toContain('Mobile Safari');
    expect(content).toContain('npx playwright install --with-deps');
  });

  it('validates cross-browser spec checks page elements across viewports', () => {
    const content = readFileSync(crossBrowserSpecPath, 'utf-8');
    expect(content).toContain('Cross-Browser & Layout Compatibility Suite');
    expect(content).toContain('renders homepage title');
    expect(content).toContain('handles interactive component focus');
  });

  it('asserts responsive layout integrity, not just that a page rendered', () => {
    const content = readFileSync(crossBrowserSpecPath, 'utf-8');

    // Horizontal overflow is the defining mobile-viewport regression and is
    // invisible to a desktop-only run.
    expect(content).toContain('does not overflow horizontally');
    expect(content).toContain('scrollWidth');
    expect(content).toContain('clientWidth');
    expect(content).toContain('boundingBox');
  });

  it('probes engine capability parity for CSS and JS features', () => {
    const content = readFileSync(crossBrowserSpecPath, 'utf-8');

    expect(content).toContain('CSS.supports');
    expect(content).toContain('IntersectionObserver');
    expect(content).toContain('structuredClone');
    expect(content).toContain('localStorage');
    // Intl/date divergence is a recurring Safari-only failure.
    expect(content).toContain('Intl.NumberFormat');
  });

  it('covers keyboard focus behaviour, which differs most between engines', () => {
    const content = readFileSync(crossBrowserSpecPath, 'utf-8');

    expect(content).toContain("keyboard.press('Tab')");
    expect(content).toContain('document.activeElement');
  });

  it('covers user preference media queries', () => {
    const content = readFileSync(crossBrowserSpecPath, 'utf-8');

    expect(content).toContain('reducedMotion');
    expect(content).toContain('colorScheme');
  });

  it('fails the run on console errors and uncaught exceptions', () => {
    const content = readFileSync(crossBrowserSpecPath, 'utf-8');

    // A page can render correctly and still throw on one engine only.
    expect(content).toContain("page.on('pageerror'");
    expect(content).toContain("page.on('console'");
  });

  it('exercises a failing backend as well as a healthy one', () => {
    const content = readFileSync(crossBrowserSpecPath, 'utf-8');
    expect(content).toContain("route.abort('failed')");
  });

  it('covers more than one public route', () => {
    const content = readFileSync(crossBrowserSpecPath, 'utf-8');

    const routes = content.match(/PUBLIC_ROUTES = \[(.*?)\]/s);
    expect(routes, 'expected a PUBLIC_ROUTES list').not.toBeNull();
    // A single-route suite cannot catch a regression scoped to one page.
    expect(routes[1].split(',').filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });
});

describe('Playwright project matrix', () => {
  const playwrightConfigPath = resolve(rootDir, 'stellar_card-frontend/playwright.config.ts');
  const e2eWorkflowPath = resolve(rootDir, '.github/workflows/e2e.yml');

  it('keeps the CI matrix and the Playwright projects in sync', () => {
    const config = readFileSync(playwrightConfigPath, 'utf-8');
    const workflow = readFileSync(e2eWorkflowPath, 'utf-8');

    // A project defined but not in the matrix never runs in CI; a matrix
    // entry with no project fails with "no tests found". Either way the
    // divergence is silent, so pin both ends here.
    const projects = [...config.matchAll(/name: '([^']+)'/g)].map(m => m[1]);
    expect(projects.length).toBeGreaterThanOrEqual(6);

    for (const project of projects) {
      expect(workflow, `project '${project}' is not in the CI matrix`).toContain(project);
    }
  });

  it('retries in CI so a flaky engine does not fail the build outright', () => {
    const config = readFileSync(playwrightConfigPath, 'utf-8');
    expect(config).toContain('retries:');
    expect(config).toContain('process.env.CI');
  });
});
