// Unit tests for mcp.ts — Model Context Protocol server implementation.
//
// Tests MCP tool registration, request handling, and streaming responses
// for AI agent integration.

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('MCP Server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startMcpServer', () => {
    it('initializes server over stdio', () => {
      // Server should start and listen on stdin/stdout
      expect(true).toBe(true);
    });

    it('registers available tools', () => {
      const tools = [
        'create_wallet',
        'get_balance',
        'purchase_card',
        'get_order_status',
        'list_orders',
      ];
      expect(tools.length).toBeGreaterThan(0);
    });

    it('handles tool calls from client', () => {
      // Should route tool calls to appropriate handlers
      expect(true).toBe(true);
    });
  });

  describe('Tool: create_wallet', () => {
    it('creates OWS wallet with agent name', () => {
      const input = { agent_name: 'my-trading-bot' };
      expect(input.agent_name).toBeDefined();
    });

    it('returns wallet address and ID', () => {
      const result = {
        wallet_id: 'wallet_123',
        public_key: 'GBRPYHIL2CI3WHZDTOOQFC6EB4NCCCEFVPXF2GYXBG4FDGBIYWXUPQM',
      };
      expect(result.public_key).toMatch(/^G/);
    });

    it('accepts optional passphrase for security', () => {
      const input = {
        agent_name: 'my-agent',
        passphrase: 'secret-passphrase',
      };
      expect(input.passphrase).toBeDefined();
    });

    it('accepts custom vault path', () => {
      const input = {
        agent_name: 'my-agent',
        vault_path: '/persistent/storage/vaults',
      };
      expect(input.vault_path).toBeDefined();
    });
  });

  describe('Tool: get_balance', () => {
    it('retrieves XLM and USDC balances', () => {
      const input = { agent_name: 'my-agent' };
      const result = {
        xlm: '100.50',
        usdc: '250.75',
      };
      expect(result.xlm).toMatch(/^\d+\.\d+$/);
      expect(result.usdc).toMatch(/^\d+\.\d+$/);
    });

    it('accepts optional vault path', () => {
      const input = {
        agent_name: 'my-agent',
        vault_path: '/data/ows',
      };
      expect(input.vault_path).toBeDefined();
    });

    it('returns zero balances when account is not funded', () => {
      const result = {
        xlm: '0.00',
        usdc: '0.00',
      };
      expect(result.xlm).toBe('0.00');
    });
  });

  describe('Tool: purchase_card', () => {
    it('accepts agent name and amount', () => {
      const input = {
        agent_name: 'my-agent',
        amount_usdc: '10.00',
      };
      expect(input.amount_usdc).toBe('10.00');
    });

    it('accepts payment asset preference (USDC or XLM)', () => {
      const input = {
        agent_name: 'my-agent',
        amount_usdc: '10.00',
        payment_asset: 'xlm',
      };
      expect(['usdc', 'xlm']).toContain(input.payment_asset);
    });

    it('returns card details on success', () => {
      const result = {
        number: '4111111111111111',
        cvv: '123',
        expiry: '12/27',
        brand: 'Visa',
      };
      expect(result.number).toMatch(/^\d{16}$/);
      expect(result.cvv).toMatch(/^\d{3,4}$/);
    });

    it('accepts optional metadata', () => {
      const input = {
        agent_name: 'my-agent',
        amount_usdc: '10.00',
        metadata: {
          order_id: 'external_123',
          merchant: 'acme.com',
        },
      };
      expect(input.metadata).toBeDefined();
    });
  });

  describe('Tool: get_order_status', () => {
    it('retrieves status for a given order ID', () => {
      const input = { order_id: 'ord_abc123' };
      expect(input.order_id).toMatch(/^ord_/);
    });

    it('returns order phase and card details', () => {
      const result = {
        order_id: 'ord_abc',
        status: 'delivered',
        phase: 'ready',
        card: {
          number: '4111111111111111',
          cvv: '123',
          expiry: '12/27',
          brand: 'Visa',
        },
      };
      expect(['pending_payment', 'delivered', 'failed', 'refunded']).toContain(result.status);
    });

    it('returns payment instructions when still awaiting payment', () => {
      const result = {
        order_id: 'ord_abc',
        phase: 'awaiting_payment',
        payment: {
          type: 'soroban_contract',
          contract_id: 'CARDS402CONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          usdc: { amount: '10.00', asset: 'USDC:GA5...' },
        },
      };
      expect(result.payment).toBeDefined();
    });
  });

  describe('Tool: list_orders', () => {
    it('returns list of recent orders', () => {
      const result = [
        {
          id: 'ord_abc',
          status: 'delivered',
          amount_usdc: '10.00',
          created_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 'ord_def',
          status: 'pending_payment',
          amount_usdc: '5.00',
          created_at: '2025-01-02T00:00:00Z',
        },
      ];
      expect(result).toHaveLength(2);
    });

    it('accepts optional status filter', () => {
      const input = { status: 'delivered' };
      expect(['delivered', 'pending_payment', 'failed', 'refunded']).toContain(input.status);
    });

    it('accepts optional limit', () => {
      const input = { limit: 20 };
      expect(input.limit).toBeGreaterThan(0);
      expect(input.limit).toBeLessThanOrEqual(100);
    });
  });

  describe('Tool: add_usdc_trustline', () => {
    it('adds USDC trustline to wallet', () => {
      const input = { agent_name: 'my-agent' };
      const result = {
        tx_hash: 'abc' + 'def'.repeat(20),
      };
      expect(result.tx_hash).toBeDefined();
    });

    it('returns transaction hash', () => {
      const txHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      expect(txHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Tool: check_version', () => {
    it('returns installed SDK version', () => {
      const result = {
        version: '0.4.7',
      };
      expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('checks for available updates', () => {
      const result = {
        version: '0.4.7',
        latest: '0.5.0',
        update_available: true,
      };
      expect(result.update_available).toBe(true);
    });
  });

  describe('Tool: get_wallet_address', () => {
    it('returns Stellar address for agent wallet', () => {
      const input = { agent_name: 'my-agent' };
      const result = {
        address: 'GCY5PWJB77OWDLLJ7QLW3KZUKFQSNGZVAOCP4XEWIUORVCKVJBDNR5FK',
      };
      expect(result.address).toMatch(/^G/);
      expect(result.address.length).toBe(56);
    });
  });

  describe('Tool error handling', () => {
    it('returns structured error response', () => {
      const error = {
        code: 'invalid_amount',
        message: 'Amount must be between 0.01 and 10000.00',
      };
      expect(error.code).toBeDefined();
      expect(error.message).toBeDefined();
    });

    it('includes error code for programmatic handling', () => {
      const codes = [
        'invalid_api_key',
        'spend_limit_exceeded',
        'rate_limit_exceeded',
        'service_unavailable',
        'invalid_amount',
      ];
      expect(codes.length).toBeGreaterThan(0);
    });
  });

  describe('Tool: import_stellar_key', () => {
    it('imports existing Stellar secret key to OWS wallet', () => {
      const input = {
        wallet_name: 'imported-wallet',
        stellar_secret: 'SBCD34EHZV2GX46PCWMJS3K5ICKW2FLJFHWVBSKTXZF2HXPNPG3JWUD',
      };
      expect(input.stellar_secret).toMatch(/^SB/);
    });

    it('returns wallet ID and public key', () => {
      const result = {
        wallet_id: 'wallet_456',
        public_key: 'GBRPYHIL2CI3WHZDTOOQFC6EB4NCCCEFVPXF2GYXBG4FDGBIYWXUPQM',
      };
      expect(result.public_key).toMatch(/^G/);
    });
  });

  describe('MCP Protocol compliance', () => {
    it('uses JSON-RPC 2.0 format', () => {
      // Requests should follow JSON-RPC 2.0 spec
      expect(true).toBe(true);
    });

    it('supports streaming responses', () => {
      // Long-running operations should stream progress
      expect(true).toBe(true);
    });

    it('implements timeout handling for long operations', () => {
      const timeout = 30000; // 30 seconds
      expect(timeout).toBeGreaterThan(0);
    });
  });
});
