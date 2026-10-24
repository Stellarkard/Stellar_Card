import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');

describe('Project READMEs and Contributor Guides', () => {
  const rootReadmePath = resolve(rootDir, 'README.md');
  const contributingPath = resolve(rootDir, 'CONTRIBUTING.md');
  const backendReadmePath = resolve(rootDir, 'stellar_card-backend/README.md');
  const frontendReadmePath = resolve(rootDir, 'stellar_card-frontend/README.md');
  const contractReadmePath = resolve(rootDir, 'stellar_card-contract/README.md');
  const sdkReadmePath = resolve(rootDir, 'stellar_card-sdk/README.md');

  it('verifies that all subproject READMEs exist', () => {
    expect(existsSync(rootReadmePath)).toBe(true);
    expect(existsSync(contributingPath)).toBe(true);
    expect(existsSync(backendReadmePath)).toBe(true);
    expect(existsSync(frontendReadmePath)).toBe(true);
    expect(existsSync(contractReadmePath)).toBe(true);
    expect(existsSync(sdkReadmePath)).toBe(true);
  });

  it('root README contains project layout, docker, testing and dependabot info', () => {
    const content = readFileSync(rootReadmePath, 'utf-8');
    expect(content).toContain('stellar_card-backend/README.md');
    expect(content).toContain('stellar_card-frontend/README.md');
    expect(content).toContain('stellar_card-contract/README.md');
    expect(content).toContain('stellar_card-sdk/README.md');
    expect(content).toContain('docker compose');
    expect(content).toContain('Cross-Browser');
    expect(content).toContain('Dependabot');
  });

  it('CONTRIBUTING.md includes Docker, cross-browser, Dependabot, and branch guidelines', () => {
    const content = readFileSync(contributingPath, 'utf-8');
    expect(content).toContain('Docker');
    expect(content).toContain('playwright');
    expect(content).toContain('Dependabot');
    expect(content).toContain('feature/docs-task-46');
    expect(content).toContain('Closes #N');
  });

  it('backend README documents environment variables, endpoints, and setup', () => {
    const content = readFileSync(backendReadmePath, 'utf-8');
    expect(content).toContain('Environment Variables');
    expect(content).toContain('PORT');
    expect(content).toContain('API Endpoints');
    expect(content).toContain('Testing');
  });

  it('frontend README documents testing, storybook, and docker', () => {
    const content = readFileSync(frontendReadmePath, 'utf-8');
    expect(content).toContain('Testing & Cross-Browser QA');
    expect(content).toContain('storybook');
    expect(content).toContain('Docker');
  });

  it('contract README documents testing and dependabot', () => {
    const content = readFileSync(contractReadmePath, 'utf-8');
    expect(content).toContain('Testing & Verification');
    expect(content).toContain('Dependabot');
  });
});
