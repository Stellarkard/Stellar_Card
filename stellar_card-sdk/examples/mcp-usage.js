#!/usr/bin/env node
/**
 * Model Context Protocol (MCP) example.
 * 
 * Shows how to use stellar_card as an MCP server for LLM integration.
 * The MCP server exposes tools that AI agents can call to:
 *   - Create wallets
 *   - Check balances
 *   - Purchase cards
 *   - Query order status
 *   - Manage trustlines
 * 
 * This example demonstrates the MCP tool signatures and typical usage.
 * 
 * To use in an LLM app, add to your MCP config:
 *   {
 *     "name": "stellar_card",
 *     "command": "npx stellar_card mcp",
 *     "env": {
 *       "CARDS402_API_KEY": "stellar_card_..."
 *     }
 *   }
 */

// Example MCP tool definitions (for reference)
const MCPTools = {
  // Create a new OWS wallet for the agent
  createWallet: {
    name: 'create_wallet',
    description: 'Create an encrypted OWS wallet for the agent',
    inputSchema: {
      type: 'object',
      properties: {
        agent_name: {
          type: 'string',
          description: 'Unique name for the wallet (e.g., "trading-bot-v1")',
        },
        passphrase: {
          type: 'string',
          description: 'Optional passphrase to encrypt the wallet',
        },
        vault_path: {
          type: 'string',
          description: 'Optional custom path for vault storage',
        },
      },
      required: ['agent_name'],
    },
  },

  // Get wallet balance
  getBalance: {
    name: 'get_balance',
    description: 'Check XLM and USDC balance for a wallet',
    inputSchema: {
      type: 'object',
      properties: {
        agent_name: {
          type: 'string',
          description: 'Name of the wallet to check',
        },
        vault_path: {
          type: 'string',
          description: 'Optional custom vault path',
        },
      },
      required: ['agent_name'],
    },
  },

  // Purchase a card
  purchaseCard: {
    name: 'purchase_card',
    description: 'Purchase a virtual Visa card with USDC or XLM',
    inputSchema: {
      type: 'object',
      properties: {
        agent_name: {
          type: 'string',
          description: 'Wallet to use for payment',
        },
        amount_usdc: {
          type: 'string',
          description: 'Amount in USDC (e.g., "10.00")',
        },
        payment_asset: {
          type: 'string',
          enum: ['usdc', 'xlm'],
          description: 'Pay with USDC or XLM (default: usdc)',
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata to attach to the order',
        },
      },
      required: ['agent_name', 'amount_usdc'],
    },
  },

  // Get order status
  getOrderStatus: {
    name: 'get_order_status',
    description: 'Check the status of a card order',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: {
          type: 'string',
          description: 'Order ID (e.g., "ord_abc123")',
        },
      },
      required: ['order_id'],
    },
  },

  // List orders
  listOrders: {
    name: 'list_orders',
    description: 'List recent card orders',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending_payment', 'delivered', 'failed', 'refunded'],
          description: 'Filter by status',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 20, max: 100)',
        },
      },
    },
  },

  // Add USDC trustline
  addTrustline: {
    name: 'add_usdc_trustline',
    description: 'Add USDC trustline to wallet (required before buying with USDC)',
    inputSchema: {
      type: 'object',
      properties: {
        agent_name: {
          type: 'string',
          description: 'Wallet to configure',
        },
        vault_path: {
          type: 'string',
          description: 'Optional custom vault path',
        },
      },
      required: ['agent_name'],
    },
  },

  // Check version
  checkVersion: {
    name: 'check_version',
    description: 'Check SDK version and available updates',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // Get wallet address
  getWalletAddress: {
    name: 'get_wallet_address',
    description: 'Get the Stellar address for funding',
    inputSchema: {
      type: 'object',
      properties: {
        agent_name: {
          type: 'string',
          description: 'Wallet name',
        },
      },
      required: ['agent_name'],
    },
  },
};

// Example: How an LLM would call these tools

async function exampleMCPUsage() {
  console.log('MCP Tool Usage Examples\n');
  console.log('='.repeat(50));

  // Example 1: Create wallet
  console.log('\n1. Create wallet:');
  console.log(JSON.stringify(
    {
      tool: 'create_wallet',
      input: {
        agent_name: 'trading-bot-v1',
      },
    },
    null,
    2,
  ));
  console.log('\nExpected response:');
  console.log(JSON.stringify(
    {
      wallet_id: 'wallet_abc123',
      public_key: 'GBRPYHIL2CI3WHZDTOOQFC6EB4NCCCEFVPXF2GYXBG4FDGBIYWXUPQM',
    },
    null,
    2,
  ));

  // Example 2: Check balance
  console.log('\n' + '='.repeat(50));
  console.log('\n2. Check balance:');
  console.log(JSON.stringify(
    {
      tool: 'get_balance',
      input: {
        agent_name: 'trading-bot-v1',
      },
    },
    null,
    2,
  ));
  console.log('\nExpected response:');
  console.log(JSON.stringify(
    {
      xlm: '100.50',
      usdc: '250.75',
    },
    null,
    2,
  ));

  // Example 3: Purchase card
  console.log('\n' + '='.repeat(50));
  console.log('\n3. Purchase card:');
  console.log(JSON.stringify(
    {
      tool: 'purchase_card',
      input: {
        agent_name: 'trading-bot-v1',
        amount_usdc: '10.00',
        payment_asset: 'usdc',
        metadata: {
          merchant: 'acme.com',
          reason: 'API subscription renewal',
        },
      },
    },
    null,
    2,
  ));
  console.log('\nExpected response:');
  console.log(JSON.stringify(
    {
      number: '4111111111111111',
      cvv: '123',
      expiry: '12/27',
      brand: 'Visa',
    },
    null,
    2,
  ));

  // Example 4: Get order status
  console.log('\n' + '='.repeat(50));
  console.log('\n4. Get order status:');
  console.log(JSON.stringify(
    {
      tool: 'get_order_status',
      input: {
        order_id: 'ord_abc123',
      },
    },
    null,
    2,
  ));
  console.log('\nExpected response:');
  console.log(JSON.stringify(
    {
      order_id: 'ord_abc123',
      status: 'delivered',
      phase: 'ready',
      card: {
        number: '4111111111111111',
        cvv: '123',
        expiry: '12/27',
        brand: 'Visa',
      },
    },
    null,
    2,
  ));

  // Example 5: List orders
  console.log('\n' + '='.repeat(50));
  console.log('\n5. List orders:');
  console.log(JSON.stringify(
    {
      tool: 'list_orders',
      input: {
        status: 'delivered',
        limit: 10,
      },
    },
    null,
    2,
  ));
  console.log('\nExpected response:');
  console.log(JSON.stringify(
    [
      {
        id: 'ord_abc',
        status: 'delivered',
        amount_usdc: '10.00',
        payment_asset: 'usdc',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:30Z',
      },
    ],
    null,
    2,
  ));
}

exampleMCPUsage();

console.log('\n' + '='.repeat(50));
console.log('\nTo start the MCP server:');
console.log('  stellar_card mcp');
console.log('\nOr with a custom API key:');
console.log('  CARDS402_API_KEY=stellar_card_... stellar_card mcp');
