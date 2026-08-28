# stellar_card SDK Examples

This directory contains practical examples of using the stellar_card SDK for AI agents, bots, and applications.

## Quick Start

All examples require a stellar_card API key. Get one by:

1. Visit https://stellar_card.com/dashboard
2. Create an account or sign in
3. Copy your API key
4. Export it: `export CARDS402_API_KEY='stellar_card_...'`

## Examples

### 1. [basic-purchase.js](./basic-purchase.js) - Purchase a Card

The quickest path to get a working card. Shows:
- Creating/accessing an OWS wallet
- Checking balance
- Purchasing a card
- Handling the full flow in one call

```bash
CARDS402_API_KEY=... node examples/basic-purchase.js
```

### 2. [keypair-wallet.js](./keypair-wallet.js) - Raw Keypair Wallet

Use a raw Stellar secret key instead of OWS encryption. Useful for:
- Automated backend services
- Existing Stellar integrations
- Development and testing

```bash
CARDS402_API_KEY=... STELLAR_SECRET=S... node examples/keypair-wallet.js
```

### 3. [error-handling.js](./error-handling.js) - Error Handling

Comprehensive examples of handling different error types:
- Invalid amounts
- Spend limits
- Rate limiting with exponential backoff
- Order failures and recovery
- Network timeouts
- Full debug information

```bash
node examples/error-handling.js
```

### 4. [list-orders.js](./list-orders.js) - Order Listing & Pagination

Four approaches to fetching order history:
- Simple list with `listOrders`
- Manual page-by-page with `listOrdersPage`
- Automatic async iteration with `iterateOrders`
- Budget-gating with `getUsage` before creating an order

```bash
CARDS402_API_KEY=... node examples/list-orders.js
```

### 5. [budget-management.js](./budget-management.js) - Budget Management

Check spend limits before purchasing and summarize order history:
- Fetch and display current budget usage
- Guard against overspend before creating an order
- Handle `SpendLimitError` from concurrent agents
- Collect full order history with `collectAllPages`

```bash
CARDS402_API_KEY=... node examples/budget-management.js
```

### 6. [mcp-usage.js](./mcp-usage.js) - Model Context Protocol

Shows how to use stellar_card as an MCP server for LLM integration. Includes:
- All available MCP tools
- Request/response examples
- How to integrate with Claude or other LLM tools

```bash
node examples/mcp-usage.js
```

### 7. [retry-strategy.js](./retry-strategy.js) - Retry Strategies

Advanced retry patterns using the SDK's retry utilities:
- Simple `withRetry` with full-jitter exponential backoff
- Rate-limit-aware manual retry with increasing delays
- `isRetryableByDefault` predicate for transient errors
- `buildErrorChain` for structured error logging

```bash
CARDS402_API_KEY=... node examples/retry-strategy.js
```

### 8. [soroban-payment.js](./soroban-payment.js) - Direct Soroban Payment

Pay a stellar_card order directly via the Soroban smart contract using a raw Stellar keypair:
- Create an order via the REST API
- Submit payment through `payViaContract`
- Wait for the virtual card with timeout handling
- Structured error wrapping and recovery hints

```bash
CARDS402_API_KEY=... STELLAR_SECRET=S... node examples/soroban-payment.js
```

### 5. [cli-commands.md](./cli-commands.md) - CLI Cheat Sheet

Command-line reference for the `stellar_card` CLI tool.

## SDK Installation

```bash
npm install stellar_card
```

For development:

```bash
cd stellar_card-sdk
npm install
npm run build
npm run test
```

## Common Patterns

### Environment-based Configuration

```bash
# Set up environment
export CARDS402_API_KEY='stellar_card_your_key'
export OWS_VAULT_PATH='/persistent/storage'

# Run your code
node my-app.js
```

### Error Handling Template

```typescript
import { purchaseCardOWS, RateLimitError, WaitTimeoutError } from 'stellar_card';

try {
  const card = await purchaseCardOWS({
    apiKey: process.env.CARDS402_API_KEY!,
    walletName: 'agent',
    amountUsdc: '10.00',
  });
} catch (err) {
  if (err instanceof RateLimitError) {
    // Back off and retry
  } else if (err instanceof WaitTimeoutError) {
    // Order may still complete; check status later
  } else {
    // Other error
  }
}
```

### Retry Logic

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries) throw err;
      // Exponential backoff: 1s, 2s, 4s
      await new Promise(r => setTimeout(r, Math.pow(2, i - 1) * 1000));
    }
  }
  throw new Error('Should not reach here');
}

const card = await withRetry(() =>
  purchaseCardOWS({
    apiKey: process.env.CARDS402_API_KEY!,
    walletName: 'agent',
    amountUsdc: '10.00',
  }),
);
```

## Wallet Setup

### Create a Wallet (One-time)

```bash
stellar_card onboard --claim <claim-code>
```

This:
1. Creates an OWS wallet
2. Gets an API key
3. Saves both to `~/.stellar_card/config.json`

### Check Balance

```bash
stellar_card wallet balance
```

### Add USDC Trustline

Required before buying with USDC:

```bash
stellar_card wallet trustline
```

## API Reference

Full API docs: https://stellar_card.com/docs

Key functions:

```typescript
// OWS Wallet Functions
createOWSWallet(name, passphrase?, vaultPath?)
getOWSPublicKey(name, vaultPath?)
getOWSBalance(name, vaultPath?, networkPassphrase?)
purchaseCardOWS(opts)
payViaContractOWS(opts)

// Raw Keypair Functions
createWallet()
getBalance(publicKey)
addUsdcTrustline(secret)
purchaseCard(opts)

// Client Functions
client.createOrder(opts)
client.getOrder(orderId)
client.waitForCard(orderId, opts)
client.listOrders(opts)

// Error Handling
parseApiError(status, body)
wrapError(err, context)
wrapNetworkError(err, endpoint, operation)
wrapTimeoutError(operation, timeoutMs)
```

## Troubleshooting

### "Invalid API key"

Make sure your API key is set:

```bash
echo $CARDS402_API_KEY
# Should print: stellar_card_...
```

### "Insufficient balance"

Fund your wallet with at least:
- **2 XLM** for base reserve + USDC trustline + fees
- Or **10 USDC** + 2 XLM (if USDC trustline already exists)

Fund the address shown:

```bash
stellar_card wallet address
```

### "Timeout waiting for card"

Orders usually complete in 60 seconds. If it times out:

```bash
# Check the order status
stellar_card purchase --resume <order-id>
```

### Network Errors

Check your internet connection and that `api.stellar_card.com` is reachable:

```bash
curl -I https://api.stellar_card.com/v1/health
```

## Support

- Docs: https://stellar_card.com/docs
- Discord: https://stellar_card.com/discord
- Email: support@stellar_card.com
