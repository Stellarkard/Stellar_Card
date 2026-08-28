#!/usr/bin/env node
/**
 * Budget management example.
 *
 * Shows how to check your remaining budget before purchasing a card,
 * iterate order history, and handle spend-limit errors gracefully.
 *
 * Run with:
 *   CARDS402_API_KEY='stellar_card_...' node examples/budget-management.js
 */

import {
  Stellar_CardClient,
  SpendLimitError,
  collectAllPages,
} from 'stellar_card';

async function main() {
  const apiKey = process.env.CARDS402_API_KEY;
  if (!apiKey) {
    console.error('Set CARDS402_API_KEY before running this example.');
    process.exit(1);
  }

  const client = new Stellar_CardClient({ apiKey });

  // ── 1. Check current budget usage ─────────────────────────────────────────
  console.log('Checking budget usage...\n');
  const usage = await client.getUsage();

  const spent = parseFloat(usage.budget.spent_usdc);
  const limit = parseFloat(usage.budget.limit_usdc);
  const remaining = limit - spent;

  console.log(`Budget:    $${usage.budget.limit_usdc}`);
  console.log(`Spent:     $${usage.budget.spent_usdc}`);
  console.log(`Remaining: $${remaining.toFixed(2)}`);
  console.log(`In-flight: ${usage.budget.orders_in_flight} order(s)\n`);

  // ── 2. Guard against overspend before creating an order ───────────────────
  const wantToSpend = 10.00;
  if (remaining < wantToSpend) {
    console.warn(
      `Insufficient budget — need $${wantToSpend.toFixed(2)} but only $${remaining.toFixed(2)} remains.`,
    );
    console.warn('Contact your dashboard operator to raise the limit.');
    process.exit(0);
  }

  console.log(`Budget OK — proceeding to create a $${wantToSpend.toFixed(2)} order...\n`);

  try {
    const order = await client.createOrder({ amount_usdc: String(wantToSpend.toFixed(2)) });
    console.log(`Order created: ${order.order_id}`);
    console.log(`Status: ${order.status}\n`);
  } catch (err) {
    if (err instanceof SpendLimitError) {
      // Race condition: another agent spent the budget between check and create.
      console.error(`Spend limit hit: ${err.message}`);
      console.error(`Spent $${err.spent} of $${err.limit} limit.`);
    } else {
      throw err;
    }
  }

  // ── 3. Fetch full order history using collectAllPages ─────────────────────
  console.log('Fetching complete order history...\n');

  const allOrders = await collectAllPages({
    fetchPage: (cursor) =>
      client
        .listOrdersPage({ limit: cursor.limit, offset: cursor.offset })
        .then((page) => page.orders),
    limit: 25,
  });

  console.log(`Total orders found: ${allOrders.length}`);

  const totalSpent = allOrders.reduce((sum, o) => {
    return o.amount_usdc ? sum + parseFloat(o.amount_usdc) : sum;
  }, 0);
  console.log(`Lifetime spend: $${totalSpent.toFixed(2)}`);

  const byStatus = allOrders.reduce(
    (acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    },
    /** @type {Record<string, number>} */ ({}),
  );
  console.log('\nOrders by status:');
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}`);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
