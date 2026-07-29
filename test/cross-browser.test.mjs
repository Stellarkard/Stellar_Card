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
});
