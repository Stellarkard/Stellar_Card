#!/usr/bin/env node
/**
 * Basic card purchase example.
 * 
 * This is the quickest path to buy a card:
 * 1. Create/access an OWS wallet
 * 2. Check that it's funded
 * 3. Call purchaseCardOWS() which handles the entire flow
 * 
 * Run with:
 *   CARDS402_API_KEY='stellar_card_...' node examples/basic-purchase.js
 */

import { purchaseCardOWS, getOWSBalance } from 'stellar_card';

async function main() {
  const apiKey = process.env.CARDS402_API_KEY;
  if (!apiKey) {
    console.error('Error: CARDS402_API_KEY environment variable not set');
    process.exit(1);
  }

  const walletName = 'my-agent';

  try {
    // Step 1: Create (or fetch existing) OWS wallet
    console.log(`Creating wallet "${walletName}"...`);
    // The SDK's CLI does this via createOWSWallet() during onboarding

    // Step 2: Check balance
    console.log('Checking wallet balance...');
    const balance = await getOWSBalance(walletName);
    console.log(`  XLM: ${balance.xlm}`);
    console.log(`  USDC: ${balance.usdc}`);

    // Ensure wallet has funds
    if (parseFloat(balance.xlm) < 2 && parseFloat(balance.usdc) < 10) {
      console.error(
        'Error: Wallet has insufficient balance. Fund it with at least 2 XLM or 10 USDC.',
      );
      console.error(`Fund this address: (check ~/.stellar_card/config.json for wallet address)`);
      process.exit(1);
    }

    // Step 3: Purchase a card
    console.log('Purchasing card...');
    const card = await purchaseCardOWS({
      apiKey,
      walletName,
      amountUsdc: '10.00',
      // paymentAsset: 'xlm', // optional, default is 'usdc'
    });

    console.log('\n✓ Card purchased!');
    console.log(`  Number: ${card.number}`);
    console.log(`  CVV: ${card.cvv}`);
    console.log(`  Expiry: ${card.expiry}`);
    console.log(`  Brand: ${card.brand}`);
  } catch (err) {
    console.error('Failed to purchase card:');
    if (err instanceof Error) {
      console.error(`  ${err.message}`);
    } else {
      console.error(`  ${String(err)}`);
    }
    process.exit(1);
  }
}

main();
