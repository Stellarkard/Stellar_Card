# Deployment Scripts

This directory contains scripts for automating the deployment of the Stellar_Card smart contract.

## Prerequisites

Before running the deployment script, ensure you have the following installed:
- [Rust toolchain](https://rustup.rs/) (including the `wasm32-unknown-unknown` target)
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup)
- Node.js 18+ (the script uses `node:util.parseArgs` and other modern built-ins)

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

To deploy the contract to the testnet, run the script with Node:

```bash
node deploy_testnet.mjs --source alice
```

Flags mirror the environment variables above (`--source`, `--network`), plus
a `--dry-run` flag that builds without deploying:

```bash
node deploy_testnet.mjs --source alice --network testnet --dry-run
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
