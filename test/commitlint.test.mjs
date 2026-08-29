import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');

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
    // commitlint only lives in stellar_card-sdk/node_modules — this is a
    // monorepo with no root package.json/node_modules, so `npx commitlint`
    // can't resolve it from the repo root (see .husky/commit-msg for the
    // full explanation). Invoke the CLI entrypoint the same way that hook
    // does, with NODE_PATH pointing at the sdk's node_modules so the
    // `.commitlintrc.json` extends lookup also resolves.
    const sdkDir = resolve(rootDir, 'stellar_card-sdk');
    const cli = resolve(sdkDir, 'node_modules/@commitlint/cli/lib/cli.js');
    const msg = 'feat(sdk): add new feature\n';
    // Write the commit message to a temp file and use --edit instead of
    // piping, so the test works cross-platform (piping with echo behaves
    // differently on Windows CMD vs POSIX shells).
    const msgFile = join(tmpdir(), `COMMIT_EDITMSG_${Date.now()}`);
    writeFileSync(msgFile, msg, 'utf-8');
    try {
      // Increase timeout since commitlint may take time to resolve config
      execSync(`node ${JSON.stringify(cli)} --edit ${JSON.stringify(msgFile)}`, {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
        env: { ...process.env, NODE_PATH: resolve(sdkDir, 'node_modules') },
      });
    } finally {
      try { unlinkSync(msgFile); } catch { /* temp file cleanup */ }
    }
  });
});
