#!/usr/bin/env node
/**
 * retry-strategy.js — Retry strategies with the stellar_card SDK
 *
 * Demonstrates the three levels of retry control available in the SDK:
 *
 *   1. Simple withRetry — exponential backoff with full-jitter (default)
 *   2. withAdvancedRetry — custom backoff model + shouldRetry predicate
 *   3. isRetryableByDefault — plug-and-play predicate for common transient errors
 *
 * Run:
 *   CARDS402_API_KEY='stellar_card_...' node examples/retry-strategy.js
 */

import {
  Stellar_CardClient,
  withRetry,
  RateLimitError,
  ServiceUnavailableError,
  NetworkError,
  isRetryableByDefault,
  buildErrorChain,
} from 'stellar_card';

const apiKey = process.env.CARDS402_API_KEY || 'stellar_card_demo_key';
const client = new Stellar_CardClient({ apiKey });

// ── 1. Simple withRetry ───────────────────────────────────────────────────────

async function example1_simpleRetry() {
  console.log('Example 1: Simple withRetry with full-jitter exponential backoff\n');

  try {
    const order = await withRetry({
      fn: () => client.createOrder({ amount_usdc: '10.00' }),
      maxRetries: 3,
      baseDelayMs: 500,
      maxDelayMs: 8000,
      // Only retry transient errors — auth/validation failures should surface immediately.
      isRetryable: isRetryableByDefault,
      onRetry: (err, attempt, delayMs) => {
        const type = err instanceof Error ? err.constructor.name : 'UnknownError';
        console.log(`  Retry ${attempt + 1}: ${type} — waiting ${delayMs}ms`);
      },
    });
    console.log('✓ Order created:', order.order_id);
  } catch (err) {
    console.error('✗ Failed after retries:', buildErrorChain(err));
  }
}

// ── 2. Rate-limit-specific backoff ────────────────────────────────────────────

async function example2_rateLimitBackoff() {
  console.log('\nExample 2: Rate-limit-aware retry with longer backoff\n');

  const createWithBackoff = async (maxRetries = 4) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`  Attempt ${attempt}...`);
        return await client.createOrder({ amount_usdc: '10.00' });
      } catch (err) {
        if (err instanceof RateLimitError && attempt < maxRetries) {
          // Double the delay each time: 2s, 4s, 8s
          const delayMs = Math.pow(2, attempt) * 1000;
          console.warn(`  Rate limited — backing off ${delayMs / 1000}s before retry`);
          await new Promise((r) => setTimeout(r, delayMs));
        } else {
          throw err;
        }
      }
    }
  };

  try {
    const order = await createWithBackoff();
    console.log('✓ Order created:', order?.order_id);
  } catch (err) {
    console.error('✗ Failed:', buildErrorChain(err));
  }
}

// ── 3. Service-unavailable retry ──────────────────────────────────────────────

async function example3_serviceUnavailableRetry() {
  console.log('\nExample 3: Retry only on ServiceUnavailableError\n');

  try {
    const order = await withRetry({
      fn: () => client.createOrder({ amount_usdc: '25.00' }),
      maxRetries: 2,
      baseDelayMs: 3000,
      isRetryable: (err) => err instanceof ServiceUnavailableError,
      onRetry: (_, attempt) => {
        console.log(`  Service temporarily down — retry ${attempt + 1}`);
      },
    });
    console.log('✓ Order created:', order.order_id);
  } catch (err) {
    if (err instanceof ServiceUnavailableError) {
      console.error('✗ Service still unavailable after retries:', err.message);
      console.error('  Check: https://status.stellar_card.com');
    } else {
      console.error('✗ Non-retryable error:', buildErrorChain(err));
    }
  }
}

// ── 4. Error-chain logging ────────────────────────────────────────────────────

async function example4_errorChainLogging() {
  console.log('\nExample 4: Structured error chain logging with buildErrorChain\n');

  // Simulate a nested error scenario
  const root = new Error('TCP connection reset');
  const network = new NetworkError('Connection refused', 'api.stellar_card.com', root, {
    operation: 'create_order',
  });

  console.log('Error chain:', buildErrorChain(network));
  // Outputs: "Network error communicating with api.stellar_card.com: Connection refused... → TCP connection reset"
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== stellar_card SDK — Retry Strategy Examples ===\n');
  await example1_simpleRetry();
  await example2_rateLimitBackoff();
  await example3_serviceUnavailableRetry();
  await example4_errorChainLogging();
  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal:', buildErrorChain(err));
  process.exit(1);
});
