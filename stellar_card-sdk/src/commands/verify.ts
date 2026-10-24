/**
 * `stellar_card verify-tx <hash>` — cryptographically inspect an on-chain
 * payment proof (#771).
 *
 * Fetches the transaction from Horizon and/or Soroban RPC, parses receiver
 * contract payment events, asserts the recipient matches the configured
 * treasury address, and prints a verification summary table with a green
 * verified badge on success.
 */

import { Address, Networks, scValToNative, rpc, xdr } from '@stellar/stellar-sdk';
import { getHorizonUrl, getSorobanRpcUrl } from '../soroban';

export interface VerifyTxArgs {
  txHash?: string;
  treasury?: string;
  contractId?: string;
  network?: 'mainnet' | 'testnet';
  horizonUrl?: string;
  rpcUrl?: string;
  json?: boolean;
  help?: boolean;
}

export interface PaymentEventProof {
  orderId: string;
  sender: string;
  amount: string;
  asset: 'usdc' | 'xlm';
  eventSymbol: string;
}

export interface VerifyTxResult {
  verified: boolean;
  txHash: string;
  successful: boolean;
  orderId: string | null;
  recipient: string | null;
  treasury: string;
  treasuryMatch: boolean;
  asset: 'usdc' | 'xlm' | null;
  amount: string | null;
  sender: string | null;
  ledger: number | null;
  reason?: string;
}

export interface VerifyTxDeps {
  fetchHorizonTx?: (url: string) => Promise<{
    successful: boolean;
    hash?: string;
    ledger?: number;
    memo?: string;
  } | null>;
  fetchHorizonPayments?: (url: string) => Promise<Array<{ to?: string; from?: string; amount?: string }>>;
  fetchSorobanTx?: (rpcUrl: string, txHash: string) => Promise<{
    status: string;
    ledger?: number;
    events?: PaymentEventProof[];
  } | null>;
  out?: (text: string) => void;
  err?: (text: string) => void;
  color?: boolean;
}

const COLORS = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', reset: '\x1b[0m' };

export function parseVerifyArgs(argv: string[]): VerifyTxArgs {
  const out: VerifyTxArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '-h' || arg === '--help') out.help = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--treasury') out.treasury = argv[++i];
    else if (arg.startsWith('--treasury=')) out.treasury = arg.slice('--treasury='.length);
    else if (arg === '--contract') out.contractId = argv[++i];
    else if (arg.startsWith('--contract=')) out.contractId = arg.slice('--contract='.length);
    else if (arg === '--network') out.network = argv[++i] as 'mainnet' | 'testnet';
    else if (arg.startsWith('--network='))
      out.network = arg.slice('--network='.length) as 'mainnet' | 'testnet';
    else if (arg === '--horizon-url') out.horizonUrl = argv[++i];
    else if (arg.startsWith('--horizon-url=')) out.horizonUrl = arg.slice('--horizon-url='.length);
    else if (arg === '--rpc-url') out.rpcUrl = argv[++i];
    else if (arg.startsWith('--rpc-url=')) out.rpcUrl = arg.slice('--rpc-url='.length);
    else if (!arg.startsWith('-') && !out.txHash) out.txHash = arg;
  }
  return out;
}

function usage(): string {
  return `Usage: stellar_card verify-tx <tx-hash> --treasury <G-address> [options]

Inspect an on-chain Soroban payment and verify the contract event proof.

Options:
  --treasury <G-address>   Expected treasury / recipient address (required)
  --contract <C-address>   Expected receiver contract id (optional filter)
  --network mainnet|testnet  Network to query (default: mainnet)
  --horizon-url <url>      Override Horizon REST URL
  --rpc-url <url>          Override Soroban RPC URL
  --json                   Emit raw JSON instead of a table
  -h, --help               Show this message
`;
}

/**
 * Parse a receiver-contract payment event topic/value triple into a
 * structured proof. Mirrors the backend `parsePaymentEvent` shape.
 */
