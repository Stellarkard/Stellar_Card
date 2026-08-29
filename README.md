# Stellar_Card Receiver Contract

Soroban smart contract that receives USDC payments from AI agents and emits `payment` events containing the order ID. The backend polls these events to route and fulfil orders — no memo or destination matching required.

<<<<<<< HEAD
Stellar Card gives agents their own funding rails without giving them your personal card details.
With one line of code, an agent can deploy an Open Wallet Standard (OWS) wallet with Stellar and Soroban support, then use that wallet to buy anywhere x402 is supported and anywhere Visa is accepted.

[![Tests](https://github.com/devpeter999/Stellar_Card/workflows/Test%20%26%20Lint/badge.svg)](https://github.com/devpeter999/Stellar_Card/actions/workflows/test.yml)
[![Security](https://github.com/devpeter999/Stellar_Card/workflows/Security%20Audit/badge.svg)](https://github.com/devpeter999/Stellar_Card/actions/workflows/security.yml)
[![SDK Validate](https://github.com/devpeter999/Stellar_Card/workflows/SDK%20Validate%20(PR)/badge.svg)](https://github.com/devpeter999/Stellar_Card/actions/workflows/sdk-validate.yml)
[![Accessibility](https://github.com/devpeter999/Stellar_Card/workflows/Accessibility%20Audit/badge.svg)](https://github.com/devpeter999/Stellar_Card/actions/workflows/a11y.yml)

## Core idea
=======
## Environment variables

| Variable               | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `RECEIVER_CONTRACT_ID` | Deployed contract address (C...)                                     |
| `SOROBAN_RPC_URL`      | Soroban RPC endpoint (optional — defaults to public mainnet/testnet) |
>>>>>>> 4d0a50519a8359418773cf40e8dcd15587e17f92

## Deployment steps

### 1. Install toolchain

```bash
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli
```

### 2. Build

```bash
cargo build --target wasm32-unknown-unknown --release
```

### 3. Optimise

```bash
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/stellar_card_receiver.wasm
```

This produces `stellar_card_receiver.optimized.wasm`.

### 4. Deploy to testnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_card_receiver.optimized.wasm \
  --source <YOUR_SECRET_KEY> \
  --network testnet
```

For mainnet replace `--network testnet` with `--network mainnet`.

<<<<<<< HEAD
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

`docker compose up` builds **production-shaped** images: the source is baked
in, so an edit on the host changes nothing until you rebuild. That is the right
default for verifying a release candidate, but it is not a development loop.

For hot reload, layer the dev overlay on top:

```bash
# Bind-mounts host source; backend runs `node --watch`, frontend runs `next dev`
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

The overlay is a separate file rather than `docker-compose.override.yml` —
Compose loads an override file automatically, and keeping the dev stack opt-in
means `docker compose up` keeps meaning the same thing for everyone.

Optional tooling is profile-gated, so it stays out of the default `up`:

```bash
docker compose --profile tools run --rm sdk        # install + test the SDK
docker compose --profile tools run --rm contract   # build the contract wasm
```

## Testing & Quality Assurance

- **Unit & SDK Tests**: `npm test` inside `stellar_card-sdk/`
- **Backend Tests**: `npm test` inside `stellar_card-backend/`
- **Frontend Unit Tests**: `npm test` inside `stellar_card-frontend/`
- **Cross-Browser E2E Testing**: `npm run test:e2e` inside `stellar_card-frontend/` (executes Playwright across Chromium, Firefox, WebKit, Mobile Chrome, and Mobile Safari)
- **Accessibility Audit**: `npm run test:a11y` inside `stellar_card-frontend/`

## Automated Security & Dependabot

Security is continuously enforced across all repositories:

- **Dependabot Updates**: Automated security and dependency updates configured in `.github/dependabot.yml` for npm (`stellar_card-sdk`, `stellar_card-backend`, `stellar_card-frontend`), Cargo (`stellar_card-contract`), Docker (`stellar_card-backend`, `stellar_card-frontend`), Docker Compose, and GitHub Actions workflows.
- **Grouped Updates**: Routine dev-dependency and patch bumps are grouped per package, so a weekly run opens a handful of PRs rather than dozens. Majors are never grouped — they always arrive as their own reviewable PR.
- **Auto-Merge**: `.github/workflows/dependabot-auto-merge.yml` enables auto-merge for patch bumps, dev-dependency minors, and grouped updates once required checks pass. Majors and production-facing minors are always left for a human, so a "security update" can never quietly become a breaking change.
- **Vulnerability Scanning**: Continuous security scanning with npm audit, `cargo audit` against the RustSec advisory database, Trivy, and CodeQL static analysis in `.github/workflows/security.yml`.

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
=======
The command prints the deployed contract ID (C...). Save it as `RECEIVER_CONTRACT_ID`.

### 5. Deploy to mainnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_card_receiver.optimized.wasm \
  --source <YOUR_SECRET_KEY> \
  --network mainnet
```

### 6. Initialise

Call `init` **once** after deployment. `init` stores the admin, treasury, and
asset contract addresses and requires the admin signature. Calling `init` a
second time panics with `already initialized`.

The contract retains an `upgrade(new_wasm_hash)` entrypoint gated by
`admin.require_auth()` — the admin key can swap the contract's WASM in the
future. There is no pause function; if you want a fully immutable deployment,
transfer the admin key to a burn address after `init` (or fork the contract
with `upgrade` removed).

Contract IDs on Stellar mainnet:

- USDC SAC: `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`
- XLM native SAC: `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA`

```bash
stellar contract invoke \
  --id <RECEIVER_CONTRACT_ID> \
  --source <ADMIN_SECRET_KEY> \
  --network mainnet \
  -- init \
  --admin G... \
  --treasury G... \
  --usdc_contract CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75 \
  --xlm_contract CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA
```

- `--admin`: account that authorizes `init` and any future `upgrade` call
- `--treasury`: Stellar address that receives all USDC and XLM payments
- `--usdc_contract`: USDC SAC contract on the target network
- `--xlm_contract`: native XLM SAC contract on the target network

## Event schema

Each successful payment emits one Soroban event. The `topic[0]` symbol identifies the asset.

### USDC payment (`pay_usdc`)

| Field      | Type      | Value                                   |
| ---------- | --------- | --------------------------------------- |
| `topic[0]` | `Symbol`  | `"pay_usdc"`                            |
| `topic[1]` | `Bytes`   | UTF-8 encoded order UUID                |
| `topic[2]` | `Address` | Sender's Stellar address                |
| `value`    | `i128`    | Amount in stroops (1 USDC = 10,000,000) |

### XLM payment (`pay_xlm`)

| Field      | Type      | Value                                  |
| ---------- | --------- | -------------------------------------- |
| `topic[0]` | `Symbol`  | `"pay_xlm"`                            |
| `topic[1]` | `Bytes`   | UTF-8 encoded order UUID               |
| `topic[2]` | `Address` | Sender's Stellar address               |
| `value`    | `i128`    | Amount in stroops (1 XLM = 10,000,000) |

The backend event watcher filters on both `pay_usdc` and `pay_xlm` symbols.
>>>>>>> 4d0a50519a8359418773cf40e8dcd15587e17f92
