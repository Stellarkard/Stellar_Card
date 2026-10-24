// Shared ESLint rules for the Node-based packages (sdk, backend). Both
// configs used to hand-roll an identical `no-unused-vars` block; this is
// the single place that rule now lives so the two definitions can't drift.
//
// The frontend's eslint.config.mjs is intentionally excluded — it's a
// Next.js flat config built entirely from `eslint-config-next` presets
// with no equivalent hand-written rule to share.
'use strict';

const noUnusedVars = [
  'warn',
  { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
];

module.exports = { noUnusedVars };