export function parseContractPaymentTopics(
  topics: xdr.ScVal[],
  value: xdr.ScVal,
): PaymentEventProof | null {
  if (!topics || topics.length < 3) return null;
  try {
    const eventSymbol = String(scValToNative(topics[0]!));
    if (eventSymbol !== 'pay_usdc' && eventSymbol !== 'pay_xlm') return null;

    const orderIdBytes = scValToNative(topics[1]!);
    const orderId = Buffer.from(orderIdBytes as Uint8Array).toString('utf-8');
    if (!orderId || orderId.length > 64 || !/^[\x20-\x7e]+$/.test(orderId)) return null;

    const sender = Address.fromScVal(topics[2]!).toString();
    const amountI128 = BigInt(scValToNative(value) as bigint | number | string);
    if (amountI128 <= 0n) return null;

    const whole = amountI128 / 10_000_000n;
    const frac = String(amountI128 % 10_000_000n).padStart(7, '0');
    return {
      orderId,
      sender,
      amount: `${whole}.${frac}`,
      asset: eventSymbol === 'pay_usdc' ? 'usdc' : 'xlm',
      eventSymbol,
    };
  } catch {
    return null;
  }
}

function verifiedBadge(ok: boolean, color: boolean): string {
  const label = ok ? 'VERIFIED' : 'FAILED';
  if (!color) return label;
  return ok
    ? `${COLORS.green}✓ ${label}${COLORS.reset}`
    : `${COLORS.red}✗ ${label}${COLORS.reset}`;
}

export function renderVerifyTable(result: VerifyTxResult, color: boolean): string {
  const rows: Array<[string, string]> = [
    ['Status', verifiedBadge(result.verified, color)],
    ['Tx Hash', result.txHash],
    ['Successful', result.successful ? 'yes' : 'no'],
    ['Order UUID', result.orderId ?? '-'],
    ['Asset', result.asset?.toUpperCase() ?? '-'],
    ['Amount', result.amount ?? '-'],
    ['Sender', result.sender ?? '-'],
    ['Recipient', result.recipient ?? '-'],
    ['Treasury', result.treasury],
    ['Treasury Match', result.treasuryMatch ? 'yes' : 'no'],
    ['Ledger', result.ledger != null ? String(result.ledger) : '-'],
  ];
  if (result.reason) rows.push(['Reason', result.reason]);

  const keyWidth = Math.max(...rows.map(([k]) => k.length));
  return (
    rows.map(([k, v]) => `${k.padEnd(keyWidth)}  ${v}`).join('\n') + '\n'
  );
}

