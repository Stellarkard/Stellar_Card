#!/usr/bin/env node
/**
 * Guard the browser entry point (`src/browser.ts`) against accidentally
 * pulling Node.js built-ins into the browser bundle.
 *
 * The browser build must stay free of `fs`, `os`, `path`, `crypto`, native
 * binaries, etc. Bundlers silently fall back to (large) polyfills or fail at
 * runtime when these leak in, so we statically walk the import graph reachable
 * from `src/browser.ts` and fail the build if any reachable module imports a
 * forbidden module.
 *
 * This is intentionally dependency-free (regex-based) so it can run in CI
 * without installing a bundler.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');
const srcDir = resolve(pkgDir, 'src');
const ENTRY = resolve(srcDir, 'browser.ts');

// The `browser` field in package.json declares modules that bundlers replace
// with empty stubs for browser builds. Anything mapped to `false` there is
// intentionally excluded, so we must not follow it (local module) or flag it
// (built-in). This guard's real job is to ensure every Node-only thing the
// browser graph touches is covered by one of these stubs.
const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));
const browserField = pkg.browser ?? {};
const stubbedBuiltins = new Set();
const stubbedLocals = new Set(); // resolved src/*.ts paths mapped to false
for (const [key, value] of Object.entries(browserField)) {
  if (value !== false) continue;
  if (key.startsWith('./dist/')) {
    // ./dist/config.js -> <srcDir>/config.ts
    stubbedLocals.add(resolve(srcDir, key.slice('./dist/'.length).replace(/\.js$/, '.ts')));
  } else {
    stubbedBuiltins.add(key);
  }
}

// Node.js built-in modules that must never reach the browser bundle.
const FORBIDDEN = new Set([
  'fs',
  'os',
  'path',
  'crypto',
  'child_process',
  'net',
  'tls',
  'dns',
  'http',
  'https',
  'http2',
  'cluster',
  'worker_threads',
  'readline',
  'repl',
  'vm',
  'module',
  'perf_hooks',
  'inspector',
]);

// Match the specifier of `import ... from 'x'`, `export ... from 'x'`, and
// `import('x')`/`require('x')`.
const SPECIFIER_RE =
  /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Resolve a relative TS import to an on-disk path (adding `.ts`/index). */
function resolveLocal(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, resolve(base, 'index.ts')]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Strip the `node:` prefix and any subpath so `node:fs/promises` → `fs`. */
function bareModule(spec) {
  return spec.replace(/^node:/, '').split('/')[0];
}

const visited = new Set();
const violations = [];

function walk(file) {
  if (visited.has(file)) return;
  visited.add(file);

  const source = readFileSync(file, 'utf8');
  let match;
  SPECIFIER_RE.lastIndex = 0;
  while ((match = SPECIFIER_RE.exec(source)) !== null) {
    const spec = match[1] ?? match[2];
    if (!spec) continue;

    if (spec.startsWith('.')) {
      const target = resolveLocal(file, spec);
      // Skip modules the package.json `browser` field stubs out — bundlers
      // replace them with empty modules, so their Node deps never ship.
      if (target && !stubbedLocals.has(target)) walk(target);
      continue;
    }

    const bare = bareModule(spec);
    if (spec.startsWith('node:') || FORBIDDEN.has(bare)) {
      if (stubbedBuiltins.has(bare)) continue; // explicitly stubbed for browser
      violations.push({ file: relative(srcDir, file), spec });
    }
  }
}

walk(ENTRY);

if (violations.length > 0) {
  console.error('✖ Browser entry pulls in Node.js-only modules:\n');
  for (const v of violations) {
    console.error(`  ${v.file} imports "${v.spec}"`);
  }
  console.error(
    '\nThe browser build must not depend on Node built-ins. Move the offending\n' +
      'code out of the src/browser.ts import graph (Node-only entry points are\n' +
      'fine in src/index.ts).',
  );
  process.exit(1);
}

console.log(
  `✓ Browser entry is clean — ${visited.size} modules reachable from ` +
    `src/browser.ts, no Node.js built-ins.`,
);
