#!/bin/bash
set -e

# Deploy script for Stellar_Card receiver contract to testnet
# Builds optimized WASM, deploys to specified network, and initializes contract

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
NETWORK="${1:-testnet}"
CONTRACT_NAME="stellar_card_receiver"
WASM_PATH="$PROJECT_ROOT/target/wasm32-unknown-unknown/release/${CONTRACT_NAME}.wasm"
OPTIMIZED_WASM="${WASM_PATH%.wasm}.optimized.wasm"
IDENTITY="${DEPLOYER_KEY:-deployer}"
OUTPUT_FILE="${PROJECT_ROOT}/.contract_id"

# Validate network input
if [[ ! "$NETWORK" =~ ^(testnet|mainnet)$ ]]; then
  echo "Error: Invalid network '$NETWORK'. Must be 'testnet' or 'mainnet'"
  exit 1
fi

# Check if stellar-cli is installed
if ! command -v stellar &> /dev/null; then
  echo "Error: stellar-cli is not installed. Please install it with: cargo install --locked stellar-cli"
  exit 1
fi

# Check if cargo is installed
if ! command -v cargo &> /dev/null; then
  echo "Error: cargo is not installed. Please install Rust."
  exit 1
fi

echo "=========================================="
echo "Stellar_Card Contract Deployment"
echo "=========================================="
echo "Network: $NETWORK"
echo "Project Root: $PROJECT_ROOT"
echo ""

echo "[1/4] Building contract..."
cd "$PROJECT_ROOT"
if ! cargo build --target wasm32-unknown-unknown --release 2>&1 | tail -20; then
  echo "Error: Failed to build contract"
  exit 1
fi

if [ ! -f "$WASM_PATH" ]; then
  echo "Error: WASM file not found at $WASM_PATH"
  exit 1
fi

echo "✓ Build successful"
echo ""

echo "[2/4] Optimizing WASM..."
if ! stellar contract optimize --wasm "$WASM_PATH" 2>&1 | tail -10; then
  echo "Error: Failed to optimize WASM"
  exit 1
fi

if [ ! -f "$OPTIMIZED_WASM" ]; then
  echo "Error: Optimized WASM file not found at $OPTIMIZED_WASM"
  exit 1
fi

echo "✓ Optimization successful"
echo "Optimized WASM size: $(ls -lh "$OPTIMIZED_WASM" | awk '{print $5}')"
echo ""

echo "[3/4] Deploying contract to $NETWORK..."
if ! CONTRACT_ID=$(stellar contract deploy \
  --wasm "$OPTIMIZED_WASM" \
  --source "$IDENTITY" \
  --network "$NETWORK" 2>&1); then
  echo "Error: Failed to deploy contract"
  exit 1
fi

if [ -z "$CONTRACT_ID" ]; then
  echo "Error: Contract ID is empty. Deployment may have failed."
  exit 1
fi

echo "✓ Deployment successful"
echo "Contract ID: $CONTRACT_ID"
echo ""

# Save the contract ID to a file for frontend/backend to use
echo "$CONTRACT_ID" > "$OUTPUT_FILE"
echo "[4/4] Saved contract ID to $OUTPUT_FILE"
echo ""

echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Initialize the contract by calling the init() function:"
echo "   stellar contract invoke \\"
echo "     --id $CONTRACT_ID \\"
echo "     --source <ADMIN_SECRET_KEY> \\"
echo "     --network $NETWORK \\"
echo "     -- init \\"
echo "     --admin <ADMIN_PUBLIC_KEY> \\"
echo "     --treasury <TREASURY_PUBLIC_KEY> \\"
echo "     --usdc_contract <USDC_CONTRACT_ID> \\"
echo "     --xlm_contract <XLM_CONTRACT_ID>"
echo ""
echo "2. Save the contract ID as an environment variable:"
echo "   export RECEIVER_CONTRACT_ID=$CONTRACT_ID"
echo ""
echo "=========================================="
