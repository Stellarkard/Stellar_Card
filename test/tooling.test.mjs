import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DEFAULT_NETWORK,
  DeployConfigError,
  KNOWN_NETWORKS,
  WASM_BASENAME,
  buildCommand,
  contractPaths,
  deployCommand,
  formatBanner,
  helpText,
  maskSecret,
  resolveConfig,
  validateConfig,
} from '../tooling/scripts/lib/deploy.mjs';

const rootDir = resolve(import.meta.dirname, '..');
const scriptsDir = resolve(rootDir, 'tooling/scripts');
const cliPath = resolve(scriptsDir, 'deploy_testnet.mjs');

describe('Deployment tooling — configuration resolution', () => {
  it('falls back to the default network when nothing supplies one', () => {
    const config = resolveConfig({ argv: [], env: {} });
    expect(config.network).toBe(DEFAULT_NETWORK);
    expect(config.source).toBe('');
    expect(config.dryRun).toBe(false);
  });

  it('reads the source account and network from the environment', () => {
    const config = resolveConfig({
      argv: [],
      env: { SOURCE_ACCOUNT: 'alice', NETWORK: 'futurenet' },
    });
    expect(config.source).toBe('alice');
    expect(config.network).toBe('futurenet');
  });

  it('lets a flag override the environment', () => {
    // Precedence matters: someone exporting SOURCE_ACCOUNT for daily use must
    // still be able to deploy as a different identity for one run.
    const config = resolveConfig({
      argv: ['--source', 'bob', '--network', 'local'],
      env: { SOURCE_ACCOUNT: 'alice', NETWORK: 'futurenet' },
    });
    expect(config.source).toBe('bob');
    expect(config.network).toBe('local');
  });

  it('supports the short flag forms', () => {
    const config = resolveConfig({ argv: ['-s', 'alice', '-n', 'local', '-d'], env: {} });
    expect(config.source).toBe('alice');
    expect(config.network).toBe('local');
    expect(config.dryRun).toBe(true);
  });

  it('rejects an unknown flag with guidance instead of a stack trace', () => {
    expect(() => resolveConfig({ argv: ['--nope'], env: {} })).toThrow(DeployConfigError);

    try {
      resolveConfig({ argv: ['--nope'], env: {} });
    } catch (error) {
      // The usage text has to come along, or the user is left guessing.
      expect(error.message).toContain('Usage:');
    }
  });

  it('parses --help and --version before anything else can fail', () => {
    expect(resolveConfig({ argv: ['--help'], env: {} }).help).toBe(true);
    expect(resolveConfig({ argv: ['--version'], env: {} }).version).toBe(true);
  });
});

describe('Deployment tooling — validation', () => {
  it('requires a source account', () => {
    expect(() => validateConfig({ network: 'testnet', source: '' })).toThrow(DeployConfigError);
    expect(() => validateConfig({ network: 'testnet', source: '' })).toThrow(/SOURCE_ACCOUNT/);
  });

  it('accepts a well-known network without warning', () => {
    for (const network of KNOWN_NETWORKS) {
      const { warnings } = validateConfig({ network, source: 'alice' });
      expect(warnings).toEqual([]);
    }
  });

  it('warns about an unrecognised network but does not block it', () => {
    // The Soroban CLI supports arbitrary named networks from its own config,
    // so rejecting one outright would break a legitimate custom setup.
    const { warnings } = validateConfig({ network: 'my-private-net', source: 'alice' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('my-private-net');
  });

  it('rejects an empty network', () => {
    expect(() => validateConfig({ network: '', source: 'alice' })).toThrow(DeployConfigError);
  });
});

describe('Deployment tooling — command construction', () => {
  it('builds the contract with the Soroban CLI', () => {
    expect(buildCommand()).toEqual({ file: 'soroban', args: ['contract', 'build'] });
  });

  it('passes the wasm, source, and network through to deploy', () => {
    const command = deployCommand({
      wasmFile: '/tmp/contract.wasm',
      source: 'alice',
      network: 'testnet',
    });

    expect(command.file).toBe('soroban');
    expect(command.args).toEqual([
      'contract',
      'deploy',
      '--wasm',
      '/tmp/contract.wasm',
      '--source',
      'alice',
      '--network',
      'testnet',
    ]);
  });

  it('passes arguments as an array, never as an interpolated string', () => {
    // execFileSync with an argv array cannot be shell-injected; an identity
    // name containing a space or a quote stays one argument.
    const command = deployCommand({
      wasmFile: '/tmp/my contract.wasm',
      source: "alice'; rm -rf /",
      network: 'testnet',
    });

    expect(command.args).toContain('/tmp/my contract.wasm');
    expect(command.args).toContain("alice'; rm -rf /");
    expect(command.args).toHaveLength(8);
  });

  it('refuses to build a deploy command with missing pieces', () => {
    expect(() => deployCommand({ wasmFile: '', source: 'a', network: 'b' })).toThrow(
      DeployConfigError,
    );
    expect(() => deployCommand({ wasmFile: 'w', source: '', network: 'b' })).toThrow(
      DeployConfigError,
    );
    expect(() => deployCommand({ wasmFile: 'w', source: 'a', network: '' })).toThrow(
      DeployConfigError,
    );
  });
});

describe('Deployment tooling — paths', () => {
  it('resolves the contract directory and wasm artefact from the repo root', () => {
    const { contractDir, wasmFile } = contractPaths('/repo');

    expect(contractDir).toBe('/repo/stellar_card-contract');
    expect(wasmFile).toBe(
      `/repo/stellar_card-contract/target/wasm32-unknown-unknown/release/${WASM_BASENAME}`,
    );
  });

  it('points at a contract directory that actually exists in this repo', () => {
    const { contractDir } = contractPaths(rootDir);
    expect(existsSync(contractDir)).toBe(true);
  });
});

describe('Deployment tooling — output safety', () => {
  it('masks a Stellar secret key in the banner', () => {
    // A secret passed via --source would otherwise be echoed to the terminal
    // and into any CI log that captured stdout.
    const secret = `S${'A'.repeat(55)}`;
    const masked = maskSecret(secret);

    expect(masked).not.toContain(secret);
    expect(masked).toContain('masked');
    expect(formatBanner({ network: 'testnet', source: secret, dryRun: false })).not.toContain(
      secret,
    );
  });

  it('shows an identity name in full', () => {
    // Identity names are not secret, and seeing which one will sign is the
    // reason the line exists.
    expect(maskSecret('alice')).toBe('alice');
    expect(formatBanner({ network: 'testnet', source: 'alice', dryRun: false })).toContain('alice');
  });

  it('handles an empty source without throwing', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret(undefined)).toBe('');
  });

  it('flags dry-run mode in the banner', () => {
    expect(formatBanner({ network: 'testnet', source: 'alice', dryRun: true })).toContain('DRY RUN');
    expect(formatBanner({ network: 'testnet', source: 'alice', dryRun: false })).not.toContain(
      'DRY RUN',
    );
  });
});

