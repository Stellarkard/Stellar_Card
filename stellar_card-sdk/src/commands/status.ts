// `stellar_card status` / `stellar_card balance` — inspect orders and the
// API key's budget straight from the terminal (#702).
//
// Auth: STELLAR_CARD_API_KEY env var, else the client's normal resolution
// (CARDS402_API_KEY / ~/.stellar_card/config.json).

import { Stellar_CardClient } from '../client';
import type { OrderListItem, OrderStatus, UsageSummary } from '../client';

type StatusClient = Pick<Stellar_CardClient, 'listOrders' | 'getOrder' | 'getUsage'>;

export interface CliDeps {
  client?: StatusClient;
  out?: (text: string) => void;
  err?: (text: string) => void;
  /** Force colors on/off. Defaults to stdout TTY detection + NO_COLOR. */
  color?: boolean;
}

const COLORS = { green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m' };

const GREEN = new Set(['active', 'ready', 'delivered', 'completed']);
const RED = new Set(['expired', 'failed', 'rejected', 'refunded', 'cancelled']);

/** Map an order status to a badge color: green=active, yellow=pending, red=expired/failed. */
export function badgeColor(status: string): keyof typeof COLORS {
  const s = status.toLowerCase();
  if (GREEN.has(s)) return 'green';
  if (RED.has(s)) return 'red';
  return 'yellow';
}

export function badge(status: string, color: boolean): string {
  const label = status.toUpperCase();
  return color ? `${COLORS[badgeColor(status)]}${label}${COLORS.reset}` : label;
}

export interface StatusRow {
  orderId: string;
  status: string;
  amount: string;
  asset: string;
  createdAt: string;
  cardId: string;
}

function toRow(o: OrderListItem | OrderStatus): StatusRow {
  const isList = 'id' in o;
  const card = !isList ? (o as OrderStatus).card : undefined;
  return {
    orderId: isList ? (o as OrderListItem).id : (o as OrderStatus).order_id,
    status: o.status,
    amount: o.amount_usdc,
    asset: o.payment_asset,
    createdAt: o.created_at,
    cardId: card?.number ? `•••• ${card.number.slice(-4)}` : '-',
  };
}

/** Render rows as an aligned text table. Colors are applied after padding. */
export function renderTable(rows: StatusRow[], color: boolean): string {
  const headers = ['Order ID', 'Status', 'Amount', 'Asset', 'Created', 'Card ID'];
  const cells = rows.map((r) => [
    r.orderId,
    r.status.toUpperCase(),
    r.amount,
    r.asset,
    r.createdAt,
    r.cardId,
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i]!.length)));
  const line = (c: string[]): string =>
    c
      .map((v, i) => v.padEnd(widths[i]!))
      .join('  ')
      .trimEnd();
  const body = cells.map((c, idx) => {
    const padded = line(c);
    if (!color) return padded;
    const raw = c[1]!;
    return padded.replace(raw, badge(rows[idx]!.status, true));
  });
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...body].join('\n') + '\n';
}

function parseArgs(argv: string[]): { json: boolean; flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') json = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      flags[k!] = v ?? argv[++i] ?? '';
    }
  }
  return { json, flags };
}

function resolve(
  deps: CliDeps,
): Required<Omit<CliDeps, 'client'>> & { client: () => StatusClient } {
  return {
    client: () =>
      deps.client ??
      new Stellar_CardClient({ apiKey: process.env.STELLAR_CARD_API_KEY || undefined }),
    out: deps.out ?? ((t) => process.stdout.write(t)),
    err: deps.err ?? ((t) => process.stderr.write(t)),
    color: deps.color ?? (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR),
  };
}

/** `stellar_card status [--order <id>] [--status <s>] [--limit <n>] [--json]` */
export async function statusCommand(argv: string[], deps: CliDeps = {}): Promise<number> {
  const { client, out, err, color } = resolve(deps);
  const { json, flags } = parseArgs(argv);
  try {
    const c = client();
    const orders = flags.order
      ? [await c.getOrder(flags.order)]
      : await c.listOrders({
          status: flags.status,
          limit: flags.limit ? Number(flags.limit) : 20,
        });
    if (json) {
      out(`${JSON.stringify(orders, null, 2)}\n`);
      return 0;
    }
    if (orders.length === 0) {
      out('No orders found.\n');
      return 0;
    }
    out(renderTable(orders.map(toRow), color && !json));
    return 0;
  } catch (e) {
    err(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

/** `stellar_card balance [--json]` — budget for the configured API key. */
export async function balanceCommand(argv: string[], deps: CliDeps = {}): Promise<number> {
  const { client, out, err } = resolve(deps);
  const { json } = parseArgs(argv);
  try {
    const usage: UsageSummary = await client().getUsage();
    if (json) {
      out(`${JSON.stringify(usage, null, 2)}\n`);
      return 0;
    }
    const b = usage.budget;
    out(
      [
        `api key:   ${usage.label ?? usage.api_key_id}`,
        `spent:     ${b.spent_usdc} USDC`,
        `in flight: ${b.in_flight_usdc} USDC`,
        `limit:     ${b.limit_usdc ?? 'unlimited'}${b.limit_usdc ? ' USDC' : ''}`,
        `remaining: ${b.remaining_usdc ?? 'unlimited'}${b.remaining_usdc ? ' USDC' : ''}`,
        `orders:    ${usage.orders.total} total, ${usage.orders.delivered} delivered, ${usage.orders.in_progress} in progress`,
      ].join('\n') + '\n',
    );
    return 0;
  } catch (e) {
    err(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