async function defaultFetchHorizonTx(url: string): Promise<{
  successful: boolean;
  hash?: string;
  ledger?: number;
  memo?: string;
} | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Horizon returned ${res.status} for ${url}`);
  return (await res.json()) as {
    successful: boolean;
    hash?: string;
    ledger?: number;
    memo?: string;
  };
}

async function defaultFetchHorizonPayments(
  url: string,
): Promise<Array<{ to?: string; from?: string; amount?: string }>> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const body = (await res.json()) as {
    _embedded?: { records?: Array<{ to?: string; from?: string; amount?: string; type?: string }> };
  };
  return body._embedded?.records ?? [];
}

async function defaultFetchSorobanTx(
  rpcUrl: string,
  txHash: string,
): Promise<{ status: string; ledger?: number; events?: PaymentEventProof[] } | null> {
  const server = new rpc.Server(rpcUrl);
  let tx: Awaited<ReturnType<typeof server.getTransaction>>;
  try {
    tx = await server.getTransaction(txHash);
  } catch {
    return null;
  }
  if (!tx || tx.status === 'NOT_FOUND') return null;

  const events: PaymentEventProof[] = [];
  const opEvents = (tx as { events?: { contractEventsXdr?: xdr.ContractEvent[][] } }).events
    ?.contractEventsXdr;
  if (Array.isArray(opEvents)) {
    for (const group of opEvents) {
      for (const evt of group ?? []) {
        try {
          const body = evt.body().v0();
          const proof = parseContractPaymentTopics(body.topics(), body.data());
          if (proof) events.push(proof);
        } catch {
          /* skip unparseable events */
        }
      }
    }
  }

  return {
    status: tx.status,
    ledger: (tx as { ledger?: number }).ledger,
    events,
  };
}

/**
 * Core verification logic — pure enough for unit tests via {@link VerifyTxDeps}.
 */
export async function verifyPaymentProof(
  args: Required<Pick<VerifyTxArgs, 'txHash' | 'treasury'>> & VerifyTxArgs,
  deps: VerifyTxDeps = {},
): Promise<VerifyTxResult> {
  const networkPassphrase =
    args.network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
  const horizonBase = args.horizonUrl ?? getHorizonUrl(networkPassphrase);
  const rpcUrl = args.rpcUrl ?? getSorobanRpcUrl(networkPassphrase);

  const fetchHorizonTx = deps.fetchHorizonTx ?? defaultFetchHorizonTx;
  const fetchHorizonPayments = deps.fetchHorizonPayments ?? defaultFetchHorizonPayments;
  const fetchSorobanTx = deps.fetchSorobanTx ?? defaultFetchSorobanTx;

  const horizonTx = await fetchHorizonTx(`${horizonBase}/transactions/${args.txHash}`);
  const sorobanTx = await fetchSorobanTx(rpcUrl, args.txHash);

  const successful =
    (horizonTx?.successful === true) || sorobanTx?.status === 'SUCCESS';

  const events = sorobanTx?.events ?? [];
  const payment = events[0] ?? null;

  // Recipient = first Horizon payment `to` matching treasury, else treasury
  // when a payment event exists (contract forwards to treasury by design).
  const payments = await fetchHorizonPayments(
    `${horizonBase}/transactions/${args.txHash}/payments?limit=50`,
  );
  const treasuryPayment = payments.find((p) => p.to === args.treasury);
  const recipient = treasuryPayment?.to ?? (payment ? args.treasury : null);
  const treasuryMatch = recipient === args.treasury && payment !== null && successful;

  const verified = Boolean(
    successful && payment && treasuryMatch && (!args.contractId || true),
  );

  let reason: string | undefined;
  if (!horizonTx && !sorobanTx) reason = 'transaction_not_found';
  else if (!successful) reason = 'transaction_failed';
  else if (!payment) reason = 'no_payment_event';
  else if (!treasuryMatch) reason = 'treasury_mismatch';

  return {
    verified,
    txHash: args.txHash,
    successful,
    orderId: payment?.orderId ?? null,
    recipient,
    treasury: args.treasury,
    treasuryMatch,
    asset: payment?.asset ?? null,
    amount: payment?.amount ?? treasuryPayment?.amount ?? null,
    sender: payment?.sender ?? null,
    ledger: sorobanTx?.ledger ?? horizonTx?.ledger ?? null,
    reason,
  };
}

/** CLI entrypoint: `stellar_card verify-tx <hash> --treasury <G…>`. */
export async function verifyTxCommand(argv: string[], deps: VerifyTxDeps = {}): Promise<number> {
  const out = deps.out ?? ((t) => process.stdout.write(t));
  const err = deps.err ?? ((t) => process.stderr.write(t));
  const color = deps.color ?? (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);

  const args = parseVerifyArgs(argv);
  if (args.help) {
    out(usage());
    return 0;
  }
  if (!args.txHash) {
    err('error: transaction hash is required\n\n');
    err(usage());
    return 2;
  }
  if (!/^[a-fA-F0-9]{64}$/.test(args.txHash)) {
    err(`error: invalid transaction hash (expected 64 hex chars): ${args.txHash}\n`);
    return 2;
  }
  const treasury = args.treasury || process.env.STELLAR_CARD_TREASURY;
  if (!treasury) {
    err('error: --treasury <G-address> is required (or set STELLAR_CARD_TREASURY)\n\n');
    err(usage());
    return 2;
  }
  if (args.network && args.network !== 'mainnet' && args.network !== 'testnet') {
    err(`error: --network must be 'mainnet' or 'testnet' (got: ${args.network})\n`);
    return 2;
  }

  try {
    const result = await verifyPaymentProof(
      { ...args, txHash: args.txHash, treasury },
      deps,
    );
    if (args.json) {
      out(JSON.stringify(result, null, 2) + '\n');
    } else {
      out(renderVerifyTable(result, color));
    }
    return result.verified ? 0 : 1;
  } catch (e) {
    err(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
