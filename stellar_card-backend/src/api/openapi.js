// @ts-check
// The OpenAPI 3.0.3 description of everything this server exposes.
//
// ── Why this is JavaScript and not a YAML file ─────────────────────────────
//
// The failure mode of API documentation is not being absent. It is being
// present and wrong: a client reads `maxLength: 2048`, sizes a buffer to
// match, and discovers in production that the server has enforced 1024
// since a refactor nobody remembered to mirror into the spec. A static
// document drifts silently because nothing executes it.
//
// Building the document in the same process that serves the API removes
// the class of drift that matters most — the bounds and enumerations the
// validation layer actually enforces. `ORDER_STATUSES`, the amount
// pattern, the metadata byte budget and the URL cap are all imported from
// api/orders.js, which is the module whose Zod schemas enforce them, and
// info.version comes from the same frozen payload GET /api/version
// returns. Changing a bound changes the published schema in the same
// commit, or it does not change at all.
//
// What this cannot catch — a path documented that no router mounts, or a
// public path mounted that nothing documents — is covered behaviourally
// by test/integration/openapi.test.js, which walks the real route table.
//
// ── Scope ──────────────────────────────────────────────────────────────────
//
// The public and agent-facing surface: the unauthenticated endpoints, the
// /v1 agent API, and the session-issuing half of /auth. The operator
// surface (/dashboard, /dashboard/platform, /internal) and the
// machine-to-machine /vcc-callback are deliberately excluded and the
// exclusion is asserted, not assumed — see `UNDOCUMENTED_PREFIXES` below
// and the test that pins it. Publishing an operator API to anonymous
// readers hands an attacker a map; those routes are documented for
// operators in docs/, not here.

const {
  ORDER_STATUSES,
  AMOUNT_USDC_SHAPE,
  MIN_ORDER_USDC,
  MAX_ORDER_USDC,
  MAX_METADATA_JSON_BYTES,
  MAX_WEBHOOK_URL_CHARS,
} = require('./orders');
const { VERSION_PAYLOAD } = require('./version');

/**
 * Path prefixes that are intentionally absent from the document.
 *
 * Exported so the integration test can assert the exclusion is a decision
 * rather than an oversight: a new router mounted under a prefix that is
 * neither documented nor listed here fails the suite.
 */
const UNDOCUMENTED_PREFIXES = Object.freeze([
  '/dashboard', // operator surface, session-authenticated
  '/internal', // operator surface, session-authenticated
  '/vcc-callback', // HMAC machine-to-machine, no human client
  '/v1/.well-known', // MPP discovery, self-describing by protocol
  '/v1/cards', // MPP payment challenge, feature-flagged
  '/v1/mpp', // MPP receipts, feature-flagged
  '/api/docs', // the documentation UI itself
  '/api/openapi.json', // this document
]);

// ── Reusable response bodies ───────────────────────────────────────────────

const ErrorResponse = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'string',
      description:
        'Stable machine-readable code. Clients should branch on this, never on `message`.',
      example: 'invalid_amount',
    },
    message: {
      type: 'string',
      description: 'Human-readable explanation. Wording may change between releases.',
    },
    req_id: {
      type: 'string',
      description:
        'Correlation id, also returned in the X-Request-ID response header. Quote it in support requests.',
    },
  },
};

/** @param {string} description @param {string[]} [codes] */
function errorResponse(description, codes) {
  const schema = codes
    ? { allOf: [{ $ref: '#/components/schemas/Error' }], example: { error: codes[0] } }
    : { $ref: '#/components/schemas/Error' };
  return {
    description: codes
      ? `${description} Possible \`error\` codes: ${codes.join(', ')}.`
      : description,
    content: { 'application/json': { schema } },
  };
}

const COMMON_ERRORS = {
  401: errorResponse('Authentication failed.', ['missing_api_key', 'invalid_api_key']),
  429: errorResponse('Rate limited. Retry after the window in the RateLimit headers.', [
    'too_many_requests',
    'rate_limit_exceeded',
  ]),
};

