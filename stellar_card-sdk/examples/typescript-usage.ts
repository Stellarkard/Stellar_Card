#!/usr/bin/env node
/**
 * TypeScript SDK usage example.
 *
 * Demonstrates proper TypeScript types and patterns for using the SDK
 * in a production agent or bot.
 *
 * Run with:
 *   npx ts-node examples/typescript-usage.ts
 * or compile and run:
 *   tsc examples/typescript-usage.ts
 *   node examples/typescript-usage.js
 */

import {
  Stellar_CardClient,
  purchaseCardOWS,
  getOWSBalance,
  getOWSPublicKey,
  type CardDetails,
  type OrderResponse,
  Stellar_CardError,
  SpendLimitError,
  RateLimitError,
  WaitTimeoutError,
} from 'stellar_card';

// ── Typed configuration ────────────────────────────────────────────────────

interface AgentConfig {
  apiKey: string;
  walletName: string;
  maxAmount: string;
  vaultPath?: string;
  sorobanRpcUrl?: string;
}

// ── Type-safe error handler ────────────────────────────────────────────────

function handlePurchaseError(error: unknown): void {
  if (error instanceof SpendLimitError) {
    console.error(
      `Spend limit reached: $${error.spent} of $${error.limit} spent`,
    );
  } else if (error instanceof RateLimitError) {
    console.error('Rate limited. Backing off...');
  } else if (error instanceof WaitTimeoutError) {
    console.error(`Order ${error.orderId} is taking longer than expected`);
  } else if (error instanceof Stellar_CardError) {
    console.error(`API error (${error.code}): ${error.message}`);
  } else if (error instanceof Error) {
    console.error(`Unexpected error: ${error.message}`);
  } else {
    console.error('Unknown error:', error);
  }
}

// ── Retry logic with typed parameters ──────────────────────────────────────

interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (
        attempt === maxAttempts ||
        !(error instanceof RateLimitError)
      ) {
        throw error;
      }

      const delayMs = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs,
      );
      console.warn(`Attempt ${attempt} failed. Retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error('Max retries exceeded');
}

// ── Wallet manager with type safety ────────────────────────────────────────

class WalletManager {
  constructor(private config: AgentConfig) {}

  async getAddress(): Promise<string> {
    return getOWSPublicKey(
      this.config.walletName,
      this.config.vaultPath,
    );
  }

  async getBalance(): Promise<{ xlm: string; usdc: string }> {
    const balance = await getOWSBalance(
      this.config.walletName,
      this.config.vaultPath,
    );
    return balance;
  }

  async ensureFunded(): Promise<void> {
    const balance = await this.getBalance();
    const xlm = parseFloat(balance.xlm);
    const usdc = parseFloat(balance.usdc);

    if (xlm < 2) {
      const address = await this.getAddress();
      throw new Error(
        `Wallet not funded. Send at least 2 XLM to: ${address}`,
      );
    }

    if (usdc === 0 && xlm < 3) {
      console.warn(
        'Warning: Low balance for USDC purchase. Consider funding with more XLM.',
      );
    }
  }
}

// ── Card purchase manager ──────────────────────────────────────────────────

class CardPurchaseManager {
  private client: Stellar_CardClient;
  private wallet: WalletManager;

  constructor(private config: AgentConfig) {
    this.client = new Stellar_CardClient({ apiKey: config.apiKey });
    this.wallet = new WalletManager(config);
  }

  async purchaseCard(
    amount: string,
    paymentAsset: 'usdc' | 'xlm' = 'usdc',
  ): Promise<CardDetails> {
    // Validate amount
    const amountNum = parseFloat(amount);
    const maxNum = parseFloat(this.config.maxAmount);

    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error('Invalid amount');
    }
    if (amountNum > maxNum) {
      throw new Error(`Amount exceeds max: $${maxNum}`);
    }

    // Check wallet is funded
    await this.wallet.ensureFunded();

    // Purchase with retry logic
    const card = await retryWithBackoff(
      () =>
        purchaseCardOWS({
          apiKey: this.config.apiKey,
          walletName: this.config.walletName,
          amountUsdc: amount,
          paymentAsset,
        }),
      { maxAttempts: 3 },
    );

    return card;
  }

  async getOrderStatus(orderId: string): Promise<any> {
    return this.client.getOrder(orderId);
  }

  async listOrders(): Promise<any> {
    return this.client.listOrders();
  }
}

// ── Main usage example ─────────────────────────────────────────────────────

async function main(): Promise<number> {
  const apiKey = process.env.CARDS402_API_KEY;
  if (!apiKey) {
    console.error('Error: CARDS402_API_KEY not set');
    return 1;
  }

  const config: AgentConfig = {
    apiKey,
    walletName: 'my-typescript-agent',
    maxAmount: '100.00',
    vaultPath: process.env.OWS_VAULT_PATH,
  };

  try {
    const manager = new CardPurchaseManager(config);

    // Get wallet info
    console.log('Checking wallet...');
    const address = await manager.wallet.getAddress();
    console.log(`Address: ${address}`);

    const balance = await manager.wallet.getBalance();
    console.log(`Balance: ${balance.xlm} XLM, ${balance.usdc} USDC`);

    // Purchase a card
    console.log('\nPurchasing card...');
    const card = await manager.purchaseCard('10.00', 'usdc');

    console.log('✓ Card purchased!');
    console.log(`  Number: ${card.number}`);
    console.log(`  CVV: ${card.cvv}`);
    console.log(`  Expiry: ${card.expiry}`);

    return 0;
  } catch (error) {
    console.error('\nError occurred:');
    handlePurchaseError(error);
    return 1;
  }
}

// Run the example
main().then((code) => {
  if (code !== 0) process.exit(code);
});
