#!/usr/bin/env bash
set -euo pipefail

# End-to-end smoke test against a real local Stellar network.
# Requires: cargo, curl, docker, and Stellar CLI.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTAINER_NAME="stellar-card-contract-test-$$"
RPC_URL="http://localhost:8000/rpc"
FRIENDBOT_URL="http://localhost:8000/friendbot"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"
STELLAR_CONFIG_DIR="$(mktemp -d)"
WASM_PATH="$PROJECT_ROOT/target/wasm32v1-none/release/stellar_card_receiver.wasm"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$STELLAR_CONFIG_DIR"
}
trap cleanup EXIT

for command in cargo curl docker stellar; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Error: required command '$command' is not installed" >&2
    exit 1
  fi
done

stellar_local() {
  stellar --config-dir "$STELLAR_CONFIG_DIR" "$@"
}

echo "Starting local Stellar network..."
docker run -d --rm \
  --name "$CONTAINER_NAME" \
  -p 8000:8000 \
  stellar/quickstart:latest \
  --local --enable rpc,horizon >/dev/null

echo "Waiting for RPC health..."
rpc_healthy=false
for _ in $(seq 1 60); do
  if curl -sf \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    "$RPC_URL" | grep -q '"status"[[:space:]]*:[[:space:]]*"healthy"' \
    && curl -s "$FRIENDBOT_URL" | grep -q '"invalid_field"[[:space:]]*:[[:space:]]*"addr"'; then
    rpc_healthy=true
    break
  fi
  sleep 2
done
if [ "$rpc_healthy" != true ]; then
  docker logs "$CONTAINER_NAME"
  echo "Error: local Stellar RPC did not become healthy" >&2
  exit 1
fi

cd "$PROJECT_ROOT"
echo "Building contract..."
cargo build --target wasm32v1-none --release

stellar_local network add local \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE"

for identity in deployer treasury payer issuer; do
  stellar_local keys generate "$identity" --overwrite
  stellar_local keys fund "$identity" --network local
done

DEPLOYER_ADDRESS="$(stellar_local keys public-key deployer)"
TREASURY_ADDRESS="$(stellar_local keys public-key treasury)"
PAYER_ADDRESS="$(stellar_local keys public-key payer)"
ISSUER_ADDRESS="$(stellar_local keys public-key issuer)"

echo "Deploying asset and receiver contracts..."
USDC_CONTRACT_ID="$(stellar_local contract asset deploy \
  --asset "USDC:$ISSUER_ADDRESS" \
  --source issuer \
  --network local)"
XLM_CONTRACT_ID="$(stellar_local contract asset deploy \
  --asset native \
  --source deployer \
  --network local)"
RECEIVER_CONTRACT_ID="$(stellar_local contract deploy \
  --wasm "$WASM_PATH" \
  --source deployer \
  --network local)"

echo "Initializing receiver and executing a USDC payment..."
stellar_local contract invoke \
  --id "$RECEIVER_CONTRACT_ID" \
  --source deployer \
  --network local \
  -- init \
  --admin "$DEPLOYER_ADDRESS" \
  --treasury "$TREASURY_ADDRESS" \
  --usdc_contract "$USDC_CONTRACT_ID" \
  --xlm_contract "$XLM_CONTRACT_ID"

for identity in payer treasury; do
  stellar_local tx new change-trust \
    --source "$identity" \
    --line "USDC:$ISSUER_ADDRESS" \
    --network local
done

stellar_local contract invoke \
  --id "$USDC_CONTRACT_ID" \
  --source issuer \
  --network local \
  -- mint \
  --to "$PAYER_ADDRESS" \
  --amount 10000000

stellar_local contract invoke \
  --id "$RECEIVER_CONTRACT_ID" \
  --source payer \
  --network local \
  -- pay_usdc \
  --from "$PAYER_ADDRESS" \
  --amount 10000000 \
  --order_id 6c6f63616c2d736d6f6b65

TREASURY_BALANCE="$(stellar_local contract invoke \
  --id "$USDC_CONTRACT_ID" \
  --source deployer \
  --network local \
  -- balance \
  --id "$TREASURY_ADDRESS" | tr -d '[:space:]\"')"

if [ "$TREASURY_BALANCE" != "10000000" ]; then
  echo "Error: expected treasury balance 10000000, got $TREASURY_BALANCE" >&2
  exit 1
fi

echo "Local network integration test passed."