// ── Schemas ────────────────────────────────────────────────────────────────

const OrderSummary = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: [...ORDER_STATUSES] },
    amount_usdc: { type: 'string', example: '10.00' },
    payment_asset: { type: 'string', enum: ['usdc', 'xlm'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const CreateOrderRequest = {
  type: 'object',
  required: ['amount_usdc'],
  // Unknown properties are accepted and preserved: POST /v1/orders hashes
  // the raw body for its idempotency fingerprint, so a schema that
  // stripped them would change which retries count as identical.
  additionalProperties: true,
  properties: {
    amount_usdc: {
      type: 'string',
      // Sourced from the same regex the request validator applies.
      pattern: AMOUNT_USDC_SHAPE.source,
      description: [
        'Card value in USDC, as a decimal **string** with at most 2 decimal places.',
        '',
        'A string rather than a number because JSON numbers lose cents to float',
        `representation. Must be between $${MIN_ORDER_USDC.toFixed(2)} and`,
        `$${MAX_ORDER_USDC.toFixed(2)} — the smallest value the issuer can represent`,
        'and the ceiling on a single prepaid card balance.',
      ].join('\n'),
      example: '10.00',
    },
    webhook_url: {
      type: 'string',
      format: 'uri',
      maxLength: MAX_WEBHOOK_URL_CHARS,
      description: [
        'HTTPS endpoint notified when the order reaches a terminal state.',
        '',
        'Resolved and checked against private address ranges before the order is',
        'accepted, so a URL pointing at internal infrastructure is rejected with',
        '`invalid_webhook_url` rather than silently never firing.',
      ].join('\n'),
    },
    metadata: {
      type: 'object',
      additionalProperties: true,
      description: [
        'Arbitrary JSON object echoed back on every read of this order.',
        '',
        `Capped at ${MAX_METADATA_JSON_BYTES} **bytes** of serialised JSON, not characters —`,
        'multi-byte content counts for what it costs.',
      ].join('\n'),
    },
  },
};

const Budget = {
  type: 'object',
  description: 'Spend limits and remaining headroom for the calling key.',
  additionalProperties: true,
};

const PolicyDecision = {
  type: 'object',
  properties: {
    decision: {
      type: 'string',
      enum: ['approved', 'blocked', 'pending_approval'],
      description:
        'What would happen if this amount were ordered now. A preview: nothing is persisted.',
    },
    rule: { type: 'string', description: 'Which rule decided, e.g. `daily_limit_exceeded`.' },
    reason: { type: 'string' },
  },
  additionalProperties: true,
};

// ── Paths ──────────────────────────────────────────────────────────────────

const paths = {
  '/api/version': {
    get: {
      operationId: 'getVersion',
      tags: ['Meta'],
      summary: 'Protocol and feature compatibility',
      description:
        'Called by SDKs on startup to decide whether the server speaks a protocol they understand, and by deploy tooling to confirm a rollout landed. Unauthenticated.',
      security: [],
      responses: {
        200: {
          description: 'Deployment identity.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  service: { type: 'string' },
                  version: { type: 'string' },
                  hmac_protocol: {
                    type: 'string',
                    description: 'Signature scheme used for webhook and callback bodies.',
                  },
                  features: { type: 'array', items: { type: 'string' } },
                },
              },
              example: VERSION_PAYLOAD,
            },
          },
        },
        429: COMMON_ERRORS[429],
      },
    },
  },

  '/status': {
    get: {
      operationId: 'getStatus',
      tags: ['Meta'],
      summary: 'Public health and throughput summary',
      description: [
        'Powers the dashboard banner and the public status page. Unauthenticated and',
        'cheap enough to poll every 10–30s.',
        '',
        '`ok` is a conjunction, not a liveness ping: it goes false when the system is',
        'frozen, when consecutive fulfillment failures pile up, when the Stellar watcher',
        'stops advancing its cursor, or when unparseable on-chain events land in the',
        'dead-letter table. A crashed watcher used to keep reporting `ok: true`.',
      ].join('\n'),
      security: [],
      responses: {
        200: {
          description: 'Current health.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  frozen: { type: 'boolean' },
                  consecutive_failures: { type: 'integer' },
                  orders: { type: 'object', additionalProperties: true },
                  last_24h: {
                    type: 'object',
                    additionalProperties: true,
                    description:
                      '`success_rate` is delivered / (delivered + failed + refunded), or null when nothing reached a terminal state.',
                  },
                  stellar_watcher: { type: 'object', additionalProperties: true },
                  webhooks: { type: 'object', additionalProperties: true },
                  process: { type: 'object', additionalProperties: true },
                  generated_at: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        429: COMMON_ERRORS[429],
      },
    },
  },

  '/v1/agent/claim': {
    post: {
      operationId: 'redeemClaim',
      tags: ['Agent'],
      summary: 'Exchange a dashboard-minted claim code for an API key',
      description: [
        'The one `/v1` endpoint reachable without an `X-Api-Key` header — requiring one',
        'would be circular, since this is how an agent obtains it.',
        '',
        'Single-use and one-shot: the key is returned exactly once, and the stored copy',
        'is wiped in the same statement that marks the code redeemed. There is no way to',
        'retrieve it again. Rate limited to 10 attempts per minute per IP.',
        '',
        'Invalid, expired and already-redeemed codes all return the same `invalid_claim`,',
        'so the response cannot be used to distinguish them.',
      ].join('\n'),
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['code'],
              properties: { code: { type: 'string', minLength: 1 } },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'The API key, returned once and never again.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  api_key: { type: 'string' },
                  key_id: { type: 'string' },
                  label: { type: 'string' },
                },
              },
            },
          },
        },
        400: errorResponse('The body was not a JSON object, or `code` was absent.', [
          'invalid_request',
          'missing_code',
        ]),
        401: errorResponse('Invalid, expired, or already redeemed.', ['invalid_claim']),
        429: COMMON_ERRORS[429],
      },
    },
  },

  '/v1/orders': {
    post: {
      operationId: 'createOrder',
      tags: ['Orders'],
      summary: 'Create a card order',
      description: [
        'Creates a pending order and returns Stellar payment instructions. Pay the',
        'contract, and fulfillment starts automatically once the watcher sees the event.',
        '',
        'Send an `Idempotency-Key` header on every create. A retry with the same key and',
        'an identical body returns the original response; the same key with a different',
        'body is rejected rather than silently creating a second card.',
      ].join('\n'),
      parameters: [
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description:
            'Client-generated key scoping the retry. Sending the header twice is rejected — a duplicate makes which value applies ambiguous.',
        },
      ],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateOrder' } } },
      },
      responses: {
        201: {
          description: 'Order created; pay the returned instructions.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  status: { type: 'string', enum: ['pending_payment', 'awaiting_approval'] },
                  amount_usdc: { type: 'string' },
                  payment: {
                    type: 'object',
                    additionalProperties: true,
                    description: 'Where and what to pay on Stellar.',
                  },
                },
              },
            },
          },
        },
        400: errorResponse('The request body failed validation.', [
          'invalid_request',
          'invalid_amount',
          'invalid_webhook_url',
          'invalid_metadata',
        ]),
        401: COMMON_ERRORS[401],
        409: errorResponse('The idempotency key was reused with a different body.', [
          'idempotency_key_reused',
        ]),
        429: COMMON_ERRORS[429],
      },
    },
    get: {
      operationId: 'listOrders',
      tags: ['Orders'],
      summary: 'List the calling key’s orders',
      description:
        'Newest first. Scoped to the calling key: an order created by another key is never visible here.',
      parameters: [
        {
          name: 'status',
          in: 'query',
          schema: { type: 'string', enum: [...ORDER_STATUSES] },
          description:
            'Filter by status. An unrecognised value is rejected with `invalid_status` rather than returning an empty list, which reads as "my orders disappeared".',
        },
        {
          name: 'since_created_at',
          in: 'query',
          schema: { type: 'string', format: 'date-time' },
          description:
            'Inclusive lower bound on `created_at`. Must be ISO-8601: the comparison is lexical, so a malformed bound would silently match everything or nothing.',
        },
        {
          name: 'since_updated_at',
          in: 'query',
          schema: { type: 'string', format: 'date-time' },
          description: 'Inclusive lower bound on `updated_at`. Same ISO-8601 requirement.',
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
          description: 'Clamped rather than rejected. An unparseable value falls back to 20.',
        },
        {
          name: 'offset',
          in: 'query',
          schema: { type: 'integer', minimum: 0, default: 0 },
          description: 'Clamped rather than rejected. An unparseable value falls back to 0.',
        },
      ],
      responses: {
        200: {
          description: 'Matching orders, newest first.',
          content: {
            'application/json': {
              schema: { type: 'array', items: { $ref: '#/components/schemas/OrderSummary' } },
            },
          },
        },
        400: errorResponse('A query parameter failed validation.', [
          'invalid_status',
          'invalid_since_created_at',
          'invalid_since_updated_at',
        ]),
        401: COMMON_ERRORS[401],
        429: COMMON_ERRORS[429],
      },
    },
  },

  '/v1/orders/{orderId}': {
    get: {
      operationId: 'getOrder',
      tags: ['Orders'],
      summary: 'Poll one order',
      description:
        'Card details appear on this response once the order reaches `delivered`. Reading them is itself an audited event.',
      parameters: [
        { name: 'orderId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: {
          description: 'The order, including card details once delivered.',
          content: {
            'application/json': {
              schema: { allOf: [{ $ref: '#/components/schemas/OrderSummary' }], type: 'object' },
            },
          },
        },
        401: COMMON_ERRORS[401],
        404: errorResponse('No such order, or it belongs to a different key.', ['not_found']),
        429: COMMON_ERRORS[429],
      },
    },
  },

  '/v1/orders/{orderId}/stream': {
    get: {
      operationId: 'streamOrder',
      tags: ['Orders'],
      summary: 'Server-sent events for one order',
      description: [
        'An SSE stream of status transitions, as an alternative to polling.',
        '',
        'Concurrent streams are capped per process; when the cap is reached the request',
        'is refused rather than degrading every existing stream. Fall back to polling',
        '`GET /v1/orders/{orderId}` on a 429.',
      ].join('\n'),
      parameters: [
        { name: 'orderId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: {
          description: 'An open `text/event-stream`.',
          content: { 'text/event-stream': { schema: { type: 'string' } } },
        },
        401: COMMON_ERRORS[401],
        404: errorResponse('No such order, or it belongs to a different key.', ['not_found']),
        429: COMMON_ERRORS[429],
      },
    },
  },

  '/v1/usage': {
    get: {
      operationId: 'getUsage',
      tags: ['Agent'],
      summary: 'Spend and order summary for the calling key',
      description:
        'Counters exclude terminal-negative orders from `in_progress`: an expired or rejected order is finished, and counting it as in-flight made agents wait on work that was never going to complete.',
      responses: {
        200: {
          description: 'Usage summary.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  api_key_id: { type: 'string' },
                  label: { type: 'string' },
                  budget: { $ref: '#/components/schemas/Budget' },
                  orders: {
                    type: 'object',
                    properties: {
                      total: { type: 'integer' },
                      delivered: { type: 'integer' },
                      failed: { type: 'integer' },
                      refunded: { type: 'integer' },
                      expired: { type: 'integer' },
                      rejected: { type: 'integer' },
                      in_progress: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        401: COMMON_ERRORS[401],
        429: COMMON_ERRORS[429],
      },
    },
  },

  '/v1/policy/check': {
    get: {
      operationId: 'checkPolicy',
      tags: ['Agent'],
      summary: 'Dry-run a spend-policy decision',
      description:
        'Answers what would happen if this amount were ordered now, without creating an order or recording a decision. `amount` uses the same decimal shape `POST /v1/orders` enforces, so a preview cannot succeed for an amount the order endpoint would reject.',
      parameters: [
        {
          name: 'amount',
          in: 'query',
          required: true,
          schema: { type: 'string', pattern: AMOUNT_USDC_SHAPE.source },
          example: '10.00',
        },
      ],
      responses: {
        200: {
          description: 'The decision this amount would receive.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PolicyDecision' } },
          },
        },
        400: errorResponse('`amount` was absent, malformed, or not positive.', ['invalid_amount']),
        401: COMMON_ERRORS[401],
        429: COMMON_ERRORS[429],
      },
    },
  },

  '/v1/agent/status': {
    post: {
      operationId: 'reportAgentStatus',
      tags: ['Agent'],
      summary: 'Report an onboarding or lifecycle transition',
      description: [
        'Drives the live onboarding indicator in the dashboard. Idempotent — the same',
        'state may be posted repeatedly without side effects.',
        '',
        'Every field is optional, and absent is not the same as null: an omitted field is',
        'left untouched, an explicit `null` clears it. At least one field must be present.',
      ].join('\n'),
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              minProperties: 1,
              additionalProperties: true,
              properties: {
                state: {
                  type: 'string',
                  enum: ['initializing', 'awaiting_funding', 'funded'],
                  description:
                    'The `minted` and `active` states are derived from activity and cannot be self-reported.',
                },
                wallet_public_key: {
                  type: 'string',
                  nullable: true,
                  description:
                    'Stellar G-address. The Ed25519 checksum is verified, not just the shape, so a typo is rejected here rather than surfacing later as a failed payout.',
                },
                detail: {
                  type: 'string',
                  nullable: true,
                  description: 'Free-text note, truncated to 500 characters.',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Recorded.',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
            },
          },
        },
        400: errorResponse('A field failed validation, or no updatable field was sent.', [
          'invalid_request',
          'invalid_state',
          'invalid_wallet_public_key',
          'invalid_detail',
          'nothing_to_update',
        ]),
        401: COMMON_ERRORS[401],
        429: COMMON_ERRORS[429],
      },
    },
  },

  '/auth/login': {
    post: {
      operationId: 'requestLoginCode',
      tags: ['Auth'],
      summary: 'Mail a one-time login code',
      description:
        'Always returns `{ ok: true }` for any well-formed address, whether or not an account exists — the response must not reveal which addresses are registered.',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: { email: { type: 'string', format: 'email' } },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Accepted. Reveals nothing about the address.',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
            },
          },
        },
        400: errorResponse('The body was not a JSON object, or `email` was malformed.', [
          'invalid_request',
          'invalid_email',
        ]),
        429: COMMON_ERRORS[429],
      },
    },
  },

  '/auth/verify': {
    post: {
      operationId: 'verifyLoginCode',
      tags: ['Auth'],
      summary: 'Exchange a login code for a session token',
      description: [
        'Codes are single-use and expire after 15 minutes; sessions last 7 days.',
        '',
        'Every failure mode returns the same shape on purpose. A missing `email` and a',
        'missing `code` produce an identical `missing_fields` message, because telling',
        'the caller which half was wrong tells them which half was right.',
      ].join('\n'),
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'code'],
              properties: {
                email: { type: 'string', format: 'email' },
                code: { type: 'string', description: '6-digit code from the login email.' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Session created.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  token: {
                    type: 'string',
                    description: 'Send as `Authorization: Bearer <token>`.',
                  },
                  user: { type: 'object', additionalProperties: true },
                  dashboard: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        400: errorResponse('The body was not a JSON object, or a field was absent.', [
          'invalid_request',
          'missing_fields',
        ]),
        401: errorResponse('The code was wrong or has expired.', ['invalid_code']),
        429: errorResponse(
          'Too many incorrect codes for this address, or too many attempts from this IP. Request a fresh code.',
          ['too_many_attempts'],
        ),
      },
    },
  },

  '/auth/me': {
    get: {
      operationId: 'getCurrentUser',
      tags: ['Auth'],
      summary: 'Resolve the current session',
      security: [{ sessionToken: [] }],
      responses: {
        200: {
          description: 'The signed-in user.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { user: { type: 'object', additionalProperties: true } },
              },
            },
          },
        },
        401: errorResponse('No session, or the session has expired.', ['unauthorized']),
      },
    },
  },

  '/auth/logout': {
    post: {
      operationId: 'logout',
      tags: ['Auth'],
      summary: 'Invalidate the current session',
      description:
        'Idempotent: a missing or already-expired token is a no-op and still returns `{ ok: true }`.',
      security: [{ sessionToken: [] }],
      responses: {
        200: {
          description: 'Session invalidated, or there was none.',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
            },
          },
        },
      },
    },
  },
};

