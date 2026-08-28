#!/usr/bin/env node
/**
 * Pre-publish package verification.
 *
 * Runs `npm pack --dry-run --json` and asserts that the tarball npm would
 * publish to the registry:
 *   - includes every required entry point and metadata file,
 *   - excludes source, tests, and tooling that should never ship,
 *   - stays under a sane size budget.
 *
 * Wired into `prepublishOnly` and the publish workflow so a broken `files`
 * field or an accidentally-bloated bundle fails the release before it reaches
 * npm rather than after. Dependency-free — only uses `npm` and Node built-ins.
 */
import { execFileSync } from 'node:child_process';

// Files that MUST be present in the published tarball.
const REQUIRED = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/browser.js',
  'dist/browser.d.ts',
  'dist/mcp.js',
  'dist/cli.js',
];

// Patterns that must NOT appear in the published tarball.
const FORBIDDEN = [
  /(^|\/)src\//,
  /(^|\/)scripts\//,
  /(^|\/)__tests__\//,
  /\.test\.(t|j)s$/,
  /(^|\/)tsconfig.*\.json$/,
  /(^|\/)vitest\.config\./,
  /(^|\/)\.github\//,
];

// Size budget for the unpacked package (KB). Generous, but catches a bundle
// that suddenly balloons (e.g. a stray dependency or source-map regression).
const MAX_UNPACKED_KB = 1024;

function pack() {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('npm pack produced no manifest');
  }
  return parsed[0];
}

const manifest = pack();
const files = (manifest.files ?? []).map((f) => f.path.replace(/\\/g, '/'));
const errors = [];

for (const req of REQUIRED) {
  if (!files.includes(req)) errors.push(`missing required file: ${req}`);
}

for (const file of files) {
  for (const pattern of FORBIDDEN) {
    if (pattern.test(file)) errors.push(`forbidden file included: ${file} (matched ${pattern})`);
  }
}

const unpackedKb = (manifest.unpackedSize ?? 0) / 1024;
if (unpackedKb > MAX_UNPACKED_KB) {
  errors.push(
    `unpacked size ${unpackedKb.toFixed(1)} KB exceeds budget of ${MAX_UNPACKED_KB} KB`,
  );
}

if (errors.length > 0) {
  console.error('✖ Package verification failed:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\nRun `npm run build` first, then re-check the `files` field in package.json.');
  process.exit(1);
}

console.log(
  `✓ Package OK — ${files.length} files, ` +
    `${unpackedKb.toFixed(1)} KB unpacked (budget ${MAX_UNPACKED_KB} KB).`,
);
