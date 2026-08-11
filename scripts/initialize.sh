#!/bin/bash
set -e

# Initialize script for Stellar_Card receiver contract
# Calls the init() function to set up treasury, admin, and token contracts

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACT_ID="${1:-}"
ADMIN_KEY="${2:-}"
TREASURY="${3:-}"
USDC_CONTRACT="${4:-}"
XLM_CONTRACT="${5:-}"
NETWORK="${6:-testnet}"

# Load contract ID from .contract_id file if not provided
if [ -z "$CONTRACT_ID" ] && [ -f "$PROJECT_ROOT/.contract_id" ]; then
  CONTRACT_ID=$(cat "$PROJECT_ROOT/.contract_id")
fi

# Helper function to display usage
show_usage() {
  echo "Initialize Stellar_Card receiver contract"
  echo ""
  echo "Usage: ./initialize.sh [CONTRACT_ID] [ADMIN_KEY] [TREASURY] [USDC_CONTRACT] [XLM_CONTRACT] [NETWORK]"
  echo ""
  echo "Parameters:"
  echo "  CONTRACT_ID        - Contract address (C...)"
  echo "  ADMIN_KEY          - Admin's secret key (S...)"
  echo "  TREASURY           - Treasury public address (G...)"
  echo "  USDC_CONTRACT      - USDC SAC contract address (C...)"
  echo "  XLM_CONTRACT       - XLM SAC contract address (C...)"
  echo "  NETWORK            - Network: testnet or mainnet (default: testnet)"
  echo ""
  echo "Environment variables (as fallback):"
  echo "  RECEIVER_CONTRACT_ID - Contract ID"
  echo "  ADMIN_SECRET_KEY      - Admin's secret key"
  echo "  TREASURY_ADDRESS      - Treasury address"
  echo "  USDC_SAC_CONTRACT     - USDC SAC address"
  echo "  XLM_SAC_CONTRACT      - XLM SAC address"
  echo "  SOROBAN_NETWORK       - Network (testnet/mainnet)"
  echo ""
  echo "Notes:"
  echo "  - Contract ID will be auto-loaded from .contract_id file if present"
  echo "  - Testnet mainnet USDC SAC: CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75"
  echo "  - Testnet mainnet XLM SAC: CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"
}

# Use environment variables as fallback
CONTRACT_ID="${CONTRACT_ID:-$RECEIVER_CONTRACT_ID}"
ADMIN_KEY="${ADMIN_KEY:-$ADMIN_SECRET_KEY}"
TREASURY="${TREASURY:-$TREASURY_ADDRESS}"
USDC_CONTRACT="${USDC_CONTRACT:-$USDC_SAC_CONTRACT}"
XLM_CONTRACT="${XLM_CONTRACT:-$XLM_SAC_CONTRACT}"
NETWORK="${NETWORK:-${SOROBAN_NETWORK:-testnet}}"

# Validate inputs
validate_input() {
  local value="$1"
  local name="$2"
  local pattern="$3"

  if [ -z "$value" ]; then
    echo "Error: $name is required"
    echo ""
    show_usage
    exit 1
  fi

  if [[ ! "$value" =~ $pattern ]]; then
    echo "Error: Invalid $name format: $value"
    exit 1
  fi
}

echo "=========================================="
echo "Initializing Stellar_Card Contract"
echo "=========================================="
echo ""

# Validate network
if [[ ! "$NETWORK" =~ ^(testnet|mainnet)$ ]]; then
  echo "Error: Invalid network '$NETWORK'. Must be 'testnet' or 'mainnet'"
  exit 1
fi

validate_input "$CONTRACT_ID" "CONTRACT_ID" "^C[A-Z0-9]{55}$"
validate_input "$ADMIN_KEY" "ADMIN_KEY" "^S[A-Z0-9]{55}$"
validate_input "$TREASURY" "TREASURY" "^G[A-Z0-9]{55}$"
validate_input "$USDC_CONTRACT" "USDC_CONTRACT" "^C[A-Z0-9]{55}$"
validate_input "$XLM_CONTRACT" "XLM_CONTRACT" "^C[A-Z0-9]{55}$"

echo "Validating inputs..."
echo "✓ CONTRACT_ID: ${CONTRACT_ID:0:10}..."
echo "✓ ADMIN_KEY: ${ADMIN_KEY:0:10}..."
echo "✓ TREASURY: ${TREASURY:0:10}..."
echo "✓ USDC_CONTRACT: ${USDC_CONTRACT:0:10}..."
echo "✓ XLM_CONTRACT: ${XLM_CONTRACT:0:10}..."
echo "✓ NETWORK: $NETWORK"
echo ""

# Check stellar-cli is installed
if ! command -v stellar &> /dev/null; then
  echo "Error: stellar-cli is not installed. Please install it with: cargo install --locked stellar-cli"
  exit 1
fi

echo "Calling init() on contract..."
if ! stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- init \
  --admin "$TREASURY" \
  --treasury "$TREASURY" \
  --usdc_contract "$USDC_CONTRACT" \
  --xlm_contract "$XLM_CONTRACT"; then
  echo ""
  echo "Error: Failed to initialize contract"
  exit 1
fi

echo ""
echo "=========================================="
echo "Contract Initialization Complete!"
echo "=========================================="
echo ""
echo "Contract details:"
echo "  Contract ID: $CONTRACT_ID"
echo "  Network: $NETWORK"
echo "  Treasury: $TREASURY"
echo ""
echo "Next steps:"
echo "1. Verify initialization by checking the contract state:"
echo "   stellar contract read \\"
echo "     --id $CONTRACT_ID \\"
echo "     --network $NETWORK \\"
echo "     -- treasury"
echo ""
echo "2. Set environment variable:"
echo "   export RECEIVER_CONTRACT_ID=$CONTRACT_ID"
echo ""
echo "=========================================="
