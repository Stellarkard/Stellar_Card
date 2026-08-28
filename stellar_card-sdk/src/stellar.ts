// Helpers for agents using a raw Stellar keypair (S...) to pay the stellar_card
// receiver contract on Soroban. For OWS-wallet custody, see ./ows.ts.

import {
  Keypair,
  Networks,
  Horizon,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  StrKey,
} from '@stellar/stellar-sdk';
import type { CardDetails, PaymentInstructions } from './client';
import {
  buildContractPaymentTx,
  submitSorobanTx,
  decimalToStroops,
  selectContractCall,
  InsufficientFeeError,
} from './soroban';

const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const HORIZON_TIMEOUT_MS = 15000;

function getHorizonUrl(networkPassphrase?: string): string {
  return networkPassphrase === Networks.TESTNET
    ? 'https://horizon-testnet.stellar.org'
    : 'https://horizon.stellar.org';
}

function getServer(networkPassphrase?: string): Horizon.Server {
  return new Horizon.Server(getHorizonUrl(networkPassphrase));
}

function withTimeout<T>(promise: Promise<T>, ms = HORIZON_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Horizon request timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export interface WalletInfo {
  publicKey: string;
  secret: string; // Keep safe — never share
}

/**
 * Create a new random Stellar wallet keypair.
 *
 * @returns An object containing the public key (G-address) and secret key (S-address)
 * @warning The secret key should be kept secure and never shared or logged
 *
 * @example
 * ```typescript
 * const wallet = createWallet();
 * console.log('Public key:', wallet.publicKey); // G...
 * // Store wallet.secret securely - never log or transmit it
 * ```
 */
export function createWallet(): WalletInfo {
  const keypair = Keypair.random();
  return { publicKey: keypair.publicKey(), secret: keypair.secret() };
}

/**
 * Get XLM and USDC balances for a Stellar account.
 *
 * @param publicKey - The Stellar public key (G-address) to query
 * @param networkPassphrase - Optional network passphrase (defaults to mainnet)
 * @returns Promise resolving to balance object with xlm and usdc as decimal strings
 * @throws {Error} When the account is not found or Horizon request fails
 *
 * @example
 * ```typescript
 * const balance = await getBalance('GXXXXXXX...', Networks.TESTNET);
 * console.log(`Available: ${balance.xlm} XLM, ${balance.usdc} USDC`);
 * ```
 */
/**
 * Get XLM and USDC balances for a Stellar account.
 *
 * @param publicKey - The Stellar public key (G-address) to query
 * @param networkPassphrase - Optional network passphrase (defaults to mainnet)
 * @returns Promise resolving to balance object with xlm and usdc as decimal strings
 * @throws {Error} When the account is not found or Horizon request fails
 *
 * @example
 * ```typescript
 * const balance = await getBalance('GXXXXXXX...', Networks.TESTNET);
 * console.log(`Available: ${balance.xlm} XLM, ${balance.usdc} USDC`);
 * ```
 */
export async function getBalance(
  publicKey: string,
  networkPassphrase?: string,
): Promise<{ xlm: string; usdc: string }> {
  const server = getServer(networkPassphrase);
  const account = await withTimeout(server.loadAccount(publicKey));
  let xlm = '0',
    usdc = '0';
  for (const b of account.balances) {
    if (b.asset_type === 'native') xlm = b.balance;
    if (
      b.asset_type === 'credit_alphanum4' &&
      b.asset_code === 'USDC' &&
      b.asset_issuer === USDC_ISSUER
    )
      usdc = b.balance;
  }
  return { xlm, usdc };
}

/**
 * Add a USDC trustline to a Stellar account.
 *
 * This allows the account to hold USDC tokens from the recognized issuer.
 * The operation costs ~0.00001 XLM in network fees.
 *
 * @param secret - The Stellar secret key (S-address) for the account
 * @param networkPassphrase - The Stellar network to operate on (defaults to mainnet)
 * @returns Promise resolving to the transaction hash
 * @throws {Error} When the account is not found, has insufficient XLM, or the transaction fails
 *
 * @example
 * ```typescript
 * const txHash = await addUsdcTrustline('SXXXXXXX...', Networks.TESTNET);
 * console.log('Trustline added in transaction:', txHash);
 * ```
 */
export async function addUsdcTrustline(
  secret: string,
  networkPassphrase = Networks.PUBLIC,
): Promise<string> {
  const server = getServer(networkPassphrase);
  const keypair = Keypair.fromSecret(secret);
  const account = await withTimeout(server.loadAccount(keypair.publicKey()));
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(Operation.changeTrust({ asset: new Asset('USDC', USDC_ISSUER) }))
    .setTimeout(300)
    .build();
  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

// ── Contract payment ──────────────────────────────────────────────────────────

/**
 * Options for {@link payViaContract}.
 */
export interface PayOpts {
  /** Stellar secret key (S-address) for the signing account. */
  walletSecret: string;
  /** Payment instructions returned by {@link Stellar_CardClient.createOrder}. */
  payment: PaymentInstructions;
  /** Asset to pay with. Defaults to `'usdc'`. */
  paymentAsset?: 'usdc' | 'xlm';
  /** Stellar network passphrase. Defaults to `Networks.PUBLIC` (mainnet). */
  networkPassphrase?: string;
  /** Custom Soroban RPC URL. Defaults to the public endpoint for the selected network. */
  sorobanRpcUrl?: string;
  /** Override the Horizon REST API URL. Defaults to the public endpoint for the selected network. */
  horizonUrl?: string;
}

/**
 * Pay the stellar_card receiver contract using a raw Stellar secret key.
 *
 * Invokes `pay_usdc` or `pay_xlm` on the Soroban receiver contract with the
 * agent's G-address, the quoted amount converted to 7-decimal stroops, and
 * the `order_id` from the create-order response. Includes a single automatic
 * fee-bump retry when the network rejects the initial fee.
 *
 * @param opts - Payment options including the wallet secret, payment instructions,
 *   and optional network / RPC overrides.
 * @returns Promise resolving to the Stellar transaction hash.
 * @throws {Error} When `payment.contract_id` is not a valid Soroban contract address.
 * @throws {InsufficientFeeError} When the fee is still insufficient after the retry.
 * @throws {Error} When the Soroban transaction fails on-chain or times out.
 *
 * @example
 * ```typescript
 * const txHash = await payViaContract({
 *   walletSecret: process.env.STELLAR_SECRET!,
 *   payment: order.payment,
 *   paymentAsset: 'usdc',
 * });
 * ```
 */
export async function payViaContract(opts: PayOpts): Promise<string> {
  const {
    walletSecret,
    payment,
    paymentAsset = 'usdc',
    networkPassphrase = Networks.PUBLIC,
    sorobanRpcUrl,
    horizonUrl,
  } = opts;

  if (!StrKey.isValidContract(payment.contract_id)) {
    throw new Error(`Invalid contract_id in order response: ${payment.contract_id}`);
  }

  const keypair = Keypair.fromSecret(walletSecret);
  const { fn, amountDecimal } = selectContractCall(payment, paymentAsset);
  const amountStroops = decimalToStroops(amountDecimal);
  const resolvedHorizonUrl = horizonUrl ?? getHorizonUrl(networkPassphrase);

  // Fee retry: if the network rejects the fee, rebuild with the
  // required fee as the floor. At most one retry — the network's
  // suggested fee should be sufficient on the second attempt.
  let fee: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { tx, server } = await buildContractPaymentTx({
      contractId: payment.contract_id,
      fn,
      fromPublicKey: keypair.publicKey(),
      amountStroops,
      orderId: payment.order_id,
      networkPassphrase,
      rpcUrl: sorobanRpcUrl,
      fee,
    });
    tx.sign(keypair);
    try {
      return await submitSorobanTx(tx, server, resolvedHorizonUrl);
    } catch (err) {
      if (err instanceof InsufficientFeeError && attempt === 0) {
        fee = err.requiredFee;
        continue;
      }
      throw err;
    }
  }
  throw new Error('payViaContract: fee retry exhausted');
}

/**
 * Full purchase flow with a raw Stellar keypair.
 *
 * Orchestrates the complete card acquisition sequence:
 * 1. Creates a new order via the stellar_card API (or resumes an existing one).
 * 2. Pays the Soroban receiver contract using the supplied secret key.
 * 3. Waits for the card to be ready and returns its details.
 *
 * Pass `resume: { orderId, payment }` to re-enter a partially completed flow
 * without creating a new order, avoiding duplicate charges when a previous
 * attempt timed out or lost connectivity after payment was submitted.
 *
 * @param opts.apiKey - stellar_card API key.
 * @param opts.walletSecret - Stellar secret key (S-address) used to sign the payment transaction.
 * @param opts.amountUsdc - Card amount as a decimal string, e.g. `"10.00"`.
 * @param opts.paymentAsset - Asset to pay with (`'usdc'` or `'xlm'`). Defaults to `'usdc'`.
 * @param opts.baseUrl - Override the API base URL.
 * @param opts.networkPassphrase - Stellar network passphrase. Defaults to mainnet.
 * @param opts.sorobanRpcUrl - Custom Soroban RPC endpoint.
 * @param opts.horizonUrl - Custom Horizon REST API endpoint.
 * @param opts.resume - Resume an existing order instead of creating a new one.
 * @param opts.waitForCardOpts - Timeout and polling interval for the card-ready wait.
 * @returns Promise resolving to card details plus the `order_id`.
 * @throws {InvalidAmountError} When `amountUsdc` is outside `[0.01, 10000]`.
 * @throws {SpendLimitError} When the API key's spend limit is exhausted.
 * @throws {OrderFailedError} When the order fails during fulfillment.
 * @throws {WaitTimeoutError} When card delivery times out.
 */
export async function purchaseCard(opts: {
  apiKey: string;
  walletSecret: string;
  amountUsdc: string;
  paymentAsset?: 'usdc' | 'xlm';
  baseUrl?: string;
  networkPassphrase?: string;
  sorobanRpcUrl?: string;
  /** Override the Horizon REST API URL used during contract submission. */
  horizonUrl?: string;
  resume?: { orderId: string; payment: PaymentInstructions };
  waitForCardOpts?: { timeoutMs?: number; intervalMs?: number };
}): Promise<CardDetails & { order_id: string }> {
  const { Stellar_CardClient } = await import('./client');
  const client = new Stellar_CardClient({ apiKey: opts.apiKey, baseUrl: opts.baseUrl });
  const paymentAsset = opts.paymentAsset ?? 'usdc';

  let orderId: string;
  let payment: PaymentInstructions;

  if (opts.resume) {
    orderId = opts.resume.orderId;
    payment = opts.resume.payment;
    const status = await client.getOrder(orderId);
    if (status.phase !== 'awaiting_payment') {
      const card = await client.waitForCard(orderId, opts.waitForCardOpts);
      return { ...card, order_id: orderId };
    }
  } else {
    const order = await client.createOrder({ amount_usdc: opts.amountUsdc });
    orderId = order.order_id;
    payment = order.payment;
  }

  await payViaContract({
    walletSecret: opts.walletSecret,
    payment,
    paymentAsset,
    networkPassphrase: opts.networkPassphrase,
    sorobanRpcUrl: opts.sorobanRpcUrl,
    horizonUrl: opts.horizonUrl,
  });

  const card = await client.waitForCard(orderId, opts.waitForCardOpts);
  return { ...card, order_id: orderId };
}

// Back-compat aliases — the pre-V3 SDK exposed these names. Keep them around
// as deprecated exports so existing imports don't break on upgrade.

/** @deprecated Use `payViaContract` — this is the Soroban contract call, not a direct Stellar payment. */
export const payVCC = payViaContract;
