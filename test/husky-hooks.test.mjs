import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');

describe('Husky hooks', () => {
  const huskyDir = resolve(rootDir, '.husky');

  it('has commit-msg hook', () => {
    const hookPath = resolve(huskyDir, 'commit-msg');
    expect(existsSync(hookPath)).toBe(true);
  });

  it('has pre-commit hook', () => {
    const hookPath = resolve(huskyDir, 'pre-commit');
    expect(existsSync(hookPath)).toBe(true);
  });

  it('has pre-push hook', () => {
    const hookPath = resolve(huskyDir, 'pre-push');
    expect(existsSync(hookPath)).toBe(true);
  });

  it('commit-msg hook runs commitlint', () => {
    const hookContent = readFileSync(resolve(huskyDir, 'commit-msg'), 'utf-8');
    expect(hookContent).toContain('commitlint');
  });

  it('pre-commit hook runs lint-staged', () => {
    const hookContent = readFileSync(resolve(huskyDir, 'pre-commit'), 'utf-8');
    expect(hookContent).toContain('lint-staged');
  });

  it('pre-push hook runs tests', () => {
    const hookContent = readFileSync(resolve(huskyDir, 'pre-push'), 'utf-8');
    expect(hookContent).toContain('npm test');
  });
});
