#!/usr/bin/env node
/**
 * Error handling example.
 * 
 * Shows how to catch and handle different error types from the SDK.
 * Each error type has specific properties you can check:
 *   - SpendLimitError: .limit, .spent
 *   - OrderFailedError: .orderId, .refund
 *   - RateLimitError: back off and retry
 *   - NetworkError, TimeoutError: network issues
 * 
 * Run with:
 *   CARDS402_API_KEY='stellar_card_...' node examples/error-handling.js
 */

import {
  Stellar_CardClient,
  Stellar_CardError,
  SpendLimitError,
  RateLimitError,
  ServiceUnavailableError,
  InvalidAmountError,
  AuthError,
  OrderFailedError,
  WaitTimeoutError,
  NetworkError,
  TimeoutError,
  purchaseCardOWS,
} from 'stellar_card';

async function example1_ApiErrors() {
  const apiKey = process.env.CARDS402_API_KEY || 'test_key';
  const client = new Stellar_CardClient({ apiKey });

  console.log('Example 1: API Error Handling\n');

  try {
    // Try to create an order with an invalid amount
    const order = await client.createOrder({ amount_usdc: '0.00' });
    console.log('Order created:', order.order_id);
  } catch (err) {
    // Type-narrow to handle specific errors
    if (err instanceof InvalidAmountError) {
      console.error('✗ Invalid amount:', err.message);
      console.error('  Please specify an amount between 0.01 and 10000.00');
    } else if (err instanceof AuthError) {
      console.error('✗ Authentication failed:', err.message);
      console.error('  Check your API key');
    } else if (err instanceof Stellar_CardError) {
      console.error(`✗ API error (${err.code}):`, err.message);
    }
  }
}

async function example2_RateLimiting() {
  const apiKey = process.env.CARDS402_API_KEY || 'test_key';
  const client = new Stellar_CardClient({ apiKey });

  console.log('\nExample 2: Rate Limiting & Retry Logic\n');

  // Implement exponential backoff for rate limits
  const createOrderWithRetry = async (maxRetries = 3) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt}...`);
        const order = await client.createOrder({ amount_usdc: '10.00' });
        console.log('✓ Order created:', order.order_id);
        return order;
      } catch (err) {
        if (err instanceof RateLimitError && attempt < maxRetries) {
          // Back off exponentially: 1s, 2s, 4s
          const delayMs = Math.pow(2, attempt - 1) * 1000;
          console.warn(`Rate limited. Waiting ${delayMs}ms before retry...`);
          await new Promise((r) => setTimeout(r, delayMs));
        } else {
          throw err;
        }
      }
    }
  };

  try {
    await createOrderWithRetry();
  } catch (err) {
    console.error('Failed after retries:', err instanceof Error ? err.message : String(err));
  }
}

async function example3_OrderFailure() {
  const apiKey = process.env.CARDS402_API_KEY || 'test_key';

  console.log('\nExample 3: Order Failure & Recovery\n');

  try {
    // Simulate a failed order scenario
    const walletName = 'recovery-test';
    const order = await purchaseCardOWS({
      apiKey,
      walletName,
      amountUsdc: '10.00',
    });
    console.log('Card ready:', order.number);
  } catch (err) {
    if (err instanceof OrderFailedError) {
      console.error(
        `✗ Order ${err.orderId} failed: ${err.message}`,
      );
      if (err.refund) {
        console.error(`  Refund in progress: ${err.refund.stellar_txid}`);
      }
    } else if (err instanceof WaitTimeoutError) {
      console.error(
        `✗ Timeout waiting for order ${err.orderId}`,
      );
      console.error('  Order may still be processing. Check status later.');
      console.error(`  Run: stellar_card purchase --resume ${err.orderId}`);
    } else {
      console.error('Error:', err instanceof Error ? err.message : String(err));
    }
  }
}

async function example4_NetworkErrors() {
  console.log('\nExample 4: Network Error Handling\n');

  const simulateNetworkError = async () => {
    try {
      // In real code, this would be an actual SDK call that fails
      throw new NetworkError('Connection timeout', 'api.stellar_card.com', 'create_order');
    } catch (err) {
      if (err instanceof NetworkError) {
        console.error('✗ Network error:', err.message);
        console.error('  Recovery hint:', err.context?.recoveryHint);
        if (err.context?.cause) {
          console.error('  Caused by:', err.context.cause.message);
        }
      }
    }
  };

  await simulateNetworkError();
}

async function example5_TimeoutHandling() {
  console.log('\nExample 5: Timeout Handling\n');

  const client = new Stellar_CardClient({ apiKey: 'test_key' });

  try {
    // Simulate waiting with a short timeout
    // In real code: client.waitForCard('ord_123', { timeoutMs: 5000 })
    throw new TimeoutError('waitForCard', 5000);
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.error('✗ Timeout:', err.message);
      console.error('  Suggestion: Increase timeout or check order status later');
    }
  }
}

async function example6_DebugOutput() {
  console.log('\nExample 6: Full Error Debug Information\n');

  try {
    // Create an error with full context
    throw new Stellar_CardError(
      'Something went wrong',
      'example_error',
      500,
      { details: 'extra' },
      {
        source: 'example_script',
        operation: 'create_order',
        recoveryHint: 'Check logs and try again',
      },
    );
  } catch (err) {
    if (err instanceof Stellar_CardError) {
      console.log('Error debug output:');
      console.log(err.toDebugString());
    }
  }
}

async function main() {
  try {
    await example1_ApiErrors();
    await example2_RateLimiting();
    await example3_OrderFailure();
    await example4_NetworkErrors();
    await example5_TimeoutHandling();
    await example6_DebugOutput();
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

main();
