# Deployment Scripts

This directory contains scripts for automating the deployment of the Stellar_Card smart contract.

Two entry points do the same job:

| Script | When to use it |
| :--- | :--- |
| `deploy_testnet.mjs` | **Preferred.** Cross-platform, has `--help`, `--dry-run`, and flag-based configuration, and its logic is unit-tested in `test/tooling.test.mjs`. |
| `deploy_testnet.sh` | The original bash version, kept for environments that have no Node. Environment variables only. |

## Layout

```
tooling/scripts/
├── deploy_testnet.mjs   # CLI entry point — reads argv, prints, spawns
├── deploy_testnet.sh    # bash equivalent
└── lib/
    └── deploy.mjs       # pure functions: config resolution, validation, command building
```

The split is deliberate. `lib/deploy.mjs` contains no side effects — it takes
its inputs as arguments and returns values rather than calling `process.exit`
— so the deployment logic can be tested without a Soroban toolchain, a funded
account, or a network. `deploy_testnet.mjs` is the thin shell around it.

## Prerequisites

Before running the deployment scripts, ensure you have the following installed:
- [Node.js](https://nodejs.org/) 18 or newer (for `deploy_testnet.mjs`)
- [Rust toolchain](https://rustup.rs/) (including the `wasm32-unknown-unknown` target)
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup)

## Environment Setup

The deployment scripts rely on standard Soroban CLI environment configuration.

You MUST set the following required environment variable before running the script:
- `SOURCE_ACCOUNT`: The configured identity name or secret key to deploy from.
  - Example: `export SOURCE_ACCOUNT=alice` (if you configured an identity named `alice`)

Optional environment variables:
- `NETWORK`: Specifies the target network. Defaults to `testnet` if not set.

Ensure you have created the identity and funded it on the target network before deploying:
```bash
# Example: Generate an identity named "alice" on testnet
soroban config identity generate --network testnet alice
```

## Running the Deployment

### Node entry point (preferred)

```bash
# Using a configured identity
node deploy_testnet.mjs --source alice

# Target a different network
node deploy_testnet.mjs --source alice --network futurenet

# Build and verify the artefact without deploying
node deploy_testnet.mjs --source alice --dry-run

# Full flag reference
node deploy_testnet.mjs --help
```

Flags take precedence over environment variables, so an exported
`SOURCE_ACCOUNT` can still be overridden for a single run.

| Flag | Short | Description |
| :--- | :--- | :--- |
| `--source <id>` | `-s` | Identity name or secret key to sign with |
| `--network <name>` | `-n` | Target network (default: `testnet`) |
| `--dry-run` | `-d` | Build the contract, skip deployment |
| `--help` | `-h` | Show usage and exit |
| `--version` | `-v` | Print the helper version and exit |

A network name outside the well-known set (`testnet`, `futurenet`, `mainnet`,
`local`, `standalone`) produces a warning rather than an error, since the
Soroban CLI supports arbitrary named networks from its own configuration.

If you pass a secret key rather than an identity name, it is masked in the
banner so it does not end up in a terminal scrollback or a CI log.

### Shell entry point

```bash
./deploy_testnet.sh
```

## Expected Outputs

When executed, the script will:
1. Validate your environment variables and tool installations.
2. Build the contract (optimizing the WASM output).
3. Deploy the compiled WASM to the target network.
4. Output the deployed contract address.

**Example Output:**
```
=============================================
   Stellar_Card Contract Deployment Script   
=============================================
🚀 Building contract...
✅ Build successful!
🚀 Deploying contract to network: testnet...
=============================================
✅ Deployment completed successfully!
📍 Contract Address: CDXXXXXXXXXX...
=============================================
Please save this contract address for initialization and frontend configuration.
```
