#!/usr/bin/env node
/**
 * Stellar_Card contract deployment helper — Node.js port of deploy_testnet.sh.
 *
 * This file is deliberately thin: it reads argv, prints, and spawns. Every
 * decision it makes lives in `lib/deploy.mjs` as a pure function, so the logic
 * is covered by `test/tooling.test.mjs` without needing a Soroban toolchain, a
 * funded account, or a network.
 *
 * Usage:
 *   node deploy_testnet.mjs --source <identity> [--network <name>] [--dry-run]
 *   node deploy_testnet.mjs --help
 *
 * Environment variables (used when the matching flag is absent):
 *   SOURCE_ACCOUNT  — identity name or secret key to sign the deployment
 *   NETWORK         — target network (default: testnet)
 *
 * Requires Node >= 18 and the Soroban CLI on PATH.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DeployConfigError,
  buildCommand,
  contractPaths,
  deployCommand,
  formatBanner,
  helpText,
  resolveConfig,
  validateConfig,
} from './lib/deploy.mjs';

// ── Paths ─────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const { contractDir, wasmFile } = contractPaths(projectRoot);

// ── Helpers ───────────────────────────────────────────────────────────────────

function fail(message) {
  console.error(`\n❌ ERROR: ${message}\n`);
  process.exit(1);
}

/** Read the workspace version, for `--version`. Best-effort only. */
function toolingVersion() {
  try {
    const pkgPath = resolve(projectRoot, 'stellar_card-sdk/package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── Configuration ─────────────────────────────────────────────────────────────

let config;
try {
  config = resolveConfig({ argv: process.argv.slice(2), env: process.env });
} catch (error) {
  if (error instanceof DeployConfigError) fail(error.message);
  throw error;
}

// Handled before validation, so `--help` still works when no source account
// is configured — which is exactly when someone reaches for it.
if (config.help) {
  console.log(helpText());
  process.exit(0);
}

if (config.version) {
  console.log(toolingVersion());
  process.exit(0);
}

let warnings = [];
try {
  ({ warnings } = validateConfig(config));
} catch (error) {
  if (error instanceof DeployConfigError) fail(error.message);
  throw error;
}

for (const warning of warnings) {
  console.warn(`⚠️  ${warning}`);
}

// Check the CLI is present before spending a minute on a build that cannot
// then be deployed.
try {
  execFileSync('soroban', ['--version'], { stdio: 'ignore' });
} catch {
  fail(
    'soroban-cli not found. Install it from https://soroban.stellar.org/docs/getting-started/setup',
  );
}

// ── Build ─────────────────────────────────────────────────────────────────────

console.log(formatBanner(config));
console.log('');

console.log('🔨 Building contract...');
const build = buildCommand();
execFileSync(build.file, build.args, { cwd: contractDir, stdio: 'inherit' });

if (!existsSync(wasmFile)) {
  fail(`WASM build succeeded but output not found at:\n  ${wasmFile}`);
}
console.log('✅ Build successful!\n');

// ── Deploy ────────────────────────────────────────────────────────────────────

if (config.dryRun) {
  console.log('⏭  Skipping deployment (--dry-run).');
  console.log(`   WASM ready at: ${wasmFile}`);
  process.exit(0);
}

console.log(`🚀 Deploying to ${config.network}...`);
const deploy = deployCommand({ wasmFile, source: config.source, network: config.network });
const contractId = execFileSync(deploy.file, deploy.args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
}).trim();

if (!contractId) {
  fail('Deployment returned an empty contract ID.');
}

console.log('');
console.log('=============================================');
console.log('✅ Deployment completed successfully!');
console.log(`📍 Contract ID: ${contractId}`);
console.log('=============================================');
console.log('Save this contract ID for initialization and frontend configuration.');
