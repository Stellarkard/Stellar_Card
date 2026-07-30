// @ts-check
// OpenAPI spec generation. Route documentation lives as JSDoc @openapi
// blocks next to the handlers they describe (src/api/*.js); this module
// just wires swagger-jsdoc to scan those files and assembles the shared
// schema/security definitions referenced from them.

const swaggerJsdoc = require('swagger-jsdoc');

const PORT = process.env.PORT || 4000;

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'stellar_card API',
    version: '0.1.0',
    description:
      'USDC-to-VCC fulfillment engine. Agents create orders against `/v1`, pay in USDC or XLM on ' +
      'Stellar, and receive a virtual card once payment settles. Operators manage keys, approvals ' +
      'and alerts under `/dashboard`.',
  },
  servers: [{ url: `http://localhost:${PORT}`, description: 'Local development' }],
  tags: [
    {
      name: 'Agent API',
      description: 'Order creation and polling under /v1, authenticated by API key.',
    },
    {
      name: 'Agent Onboarding',
      description: 'One-shot claim flow that exchanges a mint code for an API key.',
    },
    { name: 'Auth', description: 'Operator dashboard session login (OTP-based).' },
    {
      name: 'Dashboard',
      description:
        'Operator-facing management API. Requires a dashboard session and per-action permission.',
    },
    { name: 'System', description: 'Health, version and usage endpoints.' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description: 'Agent API key, sent as `Authorization: Bearer <api_key>`.',
      },
      DashboardSession: {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description:
          'Dashboard session token, sent as `Authorization: Bearer <session_token>` after `/auth/login` + `/auth/verify`.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', description: 'Machine-readable error code.' },
          message: { type: 'string', description: 'Human-readable explanation.' },
        },
        required: ['error'],
      },
      Order: {
        type: 'object',
        properties: {
          order_id: { type: 'string', format: 'uuid' },
          status: {
            type: 'string',
            enum: [
              'pending_payment',
              'ordering',
              'awaiting_approval',
              'delivered',
              'expired',
              'rejected',
              'failed',
              'refund_pending',
              'refunded',
              'pending_manual_recovery',
            ],
          },
          phase: { type: 'string', description: 'Coarse-grained status grouping for UI display.' },
          amount_usdc: { type: 'string', example: '10.00' },
          payment_asset: { type: 'string', enum: ['usdc', 'xlm'] },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          payment: {
            type: 'object',
            description: 'Present while status is pending_payment — on-chain payment instructions.',
            nullable: true,
          },
          card: {
            type: 'object',
            description: 'Present once status is delivered.',
            nullable: true,
          },
          note: { type: 'string', nullable: true },
        },
      },
      OrderCreateRequest: {
        type: 'object',
        required: ['amount_usdc'],
        properties: {
          amount_usdc: {
            type: 'string',
            description: 'Decimal USD amount, at most 2 decimal places. Min $0.01, max $10000.00.',
            example: '10.00',
          },
          webhook_url: {
            type: 'string',
            format: 'uri',
            nullable: true,
            description:
              'Optional callback URL notified on order status changes. Must resolve to a public address (SSRF-checked).',
          },
          metadata: {
            type: 'object',
            nullable: true,
            description:
              'Optional caller-defined JSON object, echoed back verbatim. Max 8KB serialized.',
          },
        },
      },
    },
  },
};

// Only src/api/*.js is scanned. app.js used to be in this list because it
// still carried inline handler bodies and their `@openapi` blocks; those
// annotations now live beside the handlers in the route modules, and
// app.js owns no routes at all (asserted by
// test/integration/route-registry.test.js). Leaving it here would be a
// standing invitation to document a route in the one file that must not
// declare any.
const options = {
  definition,
  apis: ['./src/api/*.js'],
};

const openapiSpec = swaggerJsdoc(/** @type {any} */ (options));

module.exports = { openapiSpec };
