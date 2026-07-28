# Stellar_Card

Full spend management and virtual Visa cards for AI agents.
Pay XLM or USDC on Stellar, get a real Visa card number in about 60 seconds.

Stellar_Card gives agents their own funding rails without giving them your personal card details.
With one line of code, an agent can deploy an Open Wallet Standard (OWS) wallet with Stellar and Soroban support, then use that wallet to buy anywhere x402 is supported and anywhere Visa is accepted.

[![Tests](https://github.com/devpeter999/Stellar_Card/workflows/Test%20%26%20Lint/badge.svg)](https://github.com/devpeter999/Stellar_Card/actions/workflows/test.yml)
[![Security](https://github.com/devpeter999/Stellar_Card/workflows/Security%20Audit/badge.svg)](https://github.com/devpeter999/Stellar_Card/actions/workflows/security.yml)
[![SDK Validate](https://github.com/devpeter999/Stellar_Card/workflows/SDK%20Validate%20(PR)/badge.svg)](https://github.com/devpeter999/Stellar_Card/actions/workflows/sdk-validate.yml)
[![Accessibility](https://github.com/devpeter999/Stellar_Card/workflows/Accessibility%20Audit/badge.svg)](https://github.com/devpeter999/Stellar_Card/actions/workflows/a11y.yml)

## Core idea

- Instant 1:1 value cards with no markup fee. `5 USDC -> $5 Visa card`.
- Real card credentials returned fast: PAN, CVV, and expiry.
- Non-custodial payment flow: the agent wallet pays the invoice contract directly.
- Stellar_Card does not custody customer funds.

## Why this matters

Agents are already making purchase decisions. The missing step has been safe, programmable execution on real-world payment rails.
Stellar_Card closes that gap:

- No need to hand an agent your own card.
- No need to trust third-party card sharing hacks.
- Less than 60 seconds end-to-end from payment to usable card details.
- Works across checkout pages, API billing, subscriptions, and marketplaces.

From solo users to large businesses running swarms of agents, Stellar_Card unlocks conventional finance rails in a programmable way:

- One Stellar transaction in USDC or XLM.
- One delivered Visa card out.
- Spend instantly, globally, and securely.

## Spend control plane for operators

Stellar_Card is not only card issuance. It is a full control plane for operating spending agents safely at scale.

- Agent spending limits: per order, daily, and lifetime caps enforced by policy.
- Human approval queues: route large purchases for manual approval or rejection.
- Live kill switch: suspend an agent and block the next purchase at API boundary.
- Agent groups: organize by purpose, owner, or environment for fast triage.
- Wallet top-ups with QR codes: each agent has a dedicated OWS Stellar wallet.
- Full audit log: every mutation tracked with actor, timestamp, IP, and user-agent.

## Developer experience

- x402 payment -> Visa card -> purchase anything.
- Fully resumable flows.
- Interactive APIs and webhooks.
- Human dashboard for oversight and operations.

Stellar_Card gives agents real purchasing power with strict, configurable guardrails.

## Project structure

```
Stellar_Card/
├── stellar_card-sdk/        # TypeScript SDK published to npm (see stellar_card-sdk/README.md)
├── stellar_card-contract/   # Soroban smart contract in Rust (see stellar_card-contract/README.md)
├── stellar_card-backend/    # Node.js Express API server (see stellar_card-backend/README.md)
├── stellar_card-frontend/   # Next.js web dashboard (see stellar_card-frontend/README.md)
├── docker-compose.yml       # Unified local development environment
├── tooling/                 # Build and deployment scripts
└── .github/                 # CI/CD workflows and Dependabot configuration
```

## Getting started

### Option A: Local development (Node.js & npm)

```bash
# 1. Fork and clone repository
git clone https://github.com/<your-fork>/Stellar_Card.git
cd Stellar_Card

# 2. Install SDK dependencies and run test suite
cd stellar_card-sdk && npm ci
npm test

# 3. Start backend service
cd ../stellar_card-backend && npm ci && cp .env.example .env && npm run dev

# 4. Start frontend dashboard
cd ../stellar_card-frontend && npm ci && npm run dev
```

### Option B: Unified local development (Docker Compose)

```bash
# Start all services (backend on :4000, frontend on :3000)
docker compose up --build

# Run in detached background mode
docker compose up -d

# View container logs
docker compose logs -f

# Stop containers
docker compose down
```

## Testing & Quality Assurance

- **Unit & SDK Tests**: `npm test` inside `stellar_card-sdk/`
- **Backend Tests**: `npm test` inside `stellar_card-backend/`
- **Frontend Unit Tests**: `npm test` inside `stellar_card-frontend/`
- **Cross-Browser E2E Testing**: `npm run test:e2e` inside `stellar_card-frontend/` (executes Playwright across Chromium, Firefox, WebKit, Mobile Chrome, and Mobile Safari)
- **Accessibility Audit**: `npm run test:a11y` inside `stellar_card-frontend/`

## Automated Security & Dependabot

Security is continuously enforced across all repositories:

- **Dependabot Updates**: Automated security and dependency updates configured in `.github/dependabot.yml` for npm (`stellar_card-sdk`, `stellar_card-backend`, `stellar_card-frontend`), Cargo (`stellar_card-contract`), Docker, and GitHub Actions workflows.
- **Vulnerability Scanning**: Continuous security scanning with npm audit, cargo audit, Trivy, and CodeQL static analysis in `.github/workflows/security.yml`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on setting up the project, commit conventions, branch naming, and pull request workflow.

## CI/CD

This project uses GitHub Actions for:

- **Testing & Linting** — runs on every push and PR
- **Security Audits** — daily dependency and container scanning
- **SDK Validation** — ensures the package is publishable before merge
- **Cross-Browser E2E Tests** — automated Playwright cross-browser test suite
- **Accessibility Audits** — automated a11y checks via Playwright and Storybook
- **Publishing** — automatic npm publish on tagged releases

See [CICD.md](.github/CICD.md) for full pipeline documentation.
