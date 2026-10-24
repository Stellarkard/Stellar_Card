// `stellar_card status` / `stellar_card balance` CLI commands (#702).

import { describe, it, expect, vi } from 'vitest';
import { statusCommand, balanceCommand, badge, badgeColor, renderTable } from '../commands/status';

const ORDERS = [
  {
    id: 'ord_1',
    status: 'delivered',
    amount_usdc: '10.00',
    payment_asset: 'usdc',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'ord_2',
    status: 'pending_payment',
    amount_usdc: '25.00',
    payment_asset: 'xlm',
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
];

const ORDER_READY = {
  order_id: 'ord_1',
  status: 'delivered',
  phase: 'ready' as const,
  amount_usdc: '10.00',
  payment_asset: 'usdc',
  card: { number: '4111111111111234', cvv: '123', expiry: '12/27', brand: 'Visa' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const USAGE = {
  api_key_id: 'key_1',
  label: 'agent-1',
  budget: {
    spent_usdc: '35.00',
    in_flight_usdc: '5.00',
    committed_usdc: '40.00',
    limit_usdc: '100.00',
    remaining_usdc: '60.00',
  },
  orders: { total: 3, delivered: 2, failed: 0, refunded: 0, in_progress: 1 },
};

function harness(client: Record<string, unknown>, color = false) {
  let out = '';
  let err = '';
  return {
    deps: {
      client: client as never,
      out: (t: string) => (out += t),
      err: (t: string) => (err += t),
      color,
    },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

describe('badge colors', () => {
  it('maps active/pending/expired statuses to green/yellow/red', () => {
    expect(badgeColor('active')).toBe('green');
    expect(badgeColor('delivered')).toBe('green');
    expect(badgeColor('pending_payment')).toBe('yellow');
    expect(badgeColor('ordering')).toBe('yellow');
    expect(badgeColor('expired')).toBe('red');
    expect(badgeColor('failed')).toBe('red');
  });

  it('wraps labels in ANSI codes only when color is on', () => {
    expect(badge('active', false)).toBe('ACTIVE');
    expect(badge('active', true)).toBe('\x1b[32mACTIVE\x1b[0m');
    expect(badge('expired', true)).toContain('\x1b[31m');
  });
});

describe('stellar_card status', () => {
  it('prints a table with all required columns', async () => {
    const h = harness({ listOrders: vi.fn().mockResolvedValue(ORDERS) });
    expect(await statusCommand([], h.deps)).toBe(0);
    const [header, , row1, row2] = h.out.split('\n');
    for (const col of ['Order ID', 'Status', 'Amount', 'Asset', 'Created', 'Card ID']) {
      expect(header).toContain(col);
    }
    expect(row1).toContain('ord_1');
    expect(row1).toContain('DELIVERED');
    expect(row2).toContain('PENDING_PAYMENT');
    expect(row2).toContain('25.00');
  });

  it('outputs raw JSON with --json', async () => {
    const h = harness({ listOrders: vi.fn().mockResolvedValue(ORDERS) }, true);
    await statusCommand(['--json'], h.deps);
    expect(JSON.parse(h.out)).toEqual(ORDERS);
    expect(h.out).not.toContain('\x1b[');
  });

  it('looks up a single order with --order and masks the card number', async () => {
    const getOrder = vi.fn().mockResolvedValue(ORDER_READY);
    const h = harness({ getOrder });
    await statusCommand(['--order', 'ord_1'], h.deps);
    expect(getOrder).toHaveBeenCalledWith('ord_1');
    expect(h.out).toContain('•••• 1234');
    expect(h.out).not.toContain('4111111111111234');
  });

  it('passes --status and --limit filters through', async () => {
    const listOrders = vi.fn().mockResolvedValue([]);
    const h = harness({ listOrders });
    await statusCommand(['--status=delivered', '--limit', '5'], h.deps);
    expect(listOrders).toHaveBeenCalledWith({ status: 'delivered', limit: 5 });
    expect(h.out).toBe('No orders found.\n');
  });

  it('colorizes status badges when color is enabled', async () => {
    const h = harness({ listOrders: vi.fn().mockResolvedValue(ORDERS) }, true);
    await statusCommand([], h.deps);
    expect(h.out).toContain('\x1b[32mDELIVERED\x1b[0m');
    expect(h.out).toContain('\x1b[33mPENDING_PAYMENT\x1b[0m');
  });

  it('returns 1 and prints the error on failure', async () => {
    const h = harness({ listOrders: vi.fn().mockRejectedValue(new Error('invalid api key')) });
    expect(await statusCommand([], h.deps)).toBe(1);
    expect(h.err).toBe('error: invalid api key\n');
  });

  it('uses STELLAR_CARD_API_KEY when no client is injected', async () => {
    const prev = process.env.STELLAR_CARD_API_KEY;
    process.env.STELLAR_CARD_API_KEY = 'env_key';
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      let out = '';
      await statusCommand([], { out: (t) => (out += t), color: false });
      const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
      expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('env_key');
      expect(out).toBe('No orders found.\n');
    } finally {
      vi.unstubAllGlobals();
      if (prev === undefined) delete process.env.STELLAR_CARD_API_KEY;
      else process.env.STELLAR_CARD_API_KEY = prev;
    }
  });
});

describe('stellar_card balance', () => {
  it('prints the budget summary', async () => {
    const h = harness({ getUsage: vi.fn().mockResolvedValue(USAGE) });
    expect(await balanceCommand([], h.deps)).toBe(0);
    expect(h.out).toContain('spent:     35.00 USDC');
    expect(h.out).toContain('remaining: 60.00 USDC');
    expect(h.out).toContain('3 total, 2 delivered, 1 in progress');
  });

  it('shows unlimited budgets and supports --json', async () => {
    const unlimited = {
      ...USAGE,
      budget: { ...USAGE.budget, limit_usdc: null, remaining_usdc: null },
    };
    const h = harness({ getUsage: vi.fn().mockResolvedValue(unlimited) });
    await balanceCommand([], h.deps);
    expect(h.out).toContain('limit:     unlimited');

    const j = harness({ getUsage: vi.fn().mockResolvedValue(USAGE) });
    await balanceCommand(['--json'], j.deps);
    expect(JSON.parse(j.out)).toEqual(USAGE);
  });

  it('returns 1 on error', async () => {
    const h = harness({ getUsage: vi.fn().mockRejectedValue(new Error('nope')) });
    expect(await balanceCommand([], h.deps)).toBe(1);
    expect(h.err).toContain('nope');
  });
});

describe('renderTable', () => {
  it('aligns columns', () => {
    const table = renderTable(
      [
        {
          orderId: 'a',
          status: 'active',
          amount: '1',
          asset: 'usdc',
          createdAt: 'x',
          cardId: '-',
        },
      ],
      false,
    );
    const lines = table.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]!.indexOf('Status')).toBe(lines[2]!.indexOf('ACTIVE'));
  });
});
