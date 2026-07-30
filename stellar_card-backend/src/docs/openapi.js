// @ts-check
// Static OpenAPI 3.0 description of the public/agent-facing API surface.
//
// Covers the endpoints an external integrator (an AI agent or an SDK)
// actually calls: version/status, auth, agent claim/status, orders,
// usage/policy, the VCC callback, and MPP discovery. The session-authenticated
// operator surface (/dashboard, /internal, /dashboard/platform) is
// intentionally out of scope here — it is a browser-only admin API, not
// something third parties integrate against.

const openapiSpec = {
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
      'USDC-to-virtual-card fulfillment API for autonomous agents. Every /v1/* route ' +
      'requires an `X-Api-Key` header (obtained via /v1/agent/claim) unless noted otherwise.',
  },
  servers: [{ url: '/', description: 'Same-origin' }],
  tags: [
    { name: 'Public', description: 'Unauthenticated endpoints' },
    { name: 'Auth', description: 'Email login-code session flow' },
    { name: 'Agent', description: 'Api-key authenticated agent surface' },
    { name: 'Orders', description: 'Card order lifecycle' },
    { name: 'MPP', description: 'Machine Payments Protocol discovery (feature-flagged)' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      SessionAuth: { type: 'apiKey', in: 'cookie', name: 'session' },
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
          error: { type: 'string', example: 'not_found' },
          message: { type: 'string' },
          req_id: { type: 'string' },
        },
        required: ['error'],
      },
    },
  },
  paths: {
    '/api/version': {
      get: {
        tags: ['Public'],
        summary: 'Deploy-time compatibility check',
        responses: {
          200: {
            description: 'Service version and supported protocol features',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    service: { type: 'string' },
                    version: { type: 'string' },
                    hmac_protocol: { type: 'string' },
                    features: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/status': {
      get: {
        tags: ['Public'],
        summary: 'System health and order-pipeline snapshot',
        responses: { 200: { description: 'Health summary' } },
      },
    },
    '/v1/agent/claim': {
      post: {
        tags: ['Agent'],
        summary: 'Redeem a dashboard-minted claim code for an API key',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { code: { type: 'string' } },
                required: ['code'],
              },
            },
          },
        },
        responses: {
          200: { description: 'API key issued' },
          400: {
            description: 'Invalid or expired claim code',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/v1/agent/status': {
      post: {
        tags: ['Agent'],
        summary: 'Report agent onboarding/lifecycle state',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  state: {
                    type: 'string',
                    enum: ['initializing', 'awaiting_funding', 'funded'],
                  },
                  wallet_public_key: { type: 'string' },
                  detail: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Acknowledged' } },
      },
    },
    '/v1/usage': {
      get: {
        tags: ['Agent'],
        summary: "Caller's own spend and order-status summary",
        security: [{ ApiKeyAuth: [] }],
        responses: { 200: { description: 'Usage summary' } },
      },
    },
    '/v1/policy/check': {
      get: {
        tags: ['Agent'],
        summary: 'Dry-run a spend-policy check without creating an order',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'amount',
            in: 'query',
            required: true,
            schema: { type: 'number' },
          },
        ],
        responses: { 200: { description: 'Policy decision' } },
      },
    },
    '/v1/orders': {
      get: {
        tags: ['Orders'],
        summary: 'List orders for the caller',
        security: [{ ApiKeyAuth: [] }],
        responses: { 200: { description: 'Order list' } },
      },
      post: {
        tags: ['Orders'],
        summary: 'Create a new card order',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          201: { description: 'Order created' },
          400: {
            description: 'Validation error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/v1/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'Fetch a single order by id',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Order detail' },
          404: {
            description: 'Order not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/v1/orders/{id}/stream': {
      get: {
        tags: ['Orders'],
        summary: 'Server-Sent Events stream of order status updates',
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'text/event-stream of order updates' } },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Send a one-time login code by email',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { email: { type: 'string', format: 'email' } },
                required: ['email'],
              },
            },
          },
        },
        responses: { 200: { description: 'Code sent (generic response regardless of outcome)' } },
      },
    },
    '/auth/verify': {
      post: {
        tags: ['Auth'],
        summary: 'Verify a login code and start a session',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  code: { type: 'string' },
                },
                required: ['email', 'code'],
              },
            },
          },
        },
        responses: { 200: { description: 'Session established' } },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Invalidate the current session',
        responses: { 200: { description: 'Logged out' } },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Return the current session user',
        security: [{ SessionAuth: [] }],
        responses: { 200: { description: 'Current user' } },
      },
    },
    '/vcc-callback': {
      post: {
        tags: ['Public'],
        summary: 'HMAC-authenticated fulfillment callback from the VCC provider',
        description: 'Not intended for third-party integrators; documented for completeness.',
        responses: { 200: { description: 'Callback accepted' } },
      },
    },
    '/v1/.well-known/mpp': {
      get: {
        tags: ['MPP'],
        summary: 'Machine Payments Protocol discovery document',
        description: 'Only mounted when MPP_ENABLED=true.',
        responses: { 200: { description: 'MPP discovery document' } },
      },
    },
    '/v1/cards/visa/{amount}': {
      get: {
        tags: ['MPP'],
        summary: 'Request an MPP payment challenge for a Visa card of the given amount',
        parameters: [{ name: 'amount', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Payment challenge' } },
      },
    },
    '/v1/mpp/receipts/{id}': {
      get: {
        tags: ['MPP'],
        summary: 'Poll an MPP receipt by id',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Receipt status' } },
      },
    },
  },
};

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

const options = {
  definition,
  apis: ['./src/api/*.js', './src/app.js'],
};

const openapiSpec = swaggerJsdoc(/** @type {any} */ (options));

module.exports = { openapiSpec };