describe('Deployment tooling — help text', () => {
  it('documents every flag the parser accepts', () => {
    const text = helpText();

    for (const flag of ['--network', '--source', '--dry-run', '--help', '--version']) {
      expect(text, `${flag} is undocumented`).toContain(flag);
    }
    for (const short of ['-n', '-s', '-d', '-h', '-v']) {
      expect(text).toContain(short);
    }
  });

  it('documents both environment variables', () => {
    const text = helpText();
    expect(text).toContain('SOURCE_ACCOUNT');
    expect(text).toContain('NETWORK');
  });
});

describe('Deployment CLI — end to end', () => {
  it('prints help and exits zero without a source account', () => {
    // The real binary, in a real subprocess — proves the wiring, not just the
    // library. No Soroban CLI or network involved.
    const stdout = execFileSync(process.execPath, [cliPath, '--help'], {
      encoding: 'utf8',
      env: { ...process.env, SOURCE_ACCOUNT: '', NETWORK: '' },
    });

    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('--dry-run');
  });

  it('prints a version and exits zero', () => {
    const stdout = execFileSync(process.execPath, [cliPath, '--version'], {
      encoding: 'utf8',
      env: { ...process.env, SOURCE_ACCOUNT: '', NETWORK: '' },
    });
    expect(stdout.trim()).toMatch(/^(\d+\.\d+\.\d+.*|unknown)$/);
  });

  it('exits non-zero with a clear message when no source account is set', () => {
    let failed = false;
    let stderr = '';

    try {
      execFileSync(process.execPath, [cliPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, SOURCE_ACCOUNT: '', NETWORK: '' },
      });
    } catch (error) {
      failed = true;
      stderr = error.stderr ?? '';
    }

    expect(failed, 'CLI should exit non-zero without a source account').toBe(true);
    expect(stderr).toContain('SOURCE_ACCOUNT');
  });

  it('exits non-zero on an unknown flag', () => {
    let failed = false;
    try {
      execFileSync(process.execPath, [cliPath, '--definitely-not-a-flag'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, SOURCE_ACCOUNT: 'alice' },
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});

describe('Deployment tooling — source layout and docs', () => {
  it('keeps the CLI thin by delegating to the library', () => {
    const cli = readFileSync(cliPath, 'utf8');
    expect(cli).toContain("from './lib/deploy.mjs'");
  });

  it('uses node: prefixed built-in imports throughout', () => {
    for (const file of [cliPath, resolve(scriptsDir, 'lib/deploy.mjs')]) {
      const content = readFileSync(file, 'utf8');
      const bareBuiltins = [...content.matchAll(/from '(?!node:|\.)([a-z_]+)'/g)].map(m => m[1]);
      expect(bareBuiltins, `${file} imports a bare built-in`).toEqual([]);
    }
  });

  it('spawns with execFile rather than a shell', () => {
    const cli = readFileSync(cliPath, 'utf8');

    // `exec`/`execSync` interpolate into a shell, which would make an
    // identity name or path containing shell metacharacters dangerous.
    expect(cli).toContain('execFileSync');
    expect(cli).not.toMatch(/\bexecSync\b/);
  });

  it('documents the Node entry point alongside the shell script', () => {
    const readme = readFileSync(resolve(scriptsDir, 'README.md'), 'utf8');

    // The README previously documented only deploy_testnet.sh, leaving the
    // Node port undiscoverable.
    expect(readme).toContain('deploy_testnet.mjs');
    expect(readme).toContain('--dry-run');
  });
});
