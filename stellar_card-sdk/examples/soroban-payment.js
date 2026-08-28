#!/usr/bin/env node
/**
 * soroban-payment.js — Direct Soroban contract payment example
 *
 * Shows how to pay a stellar_card order directly via the Soroban smart contract
 * using a raw Stellar keypair (no OWS wallet required).
 *
 * This is useful for:
 *   - Backend services with an existing Stellar keypair
 *   - Testing and CI environments
 *   - Integrations that manage their own key storage
 *
 * Prerequisites:
 *   1. A funded Stellar account (at least 2 XLM + USDC or XLM for payment)
 *   2. USDC trustline if paying in USDC (run: stellar_card wallet trustline)
 *
 * Run:
 *   CARDS402_API_KEY='stellar_card_...' \
 *   STELLAR_SECRET='S...'              \
 *   node examples/soroban-payment.js
 */

import {
  Stellar_CardClient,
  payViaContract,
  wrapError,
  wrapSorobanError,
  buildErrorChain,
  SorobanRpcError,
  NetworkError,
  isRetryableByDefault,
  withRetry,
} from 'stellar_card';

const apiKey = process.env.CARDS402_API_KEY;
const walletSecret = process.env.STELLAR_SECRET;

if (!apiKey) {
  console.error('Error: CARDS402_API_KEY environment variable is required.');
  console.error('  export CARDS402_API_KEY=stellar_card_...');
  process.exit(1);
}
if (!walletSecret) {
  console.error('Error: STELLAR_SECRET environment variable is required.');
  console.error('  export STELLAR_SECRET=S...');
  process.exit(1);
}

const client = new Stellar_CardClient({ apiKey });

// ── Step 1: Create an order ───────────────────────────────────────────────────

async function createOrder(amountUsdc) {
  console.log(`Creating order for $${amountUsdc} USDC...`);

  try {
    const order = await withRetry({
      fn: () => client.createOrder({ amount_usdc: amountUsdc }),
      maxRetries: 2,
      isRetryable: isRetryableByDefault,
    });

    console.log(`✓ Order created: ${order.order_id}`);
    console.log(`  Payment instructions received`);
    return order;
  } catch (err) {
    throw wrapError(err, {
      operation: 'create_order',
      source: 'soroban-payment-example',
    });
  }
}

// ── Step 2: Pay via Soroban contract ─────────────────────────────────────────

async function payOrder(order) {
  console.log('\nSubmitting payment via Soroban contract...');
  console.log(`  Payment asset: ${order.payment_instructions?.payment_asset ?? 'xlm'}`);

  try {
    const txHash = await payViaContract({
      walletSecret,
      payment: order.payment_instructions,
    });

    console.log(`✓ Payment submitted: ${txHash}`);
    return txHash;
  } catch (err) {
    // Wrap Soroban-specific errors with context
    if (err instanceof SorobanRpcError || err instanceof NetworkError) {
      throw wrapSorobanError(err, undefined, 'pay_via_contract');
    }
    throw wrapError(err, { operation: 'pay_via_contract' });
  }
}

// ── Step 3: Wait for the card ─────────────────────────────────────────────────

async function waitForCard(orderId) {
  console.log('\nWaiting for card fulfillment...');

  try {
    const card = await client.waitForCard(orderId, {
      timeoutMs: 90_000,   // 90 s — slightly more generous than default
      pollIntervalMs: 3000,
    });

    console.log('\n✓ Card ready!');
    console.log(`  Number:  ${card.number}`);
    console.log(`  Expiry:  ${card.expiry}`);
    console.log(`  CVV:     ${card.cvv}`);
    return card;
  } catch (err) {
    throw wrapError(err, { operation: 'wait_for_card', metadata: { orderId } });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== stellar_card SDK — Soroban Payment Example ===\n');

  try {
    // 1. Create the order
    const order = await createOrder('10.00');

    // 2. Pay via Soroban
    await payOrder(order);

    // 3. Wait for the virtual card
    const card = await waitForCard(order.order_id);

    console.log('\n=== Payment complete ===');
    console.log(`Order ID: ${order.order_id}`);
    console.log(`Card number ends in: ${card.number?.slice(-4)}`);
  } catch (err) {
    console.error('\n✗ Payment failed:', buildErrorChain(err));

    // Offer resume hint when an order was partially created
    if (err?.context?.metadata?.orderId) {
      console.error(`\n  Resume with: stellar_card purchase --resume ${err.context.metadata.orderId}`);
    }

    process.exit(1);
  }
}

main();
