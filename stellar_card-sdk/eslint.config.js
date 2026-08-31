// ESLint flat config for the SDK — a published TypeScript library that
// ships both a Node entry (src/index.ts) and a browser entry
// (src/browser.ts), so globals cover both environments rather than
// assuming one runtime like the frontend (Next.js) or backend (Node) do.
//
// Uses typescript-eslint's non-type-checked "recommended" ruleset: the
// SDK's tsconfig.json deliberately excludes src/__tests__/**/*.test.ts
// from its program (see tsconfig.json), so a type-aware config would
// need a second, wider tsconfig just for linting. Not worth the added
// complexity for a config this size — flag if the source grows enough
// to want type-aware rules.
'use strict';

// This file is itself linted by the recommended.ts ruleset it configures
// (it matches the generic *.{ts,tsx,mjs,js} lint-staged glob), so its own
// require() calls need the same disable used at the other scoped call
// sites (src/cli.ts, src/client.ts, src/mcp.ts, src/version-check.ts) —
// a CJS flat config can't use ESM imports instead.
/* eslint-disable @typescript-eslint/no-require-imports */
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');
const { noUnusedVars } = require('../eslint.shared.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */

module.exports = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': noUnusedVars,
      // The SDK deliberately types some public surfaces loosely (MCP tool
      // payloads, CLI argv, Horizon/Soroban RPC responses) — banning `any`
      // outright would just push everyone to `as any` casts instead.
      '@typescript-eslint/no-explicit-any': 'off',
      // Left at its typescript-eslint/recommended default (error): the
      // handful of require() call sites (src/cli.ts, src/client.ts,
      // src/mcp.ts, src/version-check.ts) already carry their own scoped
      // `// eslint-disable-next-line @typescript-eslint/no-require-imports`
      // comments, which is the more precise fix — a blanket `off` here
      // would just make those existing comments dead weight.
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
);
