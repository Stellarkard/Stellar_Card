#!/bin/bash
set -euo pipefail

# Upgrade the Stellar_Card receiver contract to a new WASM version.
# This uploads the new WASM and invokes the upgrade function.
# Usage: ./scripts/upgrade.sh --network testnet --contract-id <ID> [--wasm <path>]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTRACT_DIR="$(dirname "$SCRIPT_DIR")"

NETWORK="testnet"
IDENTITY="deployer"
CONTRACT_ID=""
WASM_PATH=""

usage() {
  echo "Usage: $0 --network <testnet|mainnet> --contract-id <ID> [--wasm <path>]"
  echo ""
  echo "Options:"
  echo "  --network       Network (default: testnet)"
  echo "  --identity      Stellar identity to authorize the call (default: deployer)"
  echo "  --contract-id   Contract ID to upgrade"
  echo "  --wasm          Path to optimized WASM (default: builds fresh)"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --network)     NETWORK="$2"; shift 2 ;;
    --identity)    IDENTITY="$2"; shift 2 ;;
    --contract-id) CONTRACT_ID="$2"; shift 2 ;;
    --wasm)        WASM_PATH="$2"; shift 2 ;;
    -h|--help)     usage ;;
    *)             echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$CONTRACT_ID" ]]; then
  echo "Error: --contract-id is required."
  usage
fi

echo "=== Upgrading Stellar_Card Contract ==="
echo "Network:    $NETWORK"
echo "Contract:   $CONTRACT_ID"
echo ""

if [[ -z "$WASM_PATH" ]]; then
  echo "[1/3] Building and optimizing WASM..."
  cd "$CONTRACT_DIR"
  cargo build --target wasm32-unknown-unknown --release

  OPTIMIZED_DIR="$CONTRACT_DIR/target/optimized"
  mkdir -p "$OPTIMIZED_DIR"
  WASM_PATH="$OPTIMIZED_DIR/stellar_card_receiver.optimized.wasm"

  stellar contract optimize \
    --wasm "target/wasm32-unknown-unknown/release/stellar_card_receiver.wasm" \
    --output "$WASM_PATH"
else
  echo "[1/3] Using provided WASM: $WASM_PATH"
fi

if [[ ! -f "$WASM_PATH" ]]; then
  echo "Error: WASM file not found at $WASM_PATH"
  exit 1
fi

WASM_SIZE=$(wc -c < "$WASM_PATH" | tr -d ' ')
echo "  WASM size: $WASM_SIZE bytes"

echo "[2/3] Installing new WASM on-chain..."
WASM_HASH=$(stellar contract install \
  --wasm "$WASM_PATH" \
  --source "$IDENTITY" \
  --network "$NETWORK")

echo "  WASM hash: $WASM_HASH"

echo "[3/3] Invoking upgrade..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$IDENTITY" \
  --network "$NETWORK" \
  -- upgrade \
  --new_wasm_hash "$WASM_HASH"

echo ""
echo "=== Upgrade Complete ==="
echo "Contract $CONTRACT_ID upgraded to WASM hash $WASM_HASH"
echo ""
echo "Verify with:"
echo "  stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- admin"
