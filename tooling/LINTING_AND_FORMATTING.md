# Linting and formatting

Generic ESLint policy is defined in `tooling/eslint/base.mjs`. Package configs
compose it with their framework plugins, keeping one source for repository
ignores and common rules without forcing framework dependencies on unrelated
packages.

Prettier uses the root `prettier.config.mjs` and `.prettierignore` from every
workspace. In `stellar_card-frontend`, run `npm run lint`, `npm run
format:check`, or `npm run format`.

When adding a package, import the shared ESLint policy into its flat config and
use the root Prettier configuration instead of adding local duplicates.
