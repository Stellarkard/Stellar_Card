import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const rootDir = resolve(import.meta.dirname, '../..');

describe('commitlint configuration', () => {
  const configPath = resolve(rootDir, '.commitlintrc.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  it('extends @commitlint/config-conventional', () => {
    expect(config.extends).toContain('@commitlint/config-conventional');
  });

  it('allows conventional commit types', () => {
    const allowedTypes = config.rules['type-enum'][2];
    expect(allowedTypes).toContain('feat');
    expect(allowedTypes).toContain('fix');
    expect(allowedTypes).toContain('docs');
    expect(allowedTypes).toContain('test');
    expect(allowedTypes).toContain('chore');
    expect(allowedTypes).toContain('ci');
    expect(allowedTypes).toContain('build');
  });

  it('enforces header max length of 100', () => {
    const maxLength = config.rules['header-max-length'][2];
    expect(maxLength).toBe(100);
  });

  it('rejects empty subjects', () => {
    const rule = config.rules['subject-empty'];
    expect(rule[0]).toBe(2);
    expect(rule[1]).toBe('never');
  });

  it('validates a correct commit message via CLI', () => {
    const result = execSync('echo "feat(sdk): add new feature" | npx --no -- commitlint', {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(result).toBeTruthy();
  });
});
