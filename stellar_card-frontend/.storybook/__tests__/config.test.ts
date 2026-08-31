// Guards the Storybook configuration itself, not a component.
//
// Regression coverage for a real incident: @storybook/addon-essentials and
// @storybook/blocks were pinned at v8.6.14 while every other @storybook/*
// package (and `storybook` itself) was on v10.4.6. That version skew makes
// `npm ci` fail outright with an ERESOLVE peer-dependency conflict, since
// addon-essentials@8.6.x requires storybook@^8.6.14. It also left
// `test:storybook` invoking the uninstalled `@storybook/test-runner` CLI
// instead of the Vitest-based `@storybook/addon-vitest` integration that is
// actually configured in vitest.config.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

const mainConfigSource = readFileSync(path.join(repoRoot, '.storybook/main.ts'), 'utf-8');

function majorVersion(range: string): string {
  const match = range.match(/(\d+)/);
  if (!match) throw new Error(`Could not parse a major version out of "${range}"`);
  return match[1];
}

describe('storybook devDependencies', () => {
  it('does not reinstate @storybook/addon-essentials or @storybook/blocks (Storybook 9+ folds them into core/addon-docs, and they only publish up to v8.6.x)', () => {
    expect(pkg.devDependencies).not.toHaveProperty('@storybook/addon-essentials');
    expect(pkg.devDependencies).not.toHaveProperty('@storybook/blocks');
  });

  it('keeps every @storybook/* package that ships on the core release train on the same major version as `storybook` itself', () => {
    // Packages released as part of Storybook's own monorepo (unlike
    // third-party addons such as @storybook/addon-mcp or @chromatic-com/storybook,
    // which version independently) must match the core `storybook` major, or npm
    // install fails on a peer-dependency conflict like the addon-essentials
    // incident this test guards against.
    const coreReleaseTrainPackages = [
      '@storybook/addon-a11y',
      '@storybook/addon-docs',
      '@storybook/addon-links',
      '@storybook/addon-vitest',
      '@storybook/nextjs-vite',
      '@storybook/react',
      '@storybook/react-vite',
      'eslint-plugin-storybook',
    ];

    const expectedMajor = majorVersion(pkg.devDependencies.storybook);

    const mismatched = coreReleaseTrainPackages
      .filter((name) => name in pkg.devDependencies)
      .filter((name) => majorVersion(pkg.devDependencies[name]) !== expectedMajor)
      .map((name) => `${name}@${pkg.devDependencies[name]}`);

    expect(mismatched).toEqual([]);
  });

  it('lists every addon referenced by .storybook/main.ts as an installed devDependency', () => {
    const referencedAddons = [...mainConfigSource.matchAll(/'(@storybook\/[a-z0-9-]+)'/g)].map((m) => m[1]);

    expect(referencedAddons.length).toBeGreaterThan(0);
    for (const addon of referencedAddons) {
      expect(pkg.devDependencies).toHaveProperty(addon);
    }
  });
});

describe('storybook test scripts', () => {
  it('runs story tests through the installed Vitest addon, not the uninstalled test-storybook CLI', () => {
    expect(pkg.scripts['test:storybook']).not.toBe('test-storybook');
    expect(pkg.scripts['test:storybook']).toContain('vitest');
    expect(pkg.devDependencies).not.toHaveProperty('@storybook/test-runner');
  });

  it('points test:storybook at the "storybook" vitest project defined in vitest.config.ts', () => {
    expect(pkg.scripts['test:storybook']).toContain('--project=storybook');
  });
});
