# stellar_card CLI Cheat Sheet

The `stellar_card` CLI provides command-line access to the SDK's core functionality.

## Installation

```bash
npm install -g stellar_card
# or
npx stellar_card <command>
```

## Commands

### Onboarding (First Time Setup)

```bash
# Start the onboarding flow with a claim code
stellar_card onboard --claim <claim-code>

# After onboarding, your config is saved to ~/.stellar_card/config.json
```

### Wallet Operations

```bash
# Get your wallet's Stellar address (for funding)
stellar_card wallet address

# Check XLM and USDC balances
stellar_card wallet balance

# Add USDC trustline (required before buying with USDC)
stellar_card wallet trustline
```

### Purchase a Card

```bash
# Buy a $10 card (default: USDC)
stellar_card purchase --amount 10.00

# Buy with XLM instead
stellar_card purchase --amount 10.00 --asset xlm

# Add metadata to the order
stellar_card purchase --amount 10.00 --metadata '{"merchant":"acme.com"}'

# Resume a stuck purchase (if it timed out)
stellar_card purchase --resume ord_abc123
```

### Version

```bash
# Show installed version
stellar_card version
stellar_card --version
stellar_card -v

# Check for updates
# (done automatically on each command)
```

### Help

```bash
stellar_card --help
stellar_card help
stellar_card -h
```

### MCP Server

```bash
# Start the MCP server (for LLM integration)
stellar_card mcp

# With custom API key
CARDS402_API_KEY=stellar_card_... stellar_card mcp
```

## Environment Variables

```bash
# Your stellar_card API key
export CARDS402_API_KEY='stellar_card_...'

# Custom OWS vault location (default: ~/.ows/wallets)
export OWS_VAULT_PATH='/path/to/vault'

# Passphrase to decrypt OWS wallet
export OWS_PASSPHRASE='your-passphrase'

# Custom config directory (default: ~/.stellar_card)
export CARDS402_CONFIG_DIR='/custom/config'

# Stellar network (default: public)
export STELLAR_NETWORK='testnet'

# Custom Soroban RPC endpoint
export SOROBAN_RPC_URL='https://your-rpc.example.com'
```

## Configuration File

After onboarding, your config is saved at `~/.stellar_card/config.json`:

```json
{
  "api_key": "stellar_card_xxx",
  "api_url": "https://api.stellar_card.com/v1",
  "wallet_name": "my-agent",
  "vault_path": null,
  "passphrase_env": null,
  "created_at": "2025-01-01T00:00:00Z"
}
```

## Exit Codes

```
0  Success
1  Unexpected error
2  Command-line argument error
```

## Examples

### Basic Setup

```bash
# 1. Onboard with a claim code
stellar_card onboard --claim MY_CLAIM_CODE_123

# 2. Check that wallet is funded
stellar_card wallet balance
# Output:
#   XLM: 100.00
#   USDC: 0.00

# 3. Add USDC trustline (one-time)
stellar_card wallet trustline

# 4. Buy a $10 card
stellar_card purchase --amount 10.00
# Output:
#   Card Number: 4111111111111111
#   CVV: 123
#   Expiry: 12/27
```

### Programmatic Use

Get card details programmatically:

```bash
# Output as JSON (parse in scripts)
OUTPUT=$(stellar_card purchase --amount 10.00 --json)
NUMBER=$(echo "$OUTPUT" | jq -r '.number')
echo "Card purchased: $NUMBER"
```

### Error Handling

```bash
# Capture exit code
stellar_card purchase --amount 10.00
if [ $? -eq 0 ]; then
  echo "Success"
else
  echo "Failed (exit code: $?)"
fi
```

### Scripting

```bash
#!/bin/bash
set -e

AMOUNT=${1:-10.00}
stellar_card purchase --amount "$AMOUNT"
echo "Card purchased successfully"
```

Run it:

```bash
bash purchase.sh 10.00
bash purchase.sh 25.00
```

## Troubleshooting

### Command not found

```bash
# Install globally
npm install -g stellar_card

# Or use npx
npx stellar_card <command>
```

### Config not found

```bash
# Create your config by onboarding
stellar_card onboard --claim <code>

# Or check if the file exists
cat ~/.stellar_card/config.json
```

### API key is invalid

```bash
# Re-run onboarding
stellar_card onboard --claim <new-claim-code>
```

### Wallet not funded

```bash
# Get your address
stellar_card wallet address

# Fund it via the Stellar network
# Send at least 2 XLM (for base reserve + fees)
# https://stellar.org/
```

### Purchase timeout

```bash
# Check what happened with the order
stellar_card purchase --resume <order-id>
```

## Tips

- The CLI reads config from `~/.stellar_card/config.json` after onboarding, so you don't need to pass `--api-key` each time.
- Use `--help` on any command for more options.
- Version checks run silently in the background; if your SDK is outdated, you'll see a warning on stderr.
- For production, make sure `CARDS402_API_KEY` is in a secure environment (not hardcoded).

## See Also

- Full SDK docs: https://stellar_card.com/docs
- SDK examples: `stellar_card-sdk/examples/`
- MCP protocol: https://modelcontextprotocol.io/