/**
 * Build the OpenAPI document.
 *
 * `servers` is derived at call time rather than baked in, so a self-hosted
 * deployment reading its own /api/openapi.json gets its own base URL and
 * "Try it out" targets the right host.
 *
 * @param {{ baseUrl?: string }} [options]
 */
function buildOpenApiDocument(options = {}) {
  const baseUrl = options.baseUrl || process.env.CARDS402_BASE_URL || 'http://localhost:4000';

  return {
    openapi: '3.0.3',
    info: {
      title: 'Stellar_Card API',
      version: VERSION_PAYLOAD.version,
      description: [
        'Virtual Visa cards for autonomous agents. Pay in USDC or XLM on Stellar and',
        'receive card details once the payment confirms on-chain.',
        '',
        '## Authentication',
        '',
        'Every `/v1` endpoint except `POST /v1/agent/claim` requires an `X-Api-Key`',
        'header. Keys are minted in the dashboard as a one-time claim code and',
        'exchanged via that endpoint.',
        '',
        '`/auth` issues browser sessions for the dashboard and uses a bearer token',
        'instead. The two are separate credential systems and neither works in place of',
        'the other.',
        '',
        '## Errors',
        '',
        'Every error response carries a stable `error` code. Branch on that, never on',
        '`message` — the wording is free to change. Responses also carry `req_id`,',
        'echoed in the `X-Request-ID` header; quoting it lets an operator find the exact',
        'request in the server logs.',
        '',
        '## Rate limits',
        '',
        'Limits are advertised on every response through the standard `RateLimit-*`',
        'headers (draft-7). Budgets are per API key where a key is present and per IP',
        'otherwise, so one noisy agent cannot exhaust another’s allowance.',
        '',
        '## Not documented here',
        '',
        'The operator surface (`/dashboard`, `/internal`) and the HMAC-authenticated',
        '`/vcc-callback` are deliberately excluded: they have no third-party clients,',
        'and publishing them to anonymous readers only helps an attacker map the',
        'deployment.',
      ].join('\n'),
      contact: { name: 'Stellar_Card', url: 'https://stellar_card.com' },
    },
    servers: [{ url: baseUrl, description: 'This deployment' }],
    tags: [
      { name: 'Meta', description: 'Version and health. Unauthenticated.' },
      { name: 'Orders', description: 'Create, poll and stream card orders.' },
      { name: 'Agent', description: 'Key onboarding, usage and policy preview.' },
      { name: 'Auth', description: 'Dashboard sessions via emailed login codes.' },
    ],
    // Applied to every operation that does not override it. The
    // unauthenticated ones set `security: []` explicitly.
    security: [{ apiKey: [] }],
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Api-Key',
          description: 'Agent API key, obtained by redeeming a claim code.',
        },
        sessionToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'Dashboard session token returned by `POST /auth/verify`.',
        },
      },
      schemas: {
        Error: ErrorResponse,
        OrderSummary,
        CreateOrder: CreateOrderRequest,
        Budget,
        PolicyDecision,
      },
    },
  };
}

module.exports = { buildOpenApiDocument, UNDOCUMENTED_PREFIXES };
