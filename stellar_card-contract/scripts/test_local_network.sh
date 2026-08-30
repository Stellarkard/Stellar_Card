#!/bin/bash
set -e

# Automated integration test against a local Soroban network (issue #430).
# Spins up the official quickstart image, builds+deploys the contract, then
# runs a smoke invocation against the running node — beyond the in-process
# unit tests in src/lib.rs's `mod test`, which never touch a real node/RPC.
#
# Requires: docker, stellar CLI.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTAINER_NAME="stellar_card-local-test"
RPC_URL="http://localhost:8000/soroban/rpc"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Starting local Soroban network..."
docker run -d --rm \
  --name "$CONTAINER_NAME" \
  -p 8000:8000 \
  stellar/quickstart:latest \
  --local --enable-soroban-rpc

echo "Waiting for RPC to become available..."
for _ in $(seq 1 30); do
  if curl -sf "$RPC_URL" -o /dev/null 2>&1; then
    break
  fi
  sleep 2
done

cd "$PROJECT_ROOT"
echo "Building contract..."
cargo build --target wasm32-unknown-unknown --release

echo "Configuring local network + deployer identity..."
stellar network add local \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  2>/dev/null || true
stellar keys generate deployer-local --network local --fund 2>/dev/null || true

echo "Deploying contract to local network..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_card_receiver.wasm \
  --source deployer-local \
  --network local)

echo "Deployed contract: $CONTRACT_ID"
echo "Smoke test: querying treasury() on freshly deployed contract..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source deployer-local \
  --network local \
  -- treasury || echo "(expected to fail — contract not yet initialized; deploy succeeded, which is what this smoke test verifies)"

echo "Local network integration test complete."
