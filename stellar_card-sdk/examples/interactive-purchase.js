#!/usr/bin/env node
/**
 * Interactive basic purchase example (Issue #529 — Part 5; also closes #489,
 * a duplicate "Part 1" issue filed for the same feature).
 *
 * Wraps the stellar_card SDK purchase flow with a readline-based interactive
 * prompt so users can walk through each step of buying a card without needing
 * to know the SDK API or construct option objects manually.
 *
 * Flow:
 *   1. Prompt for API key (falls back to CARDS402_API_KEY env var)
 *   2. Prompt for wallet name (falls back to default "my-agent")
 *   3. Prompt for purchase amount in USDC
 *   4. Optionally check wallet balance before purchase
 *   5. Execute the purchase via purchaseCardOWS()
 *   6. Display the card details (or a ResumableError resume command)
 *
 * Run with:
 *   node examples/interactive-purchase.js
 *
 * Requires Node 18+ (readline/promises).
 */

import * as readline from 'node:readline/promises';
import { stdin as rlInput, stdout as rlOutput } from 'node:process';

import {
  purchaseCardOWS,
  getOWSBalance,
  createOWSWallet,
} from 'stellar_card';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Prompt the user for a value with a default fallback.
 */
async function ask(rl, question, defaultValue = '') {
  const hint = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await rl.question(`${question}${hint}: `);
  return answer.trim() || defaultValue;
}

/**
 * Print a section divider for visual clarity.
 */
function divider() {
  rlOutput.write('─'.repeat(56) + '\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const rl = readline.createInterface({ input: rlInput, output: rlOutput });

  try {
    divider();
    rlOutput.write(' stellar_card — Interactive Purchase\n');
    divider();
    rlOutput.write('\n');

    // Step 1: API key
    const apiKey = await ask(
      rl,
      'Enter your stellar_card API key',
      process.env.CARDS402_API_KEY || '',
    );
    if (!apiKey) {
      rlOutput.write('\nError: API key is required.\n');
      rlOutput.write('Get one from https://stellar_card.com/dashboard\n');
      rlOutput.write('or set CARDS402_API_KEY environment variable.\n');
      return 1;
    }

    // Step 2: Wallet name
    const walletName = await ask(rl, 'Enter wallet name', 'my-agent');

    // Step 3: Purchase amount
    const amountInput = await ask(rl, 'Enter card amount in USDC', '10.00');
    const amount = amountInput;

    // Validate amount locally
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      rlOutput.write('\nError: Amount must be a decimal string with up to 2 decimal places.\n');
      return 1;
    }
    const amtNum = parseFloat(amount);
    if (amtNum < 0.01 || amtNum > 10000) {
      rlOutput.write('\nError: Amount must be between $0.01 and $10,000.\n');
      return 1;
    }

    // Step 4: Check balance
    rlOutput.write('\nChecking wallet balance...\n');
    try {
      const balance = await getOWSBalance(walletName);
      rlOutput.write(`  XLM:  ${balance.xlm}\n`);
      rlOutput.write(`  USDC: ${balance.usdc}\n`);

      if (parseFloat(balance.xlm) < 2 && parseFloat(balance.usdc) < amtNum) {
        rlOutput.write('\nWarning: Wallet may have insufficient funds for this purchase.\n');
        rlOutput.write('Fund your wallet with at least 2 XLM (for account + trustline) and the purchase amount.\n');
        const proceed = await ask(rl, 'Continue anyway? (y/N)', 'N');
        if (proceed.toLowerCase() !== 'y') {
          rlOutput.write('Aborted.\n');
          return 0;
        }
      }
    } catch {
      rlOutput.write('  Could not read balance from Horizon (wallet may not be activated yet).\n');
    }

    // Step 5: Payment asset selection
    const assetChoice = await ask(rl, 'Payment asset (usdc/xlm)', 'usdc');
    const paymentAsset = assetChoice === 'xlm' ? 'xlm' : 'usdc';

    // Step 6: Confirm and purchase
    rlOutput.write('\n');
    divider();
    rlOutput.write(` Purchase: $${amount} card via ${paymentAsset.toUpperCase()}\n`);
    rlOutput.write(` Wallet:   ${walletName}\n`);
    divider();
    rlOutput.write('\n');

    const confirm = await ask(rl, 'Proceed? (Y/n)', 'Y');
    if (confirm.toLowerCase() === 'n') {
      rlOutput.write('Aborted.\n');
      return 0;
    }

    rlOutput.write('\nCreating order and submitting payment...\n');

    const card = await purchaseCardOWS({
      apiKey,
      walletName,
      amountUsdc: amount,
      paymentAsset,
    });

    // Step 7: Display card details
    rlOutput.write('\n');
    divider();
    rlOutput.write(' Card purchased successfully!\n');
    divider();
    rlOutput.write(`  Number: ${card.number}\n`);
    rlOutput.write(`  CVV:    ${card.cvv}\n`);
    rlOutput.write(`  Expiry: ${card.expiry}\n`);
    if (card.brand) rlOutput.write(`  Brand:  ${card.brand}\n`);
    rlOutput.write(`  Order:  ${card.order_id}\n`);
    divider();
    rlOutput.write('\n');
    rlOutput.write('Save these details to a secrets manager immediately.\n');
    rlOutput.write('Do not log or share card numbers in plaintext.\n');
    rlOutput.write('Billing address is typically any valid US address.\n');

    return 0;
  } catch (err) {
    rlOutput.write('\n');

    // ResumableError — offer resume command
    if (err && typeof err === 'object' && 'orderId' in err && 'phase' in err) {
      rlOutput.write(`Purchase interrupted: ${err.message}\n`);
      rlOutput.write(`\nYour payment may still be processing. Resume with:\n`);
      rlOutput.write(`  stellar_card purchase --resume ${err.orderId}\n`);
      return 1;
    }

    // OrderFailedError
    if (err && typeof err === 'object' && err.name === 'OrderFailedError') {
      rlOutput.write(`Order failed: ${err.message}\n`);
      return 1;
    }

    // Generic error
    const msg = err instanceof Error ? err.message : String(err);
    rlOutput.write(`Error: ${msg}\n`);
    return 1;
  } finally {
    rl.close();
  }
}

main().then((code) => {
  if (code !== 0) process.exit(code);
});
