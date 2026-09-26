# Stellar_Card Receiver Contract

Soroban smart contract that receives USDC payments from AI agents and emits `payment` events containing the order ID. The backend polls these events to route and fulfil orders — no memo or destination matching required.

## Environment variables

| Variable               | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `RECEIVER_CONTRACT_ID` | Deployed contract address (C...)                                     |
| `SOROBAN_RPC_URL`      | Soroban RPC endpoint (optional — defaults to public mainnet/testnet) |

## Deployment steps

### 1. Install toolchain

```bash
rustup target add wasm32v1-none
cargo install --locked stellar-cli
```

### 2. Build and optimise

```bash
make build
```

This compiles for `wasm32v1-none`, runs `stellar contract optimize` (or
binaryen's `wasm-opt` if the CLI's optimizer isn't available) to produce
`target/wasm32v1-none/release/stellar_card_receiver.optimized.wasm`, and fails
if either binary exceeds its size budget. The equivalent manual steps:

```bash
cargo build --target wasm32v1-none --release
stellar contract optimize --wasm target/wasm32v1-none/release/stellar_card_receiver.wasm
```

Use `wasm32v1-none`, not `wasm32-unknown-unknown`: on Rust 1.82+ the latter
emits reference-types / multi-value WASM that Soroban rejects.

### 3. Binary size

The optimizer pass takes the contract from ~46 KB to ~37 KB (Soroban's hard
limit is 64 KiB). `make wasm-size` checks both binaries against the budgets in
the Makefile (`WASM_SIZE_BUDGET_BYTES`, `OPTIMIZED_WASM_SIZE_BUDGET_BYTES`), and
`test_wasm_within_size_budget` asserts the raw budget on every `cargo test`.
When a change legitimately needs more room, raise both budgets together, with
the new measured size in the Makefile comment.

### 4. Deploy to testnet

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/stellar_card_receiver.optimized.wasm \
  --source <YOUR_SECRET_KEY> \
  --network testnet
```

For mainnet replace `--network testnet` with `--network mainnet`.

The command prints the deployed contract ID (C...). Save it as `RECEIVER_CONTRACT_ID`.

### 5. Deploy to mainnet

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/stellar_card_receiver.optimized.wasm \
  --source <YOUR_SECRET_KEY> \
  --network mainnet
```

### 6. Initialise

Call `init` **once** after deployment. `init` stores the admin, treasury, and
asset contract addresses and requires the admin signature. Calling `init` a
second time panics with `already initialized`.

The contract retains an `upgrade(new_wasm_hash)` entrypoint gated by
`admin.require_auth()` and supports pausing payments during an incident.

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

Administrative state changes emit `init`, `paused`, `unpaused`, `upgraded`,
`tokens_rescued`, `withdraw_limits_set`, `admin_transferred`, `role_granted`,
`role_revoked`, and `role_renounced` events. Idempotent operations
(re-pausing, re-granting a role an address already holds, revoking or
renouncing a role that isn't held) do not emit events when no state changed,
so every event is a real state transition. The full topic/data layout of each
event is documented at the top of `src/lib.rs`.

## Testing & Verification

```bash
# Build the WASM fixture and run contract unit tests
make test

# Run only the in-process integration suite (tests/integration.rs):
# full multi-step flows through the public client, no Docker needed
make contract-integration-test

# Run the end-to-end suite against a local Quickstart network
# Requires Docker and Stellar CLI
make integration-test

# Format contract source files
cargo fmt --check
```

### Integration tests

There are two integration layers (Issue #400 - Part 2):

- **`tests/integration.rs`** runs in-process with `cargo test` (so it is part
  of `make test`). It drives the contract only through its public client, the
  way a wallet or the backend would, across full flows: payments, incident
  pause/resume, admin handover, role lifecycle, and `rescue_tokens` with daily
  limits. Authorization is checked with specific signers where it matters,
  not just `mock_all_auths`.
- **`scripts/test_local_network.sh`** (`make integration-test`) starts a
  `stellar/quickstart` container, deploys real USDC and native XLM asset
  contracts plus the receiver, and asserts on real ledger state: getters,
  balances, RBAC-gated pause, pause → unpause → payment, `rescue_tokens` with
  per-call and daily limits, rejected calls, and the emitted `init` and
  `pay_usdc` events. CI runs it on every contract change.

The script can be tuned with environment variables:

| Variable           | Default                     | Purpose                                              |
|--------------------|-----------------------------|------------------------------------------------------|
| `STELLAR_RPC_PORT` | `8000`                      | Host port to publish Quickstart on (avoid clashes)   |
| `QUICKSTART_IMAGE` | `stellar/quickstart:latest` | Image to run, e.g. a pinned tag                      |
| `RPC_WAIT_SECONDS` | `180`                       | How long to wait for RPC and friendbot to be healthy |
| `KEEP_NETWORK`     | `0`                         | `1` leaves the container running for debugging       |
| `SKIP_BUILD`       | `0`                         | `1` reuses an existing release WASM                  |

On failure the script names the step that failed and prints the tail of the
container logs.

## Security & Dependabot

- Dependencies in `Cargo.toml` are monitored automatically by Dependabot (`.github/dependabot.yml`).
- Automated Rust vulnerability checks run via `cargo-audit` in security workflows.
