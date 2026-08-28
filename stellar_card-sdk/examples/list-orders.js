#!/usr/bin/env node
/**
 * Order listing and pagination example.
 *
 * Demonstrates three approaches to fetching orders from the stellar_card API:
 *   1. Simple list — fetch one page of recent orders.
 *   2. Page-by-page — manually walk pages with `listOrdersPage`.
 *   3. Async iteration — use `iterateOrders` to stream all items without
 *      managing offsets.
 *
 * Run with:
 *   CARDS402_API_KEY='stellar_card_...' node examples/list-orders.js
 */

import { Stellar_CardClient } from 'stellar_card';

const apiKey = process.env.CARDS402_API_KEY;
if (!apiKey) {
  console.error('Error: CARDS402_API_KEY environment variable not set');
  process.exit(1);
}

const client = new Stellar_CardClient({ apiKey });

// ── 1. Simple list ───────────────────────────────────────────────────────────

async function simpleList() {
  console.log('=== 1. Simple list (first 5 orders) ===\n');

  const orders = await client.listOrders({ limit: 5 });
  if (orders.length === 0) {
    console.log('No orders found.');
    return;
  }
  for (const order of orders) {
    console.log(`  ${order.id}  ${order.status}  $${order.amount_usdc}  ${order.created_at}`);
  }
  console.log();
}

// ── 2. Page-by-page ──────────────────────────────────────────────────────────

async function pageByPage() {
  console.log('=== 2. Page-by-page (limit 3, up to 2 pages) ===\n');

  let page = await client.listOrdersPage({ limit: 3 });
  let pageNumber = 1;

  while (true) {
    console.log(`  Page ${pageNumber} (offset ${page.offset}):`);
    for (const item of page.items) {
      console.log(`    ${item.id}  ${item.status}`);
    }

    if (!page.hasMore || page.nextOffset === null || pageNumber >= 2) break;
    page = await client.listOrdersPage({ limit: 3, offset: page.nextOffset });
    pageNumber++;
  }
  if (page.hasMore) {
    console.log('  … more pages available (stopped at page 2 for demo)');
  }
  console.log();
}

// ── 3. Async iteration ───────────────────────────────────────────────────────

async function asyncIteration() {
  console.log('=== 3. Async iteration (all delivered orders, cap 10) ===\n');

  let count = 0;
  for await (const order of client.iterateOrders({ status: 'delivered', maxItems: 10 })) {
    console.log(`  ${order.id}  $${order.amount_usdc}  ${order.updated_at}`);
    count++;
  }
  console.log(`\n  Total yielded: ${count}`);
  console.log();
}

// ── 4. Budget-gated order creation ───────────────────────────────────────────

async function budgetGated() {
  console.log('=== 4. Budget check before creating an order ===\n');

  const usage = await client.getUsage();
  const remaining = usage.budget.remaining_usdc;

  if (remaining === null) {
    console.log('  No spend limit set — budget is unlimited.');
  } else if (parseFloat(remaining) < 10) {
    console.log(`  Insufficient budget: $${remaining} remaining (need $10.00).`);
    console.log('  Skipping order creation.');
    return;
  } else {
    console.log(`  Budget OK: $${remaining} remaining. Would create order here.`);
  }
  console.log();
}

async function main() {
  try {
    await simpleList();
    await pageByPage();
    await asyncIteration();
    await budgetGated();
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
