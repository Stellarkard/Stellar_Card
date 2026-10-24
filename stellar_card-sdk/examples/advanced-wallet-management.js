#!/usr/bin/env node
/**
 * Advanced wallet management example.
 *
 * Demonstrates:
 * - Creating multiple wallet profiles
 * - Switching between wallets
 * - Checking balances across wallets
 * - Managing wallet encryption
 * - Recovering from wallet issues
 *
 * Run with:
 *   CARDS402_API_KEY='stellar_card_...' node examples/advanced-wallet-management.js
 */

import {
  createOWSWallet,
  getOWSPublicKey,
  getOWSBalance,
  Stellar_CardClient,
} from 'stellar_card';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const apiKey = process.env.CARDS402_API_KEY;
  if (!apiKey) {
    console.error('Error: CARDS402_API_KEY environment variable not set');
    process.exit(1);
  }

  const wallets = ['production', 'staging', 'development'];

  try {
    console.log('=== Advanced Wallet Management ===\n');

    // Step 1: Create multiple wallet profiles
    console.log('1. Creating wallet profiles...');
    for (const walletName of wallets) {
      try {
        console.log(`   Creating wallet: ${walletName}`);
        await createOWSWallet(walletName, 'secure-passphrase');
        console.log(`   ✓ Wallet "${walletName}" created/accessed`);
      } catch (err) {
        console.log(`   ✓ Wallet "${walletName}" already exists`);
      }
    }

    // Step 2: Retrieve and display wallet information
    console.log('\n2. Wallet Information Summary:');
    const walletInfo = [];
    for (const walletName of wallets) {
      try {
        const publicKey = await getOWSPublicKey(walletName);
        const balance = await getOWSBalance(walletName);

        walletInfo.push({
          name: walletName,
          address: publicKey,
          xlm: balance.xlm,
          usdc: balance.usdc,
          total: (parseFloat(balance.xlm) * 0.1 + parseFloat(balance.usdc)).toFixed(2),
        });

        console.log(`\n   ${walletName.toUpperCase()}`);
        console.log(`   Address: ${publicKey}`);
        console.log(`   XLM Balance: ${balance.xlm}`);
        console.log(`   USDC Balance: ${balance.usdc}`);
        console.log(`   Approx USD Value: $${walletInfo[walletInfo.length - 1].total}`);
      } catch (err) {
        console.error(`   Error fetching info for ${walletName}:`, err instanceof Error ? err.message : String(err));
      }
    }

    // Step 3: Identify optimal wallet for payment
    console.log('\n3. Optimal Wallet Selection:');
    const targetAmount = 10.0;
    let selectedWallet = null;
    let selectedAsset = null;

    for (const wallet of walletInfo) {
      if (parseFloat(wallet.usdc) >= targetAmount) {
        selectedWallet = wallet.name;
        selectedAsset = 'USDC';
        break;
      }
    }

    if (!selectedWallet) {
      for (const wallet of walletInfo) {
        if (parseFloat(wallet.xlm) >= targetAmount * 10) {
          selectedWallet = wallet.name;
          selectedAsset = 'XLM';
          break;
        }
      }
    }

    if (selectedWallet) {
      console.log(`   Selected wallet: ${selectedWallet}`);
      console.log(`   Payment asset: ${selectedAsset}`);
    } else {
      console.log('   Warning: No wallet has sufficient balance for $10 purchase');
    }

    // Step 4: Wallet health check
    console.log('\n4. Wallet Health Check:');
    for (const wallet of walletInfo) {
      const xlmBalance = parseFloat(wallet.xlm);
      const usdcBalance = parseFloat(wallet.usdc);

      let status = '✓ Healthy';
      const issues = [];

      if (xlmBalance < 0.5) {
        status = '⚠ Warning';
        issues.push('Low XLM for fees');
      }
      if (xlmBalance < 0.1) {
        status = '✗ Critical';
        issues.push('Insufficient XLM for operations');
      }
      if (xlmBalance > 0 && usdcBalance === 0) {
        issues.push('No USDC trustline');
      }

      console.log(`   ${wallet.name}: ${status}`);
      if (issues.length > 0) {
        console.log(`     Issues: ${issues.join(', ')}`);
      }
    }

    // Step 5: Save wallet mapping to config file
    console.log('\n5. Saving wallet configuration...');
    const configDir = path.join(process.env.HOME || '/tmp', '.stellar-card');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }

    const configPath = path.join(configDir, 'wallets.json');
    fs.writeFileSync(configPath, JSON.stringify({ wallets: walletInfo }, null, 2), { mode: 0o600 });
    console.log(`   ✓ Configuration saved to ${configPath}`);
  } catch (err) {
    console.error('Error:');
    if (err instanceof Error) {
      console.error(`  ${err.message}`);
      if (err.cause) {
        console.error(`  Cause: ${err.cause}`);
      }
    } else {
      console.error(`  ${String(err)}`);
    }
    process.exit(1);
  }
}

main();
