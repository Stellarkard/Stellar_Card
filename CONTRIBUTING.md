# Contributing to Stellar_Card

Thank you for helping improve Stellar_Card. This guide covers everything you need to set up your local environment, run tests, and open a successful pull request.

---

## Project layout

```
Stellar_Card/
├── stellar_card-sdk/        # TypeScript SDK published to npm
├── stellar_card-contract/   # Soroban smart contract (Rust)
├── stellar_card-backend/    # API server (Node.js/Express)
├── stellar_card-frontend/   # Web dashboard (Next.js 16)
├── docker-compose.yml       # Unified local development environment
└── tooling/                 # Build and deployment scripts
```

Each sub-package contains its own `README.md` with detailed instructions for that specific component.

---

## Prerequisites

| Tool | Minimum version | Notes |
|------|-----------------|-------|
| Node.js | 18+ | SDK, frontend, backend, and tooling scripts |
| npm | 9+ | Package management |
| Docker & Docker Compose | 20.10+ / 2.0+ | Unified local container development environment |
| Rust | stable | Soroban smart contract development |
| Soroban CLI | latest | Contract build and deployment |
| Playwright | 1.40+ | Cross-browser e2e testing |

---

## Setting up locally

### Option 1: Native Node.js Workflow

```bash
# 1. Fork and clone repository
git clone https://github.com/<your-fork>/Stellar_Card.git
cd Stellar_Card

# 2. Install SDK dependencies & run SDK test suite
cd stellar_card-sdk && npm ci
npm test

# 3. Setup backend environment
cd ../stellar_card-backend && npm ci && cp .env.example .env

# 4. Setup frontend environment
cd ../stellar_card-frontend && npm ci
```

### Option 2: Unified Container Workflow (Docker Compose)

```bash
# Start backend (:4000) and frontend (:3000) containers
docker compose up --build

# Run in background
docker compose up -d

# Stop environment
docker compose down
```

---

## Workflow

1. **Pick an issue** — check the open issues list and leave a comment to claim one before starting.
2. **Branch naming** — follow the convention used in issue tasks:
   - `feature/docs-task-46` or `docs/<short-description>` for documentation updates
   - `feature/devops-task-45` or `infra/<short-description>` for DevOps & Docker Compose updates
   - `feature/qa-task-44` or `test/<short-description>` for cross-browser & QA updates
   - `feature/security-task-43` or `security/<short-description>` for Dependabot & security updates
3. **Make your changes** — keep commits small and focused; see the commit message guide below.
4. **Test across suites**:
   - SDK: `npm test` in `stellar_card-sdk/`
   - Backend: `npm test` in `stellar_card-backend/`
   - Frontend Unit: `npm test` in `stellar_card-frontend/`
   - Cross-Browser E2E: `npm run test:e2e` in `stellar_card-frontend/` (Playwright across Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari)
5. **Open a PR** — fill in the pull request template and link the issue with `Closes #N`.

---

## Testing & Cross-Browser QA

We use Playwright for cross-browser testing across multiple rendering engines and mobile viewports:

```bash
cd stellar_card-frontend

# Run Playwright cross-browser test suite
npx playwright test

# Test specific browser project (e.g., firefox, webkit)
npx playwright test --project=firefox
npx playwright test --project=webkit
npx playwright test --project="Mobile Chrome"
```

---

## Dependabot & Security Policy

Automated security updates are managed by Dependabot (`.github/dependabot.yml`):

- **Ecosystems monitored**: `npm` (`stellar_card-sdk`, `stellar_card-backend`, `stellar_card-frontend`), `cargo` (`stellar_card-contract`), `docker`, `github-actions`.
- **Commit prefix**: `chore(deps): ...` or `ci(deps): ...` following Conventional Commits.
- **Review policy**: Security patches and patch updates receive automated CI audit runs (`.github/workflows/security.yml`).

---

## Git hooks

This project uses Husky to enforce code quality automatically:

- **commit-msg** — validates commit messages against [Conventional Commits](https://www.conventionalcommits.org/) via commitlint
- **pre-commit** — runs lint-staged to lint and type-check staged files
- **pre-push** — runs the test suite to catch regressions before pushing

Hooks are installed automatically when you run `npm ci` in `stellar_card-sdk/`.

---

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
```

Allowed types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `ci`, `build`.

Examples:
```
feat(sdk): add retry helper for Soroban RPC calls
fix(contract): correct off-by-one in fee calculation
docs: update CONTRIBUTING.md with commit format
ci: add npm cache key to test workflow
```

Commit messages are validated automatically by commitlint on every commit (see `.commitlintrc.json`).

---

## Code style

- **TypeScript**: follow the existing file conventions (2-space indent, named exports, `node:` import protocol for built-ins).
- **Rust**: run `cargo fmt` before committing contract changes.
- **Shell scripts**: use `set -euo pipefail` at the top of every script.

---

## CI/CD pipelines

All changes go through automated checks:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| Test & Lint | Push, PR | Runs linting, type checking, tests, build |
| Security Audit | Push, PR, daily | npm audit, Trivy scan, CodeQL analysis |
| E2E Tests | Push, PR | Cross-browser Playwright test matrix |
| SDK Validate | PR to main/develop | Full build and package verification |
| Accessibility Audit | Push, PR, weekly | Playwright a11y checks, Storybook audit |

See [CICD.md](.github/CICD.md) for full details.

---

## Pull request checklist

- [ ] `npm test` passes in `stellar_card-sdk/`
- [ ] Backend tests pass in `stellar_card-backend/`
- [ ] Cross-browser e2e tests pass (`npx playwright test`)
- [ ] New behaviour has test coverage
- [ ] Commit messages follow Conventional Commits
- [ ] PR description links the resolved issue (`Closes #N`)
- [ ] No secrets, keys, or credentials included

---

## Reporting bugs

Open an issue using the [issue template](issueTemplate.md). Include:
- Steps to reproduce
- Expected vs actual behaviour
- Node.js / Rust / Soroban CLI versions

---

## Questions

Open a GitHub Discussion or comment directly on the relevant issue.
