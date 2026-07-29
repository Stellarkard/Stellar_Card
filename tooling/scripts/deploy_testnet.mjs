#!/usr/bin/env node
/**
 * Stellar_Card contract deployment helper — Node.js port of deploy_testnet.sh.
 *
 * Uses modern Node.js built-ins (util.parseArgs, node:fs/promises, import.meta)
 * so no additional dependencies are required beyond Node 18+.
 *
 * Usage:
 *   node deploy_testnet.mjs [--network <name>] [--source <identity>] [--dry-run]
 *
 * Environment variables (fall-through from CLI flags):
 *   SOURCE_ACCOUNT  — identity name or secret key to sign the deployment
 *   NETWORK         — target network (default: testnet)
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// ── Argument parsing ──────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    network:  { type: 'string',  short: 'n' },
    source:   { type: 'string',  short: 's' },
    'dry-run': { type: 'boolean', short: 'd', default: false },
  },
  strict: true,
});

const network = args.network ?? process.env.NETWORK ?? 'testnet';
const source  = args.source  ?? process.env.SOURCE_ACCOUNT ?? '';
const dryRun  = args['dry-run'];

// ── Validation ────────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\n❌ ERROR: ${msg}\n`);
  process.exit(1);
}

if (!source) {
  fail(
    'No source account supplied.\n' +
    '  Pass --source <identity> or set the SOURCE_ACCOUNT environment variable.\n' +
    '  Example: node deploy_testnet.mjs --source alice',
  );
}

// Verify soroban CLI is available.
try {
  execFileSync('soroban', ['--version'], { stdio: 'ignore' });
} catch {
  fail('soroban-cli not found. Install it from https://soroban.stellar.org/docs/getting-started/setup');
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const here        = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const contractDir = resolve(projectRoot, 'stellar_card-contract');
const wasmFile    = resolve(contractDir, 'target', 'wasm32-unknown-unknown', 'release', 'stellar_card_receiver.wasm');

// ── Build ─────────────────────────────────────────────────────────────────────

console.log('=============================================');
console.log('   Stellar_Card Contract Deployment Script   ');
console.log('=============================================');
console.log(`Network : ${network}`);
console.log(`Source  : ${source}`);
if (dryRun) console.log('Mode    : DRY RUN (skip actual deploy)');
console.log('');

console.log('🔨 Building contract...');
execFileSync('soroban', ['contract', 'build'], {
  cwd: contractDir,
  stdio: 'inherit',
});

if (!existsSync(wasmFile)) {
  fail(`WASM build succeeded but output not found at:\n  ${wasmFile}`);
}
console.log('✅ Build successful!\n');

// ── Deploy ────────────────────────────────────────────────────────────────────

if (dryRun) {
  console.log('⏭  Skipping deployment (--dry-run).');
  console.log(`   WASM ready at: ${wasmFile}`);
  process.exit(0);
}

console.log(`🚀 Deploying to ${network}...`);
const contractId = execFileSync(
  'soroban',
  ['contract', 'deploy', '--wasm', wasmFile, '--source', source, '--network', network],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
).trim();

if (!contractId) {
  fail('Deployment returned an empty contract ID.');
}

console.log('');
console.log('=============================================');
console.log('✅ Deployment completed successfully!');
console.log(`📍 Contract ID: ${contractId}`);
console.log('=============================================');
console.log('Save this contract ID for initialization and frontend configuration.');
