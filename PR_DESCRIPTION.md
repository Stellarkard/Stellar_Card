<<<<<<< HEAD
# General Improvements: Documentation, Docker Compose, Cross-Browser Testing, and Dependabot Security (Part 5)

This PR implements four major tasks for the `Stellar_Card` repository:

- **Review and update project READMEs and contributor guides (Part 5)** (#285)
- **Add docker-compose for unified local development (Part 5)** (#284)
- **Implement comprehensive cross-browser testing (Part 5)** (#283)
- **Setup automated dependabot security updates (Part 5)** (#282)
=======
# SDK custom RPC endpoint configuration fix

This PR hardens the stellar_card SDK network configuration logic for custom RPC and Horizon endpoints and closes the gap around blank or whitespace-only endpoint values.

## Summary

- Normalizes custom endpoint strings before resolution
- Treats blank / whitespace-only values as unset so the SDK falls back to default mainnet/testnet endpoints
- Keeps environment-driven config consistent with object-based config
- Adds regression coverage for edge cases in custom and env-based network configuration
>>>>>>> 4d0a50519a8359418773cf40e8dcd15587e17f92

## Changes Summary

<<<<<<< HEAD
### Task #285: Review and Update Project READMEs and Contributor Guides (Part 5)

**Files Created/Modified:**
- `stellar_card-backend/README.md` — Created complete backend documentation including environment variables (`PORT`, `DB_PATH`, `STELLAR_NETWORK`, `RECEIVER_CONTRACT_ID`, `VCC_API_BASE`), setup steps, REST API endpoints, Docker integration, and testing commands.
- `README.md` — Updated root README with subproject README links (`stellar_card-backend/README.md`, `stellar_card-frontend/README.md`, `stellar_card-contract/README.md`, `stellar_card-sdk/README.md`), Docker Compose local quickstart guide, testing suites (unit, cross-browser Playwright, a11y), and Dependabot security overview.
- `CONTRIBUTING.md` — Updated contributor guide with Docker prerequisites, containerized setup workflow, cross-browser Playwright testing instructions, branch naming conventions (`feature/docs-task-46`, `feature/devops-task-45`, `feature/qa-task-44`, `feature/security-task-43`), Dependabot update policy, and PR checklist.
- `stellar_card-frontend/README.md` — Documented Next.js 16 setup, Storybook environment, Playwright cross-browser testing (`npm run test:e2e`), state management guide, and Docker setup.
- `stellar_card-contract/README.md` — Updated Soroban smart contract guide with test commands (`cargo test`), format checks, and Dependabot Cargo security integration.
- `test/docs.test.mjs` — Added Vitest suite to verify README presence, documentation sections, environment settings, and contributor guidelines.

### Task #284: Add docker-compose for Unified Local Development (Part 5)

**Files Created/Modified:**
- `docker-compose.yml` — Created root Docker Compose configuration containing `backend` (port 4000) and `frontend` (port 3000) services with environment variables, healthchecks, bridge network (`stellar_card-net`), volume mounts (`backend-data`), and restart policies.
- `stellar_card-backend/Dockerfile` — Created multi-stage Node.js Dockerfile for the Express API server with SQLite build tooling and healthcheck dependencies.
- `stellar_card-frontend/Dockerfile` — Created multi-stage Next.js Dockerfile (deps, builder, runner) for non-root user execution on port 3000.
- `.dockerignore`, `stellar_card-backend/.dockerignore`, `stellar_card-frontend/.dockerignore` — Created dockerignore files preventing unneeded file context inclusion (`node_modules`, `.next`, `.git`, SQLite databases).
- `test/docker.test.mjs` — Added Vitest suite to validate `docker-compose.yml` structure, service specifications, port mapping, health checks, and Dockerfiles.

### Task #283: Implement Comprehensive Cross-Browser Testing (Part 5)

**Files Created/Modified:**
- `stellar_card-frontend/playwright.config.ts` — Updated Playwright test configuration to include project definitions for:
  - `chromium` (Desktop Chrome)
  - `firefox` (Desktop Firefox)
  - `webkit` (Desktop Safari)
  - `Mobile Chrome` (Pixel 5)
  - `Mobile Safari` (iPhone 12)
  - `Microsoft Edge` (Desktop Edge)
- `stellar_card-frontend/e2e/cross-browser.spec.ts` — Added E2E cross-browser test suite covering page rendering, title verification, navigation controls, responsive layouts, interactive elements, and wallet state displays.
- `.github/workflows/e2e.yml` — Updated GitHub Actions workflow with Playwright multi-browser dependency installation (`npx playwright install --with-deps`) and project test matrix strategy across `chromium`, `firefox`, and `webkit`.
- `test/cross-browser.test.mjs` — Added Vitest suite verifying Playwright cross-browser project declarations, E2E spec presence, and workflow matrix execution.

### Task #282: Setup Automated Dependabot Security Updates (Part 5)

**Files Created/Modified:**
- `.github/dependabot.yml` — Updated Dependabot configuration covering all package ecosystems across the repository:
  - `npm` for `/stellar_card-sdk` (weekly, Monday 03:00 UTC)
  - `npm` for `/stellar_card-backend` (weekly, Monday 03:30 UTC)
  - `npm` for `/stellar_card-frontend` (weekly, Monday 04:00 UTC)
  - `cargo` for `/stellar_card-contract` (weekly, Monday 04:30 UTC)
  - `github-actions` for `/` (weekly, Monday 05:00 UTC)
  - `docker` for `/` (weekly, Monday 05:30 UTC)
  - Configured with target branch `main`, reviewer `devpeter999`, labels (`dependencies`, `security`, subpackage tags), and conventional commit formatting (`chore(deps): ...`).
- `.github/workflows/security.yml` — Updated security audit workflow to scan all subpackages (`stellar_card-sdk`, `stellar_card-backend`, `stellar_card-frontend`, `stellar_card-contract`) with npm audit, Trivy filesystem scans, and CodeQL analysis.
- `test/dependabot.test.mjs` — Added Vitest suite to validate `.github/dependabot.yml` YAML schema, ecosystem entries, update schedules, and conventional commit rules.

## Testing & Verification

All changes are validated by unit and integration tests:

- `npm test` inside `stellar_card-sdk/` (runs all unit test suites in `src/` and `test/` including `test/docs.test.mjs`, `test/docker.test.mjs`, `test/cross-browser.test.mjs`, and `test/dependabot.test.mjs`)
- `npm run test:e2e` inside `stellar_card-frontend/` (runs Playwright across Chromium, Firefox, WebKit, Mobile Chrome, and Mobile Safari)

## Related Issues

Closes #285 - [general] Review and update project READMEs and contributor guides (Part 5)
Closes #284 - [general] Add docker-compose for unified local development (Part 5)
Closes #283 - [general] Implement comprehensive cross-browser testing (Part 5)
Closes #282 - [general] Setup automated dependabot security updates (Part 5)
=======
### Custom RPC endpoint resolution

The SDK now trims and normalizes custom endpoint values before they are used in `resolveNetworkConfig()` and `resolveNetworkConfigFromEnv()`.

This prevents cases like:

- `sorobanRpcUrl: '   '` from overriding the default RPC URL
- `networkPassphrase: '   '` from silently acting as a custom network
- environment variables with whitespace-only values from overriding real defaults

### Default fallback behavior

When an endpoint or config value is empty after trimming, the SDK falls back to the network-appropriate public default instead of accepting invalid configuration.

### Tests added

- Blank or whitespace-only object config values default cleanly
- Blank or whitespace-only env values default cleanly
- Existing override and timeout behavior remains intact

## Files touched

- `stellar_card-sdk/src/network.ts`
- `stellar_card-sdk/src/__tests__/network.test.ts`

## Validation

- Added focused regression tests covering the edge cases above
- Verified the logic remains compatible with existing network override expectations

## Related issue

Closes #517 - [sdk] Add support for custom RPC endpoint config (Part 4)
>>>>>>> 4d0a50519a8359418773cf40e8dcd15587e17f92
