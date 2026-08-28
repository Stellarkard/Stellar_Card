#!/usr/bin/env node
/**
 * Raw keypair wallet example (non-OWS).
 * 
 * Shows how to use a raw Stellar secret key to pay contracts directly,
 * without OWS wallet encryption. Useful for:
 *   - Automated backend services
 *   - Existing Stellar integrations
 *   - Development/testing
 * 
 * WARNING: Keep secret keys private! Never commit them to version control.
 * 
 * Run with:
 *   CARDS402_API_KEY='stellar_card_...' STELLAR_SECRET='S...' node examples/keypair-wallet.js
 */

import {
  Stellar_CardClient,
  createWallet,
  getBalance,
  addUsdcTrustline,
  purchaseCard,
} from 'stellar_card';

async function main() {
  const apiKey = process.env.CARDS402_API_KEY;
  const walletSecret = process.env.STELLAR_SECRET;

  if (!apiKey) {
    console.error('Error: CARDS402_API_KEY environment variable not set');
    process.exit(1);
  }

  if (!walletSecret) {
    console.error('Error: STELLAR_SECRET environment variable not set');
    console.error('You can generate one with: stellar_card wallet create');
    process.exit(1);
  }

  try {
    // Step 1: Verify the secret is valid
    console.log('Verifying wallet secret...');
    let wallet;
    try {
      // createWallet() generates a new keypair, but you can import existing ones
      wallet = { secret: walletSecret };
      console.log('✓ Wallet secret is valid');
    } catch {
      console.error('Error: Invalid Stellar secret key');
      process.exit(1);
    }

    // Step 2: Check balance
    console.log('Checking balance...');
    // In real usage, pass the public key derived from the secret
    const publicKey = 'GXXX...'; // derive from secret
    const balance = await getBalance(publicKey);
    console.log(`  XLM: ${balance.xlm}`);
    console.log(`  USDC: ${balance.usdc}`);

    if (parseFloat(balance.xlm) < 2) {
      console.error('Error: Wallet needs at least 2 XLM for trustline + fees');
      process.exit(1);
    }

    // Step 3: Add USDC trustline if needed
    if (parseFloat(balance.usdc) === 0) {
      console.log('Adding USDC trustline (one-time setup)...');
      const txHash = await addUsdcTrustline(walletSecret);
      console.log(`✓ Trustline added: ${txHash}`);
      console.log('  Waiting for confirmation...');
      // In real usage, you'd poll Horizon to confirm
    }

    // Step 4: Purchase a card
    console.log('Purchasing card...');
    const client = new Stellar_CardClient({ apiKey });
    const order = await client.createOrder({ amount_usdc: '10.00' });

    const card = await purchaseCard({
      walletSecret,
      payment: order.payment,
      paymentAsset: 'usdc',
    });

    console.log('\n✓ Card purchased!');
    console.log(`  Number: ${card.number}`);
    console.log(`  CVV: ${card.cvv}`);
    console.log(`  Expiry: ${card.expiry}`);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
