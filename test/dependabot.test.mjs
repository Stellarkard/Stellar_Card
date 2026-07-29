import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const rootDir = resolve(import.meta.dirname, '..');

describe('Dependabot Security Updates Configuration', () => {
  const dependabotPath = resolve(rootDir, '.github/dependabot.yml');
  const securityWorkflowPath = resolve(rootDir, '.github/workflows/security.yml');

  it('verifies dependabot.yml and security.yml exist', () => {
    expect(existsSync(dependabotPath)).toBe(true);
    expect(existsSync(securityWorkflowPath)).toBe(true);
  });

  it('validates dependabot.yml structure and ecosystem entries', () => {
    const content = readFileSync(dependabotPath, 'utf-8');
    const dependabot = parseYaml(content);

    expect(dependabot.version).toBe(2);
    expect(dependabot.updates).toBeDefined();

    const directories = dependabot.updates.map(u => u.directory);
    const ecosystems = dependabot.updates.map(u => u['package-ecosystem']);

    expect(directories).toContain('/stellar_card-sdk');
    expect(directories).toContain('/stellar_card-backend');
    expect(directories).toContain('/stellar_card-frontend');
    expect(directories).toContain('/stellar_card-contract');
    expect(directories).toContain('/');

    expect(ecosystems).toContain('npm');
    expect(ecosystems).toContain('cargo');
    expect(ecosystems).toContain('github-actions');
    expect(ecosystems).toContain('docker');
  });

  it('enforces conventional commits and reviewers across all dependabot entries', () => {
    const content = readFileSync(dependabotPath, 'utf-8');
    const dependabot = parseYaml(content);

    for (const update of dependabot.updates) {
      expect(update.reviewers).toContain('devpeter999');
      expect(update.schedule.interval).toBe('weekly');
      expect(update['commit-message']).toBeDefined();
    }
  });

  it('validates security.yml workflow audits multiple subpackages', () => {
    const content = readFileSync(securityWorkflowPath, 'utf-8');
    expect(content).toContain('stellar_card-sdk');
    expect(content).toContain('stellar_card-backend');
    expect(content).toContain('stellar_card-frontend');
    expect(content).toContain('stellar_card-contract/Cargo.toml');
  });
});
