// ESLint flat config for the backend — a CommonJS Express/Node service.
//
// Kept intentionally close in spirit to the frontend's eslint.config.mjs
// (same ESLint major version, `defineConfig` usage) but scoped for a Node
// runtime instead of Next.js: no browser globals, no JSX/React rules, CJS
// `require`/`module.exports` allowed everywhere.
'use strict';

const { defineConfig, globalIgnores } = require('eslint/config');
const js = require('@eslint/js');
const globals = require('globals');
const { noUnusedVars } = require('../eslint.shared.cjs');

module.exports = defineConfig([
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Prefix with `_` to intentionally mark a param/binding as unused
      // (common in Express middleware signatures like `(err, req, res, next)`).
      'no-unused-vars': noUnusedVars,
      'no-console': 'off',
      // `catch (_) {}` is the established idiom here for intentionally
      // swallowing "already applied" errors in idempotent SQLite migrations
      // (src/db.js) and best-effort maintenance statements — not a mistake.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Several security-sanitization helpers (src/lib/email.js,
      // src/lib/hmac.js, src/api/dashboard.js) deliberately match ASCII
      // control characters (\x00-\x1f) to strip header/log injection
      // vectors. That's the intended use of this pattern, not a bug.
      'no-control-regex': 'off',
    },
  },
  globalIgnores(['node_modules/**', 'coverage/**', '*.db', '*.db-shm', '*.db-wal']),
]);
