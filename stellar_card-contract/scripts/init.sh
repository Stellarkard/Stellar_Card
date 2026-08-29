#!/bin/bash
set -euo pipefail

# Initialize the Stellar_Card receiver contract after deployment.
# This stores the admin, treasury, USDC, and XLM contract addresses.
# Usage: ./scripts/init.sh --network testnet --contract-id <ID> --admin <G...> --treasury <G...> --usdc <C...> --xlm <C...>

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTRACT_DIR="$(dirname "$SCRIPT_DIR")"

NETWORK="testnet"
IDENTITY="deployer"
CONTRACT_ID=""
ADMIN=""
TREASURY=""
USDC_CONTRACT=""
XLM_CONTRACT=""

usage() {
  echo "Usage: $0 --network <testnet|mainnet> --contract-id <ID> --admin <G...> --treasury <G...> --usdc <C...> --xlm <C...>"
  echo ""
  echo "Options:"
  echo "  --network       Network (default: testnet)"
  echo "  --identity      Stellar identity to authorize the call (default: deployer)"
  echo "  --contract-id   Contract ID to initialize"
  echo "  --admin         Admin public key (G...)"
  echo "  --treasury      Treasury public key (G...)"
  echo "  --usdc          USDC SAC contract address (C...)"
  echo "  --xlm           XLM SAC contract address (C...)"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --network)       NETWORK="$2"; shift 2 ;;
    --identity)      IDENTITY="$2"; shift 2 ;;
    --contract-id)   CONTRACT_ID="$2"; shift 2 ;;
    --admin)         ADMIN="$2"; shift 2 ;;
    --treasury)      TREASURY="$2"; shift 2 ;;
    --usdc)          USDC_CONTRACT="$2"; shift 2 ;;
    --xlm)           XLM_CONTRACT="$2"; shift 2 ;;
    -h|--help)       usage ;;
    *)               echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$CONTRACT_ID" || -z "$ADMIN" || -z "$TREASURY" || -z "$USDC_CONTRACT" || -z "$XLM_CONTRACT" ]]; then
  echo "Error: All parameters are required."
  usage
fi

echo "=== Initializing Stellar_Card Contract ==="
echo "Network:    $NETWORK"
echo "Contract:   $CONTRACT_ID"
echo "Admin:      $ADMIN"
echo "Treasury:   $TREASURY"
echo "USDC:       $USDC_CONTRACT"
echo "XLM:        $XLM_CONTRACT"
echo ""

stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$IDENTITY" \
  --network "$NETWORK" \
  -- init \
  --admin "$ADMIN" \
  --treasury "$TREASURY" \
  --usdc_contract "$USDC_CONTRACT" \
  --xlm_contract "$XLM_CONTRACT"

echo "=== Initialization Complete ==="
echo "The contract is now initialized and ready to accept payments."
echo ""
echo "Verify with:"
echo "  stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- admin"
echo "  stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- treasury"
