#!/usr/bin/env node
/**
 * Batch card purchasing example.
 *
 * Demonstrates:
 * - Purchasing multiple cards in sequence
 * - Managing concurrent purchases with rate limiting
 * - Tracking purchase progress
 * - Error recovery per card
 * - Summary reporting
 *
 * Run with:
 *   CARDS402_API_KEY='stellar_card_...' node examples/batch-card-purchasing.js
 */

import { purchaseCardOWS, RateLimitError, WaitTimeoutError, Stellar_CardClient } from 'stellar_card';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function purchaseWithRetry(apiKey, walletName, amountUsdc, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await purchaseCardOWS({
        apiKey,
        walletName,
        amountUsdc,
        timeoutMs: 120000,
      });
    } catch (err) {
      if (err instanceof RateLimitError) {
        const backoffMs = Math.pow(2, attempt - 1) * 5000;
        console.log(`   Rate limited. Backing off ${backoffMs}ms before retry ${attempt}/${maxRetries}`);
        await sleep(backoffMs);
        if (attempt === maxRetries) throw err;
      } else if (err instanceof WaitTimeoutError) {
        console.log(`   Purchase initiated but timed out. Card may still complete. Order tracking needed.`);
        throw err;
      } else {
        throw err;
      }
    }
  }
}

async function main() {
  const apiKey = process.env.CARDS402_API_KEY;
  if (!apiKey) {
    console.error('Error: CARDS402_API_KEY environment variable not set');
    process.exit(1);
  }

  const walletName = 'batch-processor';
  const purchaseRequests = [
    { amount: '10.00', label: 'Card 1' },
    { amount: '25.00', label: 'Card 2' },
    { amount: '50.00', label: 'Card 3' },
    { amount: '15.00', label: 'Card 4' },
    { amount: '20.00', label: 'Card 5' },
  ];

  try {
    console.log('=== Batch Card Purchasing ===\n');
    console.log(`Wallet: ${walletName}`);
    console.log(`Total cards to purchase: ${purchaseRequests.length}`);
    console.log(`Total value: $${purchaseRequests.reduce((sum, r) => sum + parseFloat(r.amount), 0)}\n`);

    const results = {
      successful: [],
      failed: [],
      startTime: Date.now(),
    };

    for (let i = 0; i < purchaseRequests.length; i++) {
      const req = purchaseRequests[i];
      console.log(`[${i + 1}/${purchaseRequests.length}] Purchasing ${req.label} ($${req.amount})...`);

      try {
        const card = await purchaseWithRetry(apiKey, walletName, req.amount);
        results.successful.push({
          label: req.label,
          amount: req.amount,
          cardNumber: card.number,
          expiry: card.expiry,
          timestamp: new Date().toISOString(),
        });
        console.log(`        ✓ Success: ${card.number.slice(-4)}`);
      } catch (err) {
        results.failed.push({
          label: req.label,
          amount: req.amount,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
        console.log(`        ✗ Failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Polite delay between purchases to avoid rate limiting
      if (i < purchaseRequests.length - 1) {
        await sleep(2000);
      }
    }

    // Summary
    const duration = ((Date.now() - results.startTime) / 1000).toFixed(1);
    console.log('\n=== Purchase Summary ===');
    console.log(`Duration: ${duration}s`);
    console.log(`Successful: ${results.successful.length}/${purchaseRequests.length}`);
    console.log(`Failed: ${results.failed.length}/${purchaseRequests.length}`);

    if (results.successful.length > 0) {
      console.log('\nSuccessful Purchases:');
      results.successful.forEach((purchase) => {
        console.log(`  ${purchase.label}: ${purchase.cardNumber} (expires ${purchase.expiry})`);
      });
    }

    if (results.failed.length > 0) {
      console.log('\nFailed Purchases:');
      results.failed.forEach((failure) => {
        console.log(`  ${failure.label}: ${failure.error}`);
      });
      console.log('\nRetry failed purchases with: stellar_card purchase --resume <order-id>');
    }

    const successValue = results.successful.reduce(
      (sum, p) => sum + parseFloat(p.amount),
      0,
    ).toFixed(2);
    console.log(`\nTotal Value Purchased: $${successValue}`);
  } catch (err) {
    console.error('Batch processing error:');
    if (err instanceof Error) {
      console.error(`  ${err.message}`);
    } else {
      console.error(`  ${String(err)}`);
    }
    process.exit(1);
  }
}

main();
