'use strict';

/**
 * Mock VCC Provider Server (Issue #962)
 *
 * A standalone, in-memory mock of a VCC (Virtual Card Creation) provider used
 * for local development and CI testing without live issuer credentials.
 *
 * Features:
 *  - Card creation (with Luhn-compliant 16-digit test card numbers)
 *  - Balance inquiries
 *  - Card freeze / unfreeze
 *  - Authorization simulation (approve / decline with configurable decline codes)
 *  - Transaction webhook emission (HMAC-SHA256 signed over raw body + timestamp)
 *
 * Usage:
 *   const { startMockVccServer, stopMockVccServer } = require('./mock-vcc-server');
 *   const { port, url } = await startMockVccServer({ port: 0 });
 *   ...
 *   await stopMockVccServer();
 *
 * The module is dependency-light (only Node core modules) so tests can import
 * it directly.
 */

const http = require('http');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WEBHOOK_SECRET = 'mock-vcc-webhook-secret';
const DEFAULT_PORT = Number(process.env.MOCK_VCC_PORT || 0);

const DECLINE_CODES = Object.freeze({
  INSUFFICIENT_FUNDS: '51',
  DO_NOT_HONOR: '05',
  EXPIRED_CARD: '54',
  INVALID_CARD_NUMBER: '14',
  RESTRICTED_CARD: '62',
  CARD_FROZEN: '41',
  FRAUD_SUSPECTED: '59',
  PROCESSING_ERROR: '96',
});

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const state = {
  cards: new Map(), // cardId -> card record
  authorizations: new Map(), // authId -> authorization record
  webhooks: [], // emitted webhook payloads (for test assertions)
  server: null,
  port: null,
  webhookSecret: DEFAULT_WEBHOOK_SECRET,
  webhookUrl: null,
  seq: 0,
};

function nextId(prefix) {
  state.seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${state.seq.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Luhn-compliant card number generation
// ---------------------------------------------------------------------------

/**
 * Compute the Luhn check digit for a numeric string (without check digit).
 * @param {string} digits
 * @returns {number}
 */
function luhnCheckDigit(digits) {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Validate a numeric string against the Luhn algorithm.
 * @param {string} number
 * @returns {boolean}
 */
function isValidLuhn(number) {
  if (!/^\d+$/.test(number)) return false;
  let sum = 0;
  let double = false;
  for (let i = number.length - 1; i >= 0; i -= 1) {
    let d = Number(number[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Generate a Luhn-compliant 16-digit test card number.
 * Uses the 4-series (Visa-like) test BIN prefix.
 * @param {string} [bin='4242'] - 4-digit BIN prefix
 * @returns {string}
 */
function generateCardNumber(bin = '4242') {
  const prefix = String(bin).replace(/\D/g, '').slice(0, 4).padEnd(4, '0');
  let body = prefix;
  while (body.length < 15) {
    body += Math.floor(Math.random() * 10).toString();
  }
  const check = luhnCheckDigit(body);
  return `${body}${check}`;
}

// ---------------------------------------------------------------------------
// Webhook signing
// ---------------------------------------------------------------------------

/**
 * Sign a raw webhook body with HMAC-SHA256.
 * Signature format: `t=<timestamp>,v1=<hex hmac of "<timestamp>.<body>">`
 * @param {string} rawBody
 * @param {string} secret
 * @param {number} [timestamp]
 * @returns {{ signature: string, timestamp: number }}
 */
function signWebhook(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const payload = `${timestamp}.${rawBody}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return { signature: `t=${timestamp},v1=${hmac}`, timestamp };
}

/**
 * Verify a webhook signature (mirrors the verification used by the backend).
 * @param {string} rawBody
 * @param {string} signatureHeader
 * @param {string} secret
 * @param {number} [toleranceSeconds=300]
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;
  const parts = {};
  for (const segment of signatureHeader.split(',')) {
    const idx = segment.indexOf('=');
    if (idx === -1) continue;
    parts[segment.slice(0, idx).trim()] = segment.slice(idx + 1).trim();
  }
  const ts = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(ts) || !provided) return false;
  if (toleranceSeconds > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > toleranceSeconds) return false;
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${rawBody}`, 'utf8')
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------

function createCardRecord({ currency = 'USD', initialBalance = 100000, bin = '4242' } = {}) {
  const cardId = nextId('card');
  const card = {
    id: cardId,
    number: generateCardNumber(bin),
    last4: null,
    currency,
    balance: Number(initialBalance),
    frozen: false,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  card.last4 = card.number.slice(-4);
  state.cards.set(cardId, card);
  return card;
}

function publicCard(card) {
  return {
    id: card.id,
    number: card.number,
    last4: card.last4,
    currency: card.currency,
    balance: card.balance,
    frozen: card.frozen,
    status: card.status,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Webhook emission
// ---------------------------------------------------------------------------

/**
 * Emit a transaction webhook. If a webhook URL is configured, POST it with a
 * signed body. The payload is always recorded in state.webhooks for assertions.
 * @param {object} event
 * @returns {Promise<object>} the recorded webhook record
 */
async function emitWebhook(event) {
  const body = JSON.stringify({
    id: nextId('evt'),
    type: event.type || 'transaction.created',
    created: Math.floor(Date.now() / 1000),
    data: event.data || {},
  });
  const { signature, timestamp } = signWebhook(body, state.webhookSecret);
  const record = {
    body,
    signature,
    timestamp,
    event: JSON.parse(body),
    delivered: false,
    deliveryError: null,
  };

  if (state.webhookUrl) {
    try {
      await postWebhook(state.webhookUrl, body, signature);
      record.delivered = true;
    } catch (err) {
      record.deliveryError = err.message;
    }
  }

  state.webhooks.push(record);
  return record;
}

function postWebhook(url, body, signature) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(new Error(`Invalid webhook URL: ${url}`));
      return;
    }
    const lib = target.protocol === 'https:' ? require('https') : require('http');
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-VCC-Signature': signature,
          'X-VCC-Timestamp': String(Math.floor(Date.now() / 1000)),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`Webhook responded with status ${res.statusCode}`));
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Webhook request timed out')));
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function parseJson(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleCreateCard(req, res) {
  const raw = await readBody(req);
  const body = parseJson(raw);
  if (body === null) return sendError(res, 400, 'invalid_json', 'Request body must be valid JSON');
  const card = createCardRecord({
    currency: body.currency || 'USD',
    initialBalance: body.initialBalance != null ? body.initialBalance : 100000,
    bin: body.bin || '4242',
  });
  return sendJson(res, 201, { card: publicCard(card) });
}

function handleGetCard(req, res, cardId) {
  const card = state.cards.get(cardId);
  if (!card) return sendError(res, 404, 'card_not_found', `Card ${cardId} not found`);
  return sendJson(res, 200, { card: publicCard(card) });
}

function handleBalance(req, res, cardId) {
  const card = state.cards.get(cardId);
  if (!card) return sendError(res, 404, 'card_not_found', `Card ${cardId} not found`);
  return sendJson(res, 200, {
    cardId: card.id,
    currency: card.currency,
    balance: card.balance,
    available: card.frozen ? 0 : card.balance,
    frozen: card.frozen,
  });
}

async function handleFreeze(req, res, cardId) {
  const card = state.cards.get(cardId);
  if (!card) return sendError(res, 404, 'card_not_found', `Card ${cardId} not found`);
  const raw = await readBody(req);
  const body = parseJson(raw);
  if (body === null) return sendError(res, 400, 'invalid_json', 'Request body must be valid JSON');
  const frozen = body.frozen !== undefined ? Boolean(body.frozen) : true;
  card.frozen = frozen;
  card.status = frozen ? 'frozen' : 'active';
  card.updatedAt = new Date().toISOString();
  return sendJson(res, 200, { card: publicCard(card) });
}

async function handleAuthorize(req, res, cardId) {
  const card = state.cards.get(cardId);
  if (!card) return sendError(res, 404, 'card_not_found', `Card ${cardId} not found`);

  const raw = await readBody(req);
  const body = parseJson(raw);
  if (body === null) return sendError(res, 400, 'invalid_json', 'Request body must be valid JSON');

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return sendError(res, 400, 'invalid_amount', 'amount must be a positive number');
  }

  const authId = nextId('auth');
  const now = new Date().toISOString();

  // Determine outcome.
  let approved = true;
  let declineCode = null;
  let declineReason = null;

  if (body.decline === true || body.forceDecline === true) {
    approved = false;
    declineCode = body.declineCode || DECLINE_CODES.DO_NOT_HONOR;
    declineReason = body.declineReason || 'Simulated decline';
  } else if (card.frozen) {
    approved = false;
    declineCode = DECLINE_CODES.CARD_FROZEN;
    declineReason = 'Card is frozen';
  } else if (amount > card.balance) {
    approved = false;
    declineCode = DECLINE_CODES.INSUFFICIENT_FUNDS;
    declineReason = 'Insufficient funds';
  }

  const auth = {
    id: authId,
    cardId: card.id,
    amount,
    currency: body.currency || card.currency,
    approved,
    declineCode,
    declineReason,
    status: approved ? 'approved' : 'declined',
    createdAt: now,
  };

  if (approved) {
    card.balance -= amount;
    card.updatedAt = now;
  }

  state.authorizations.set(authId, auth);

  // Emit a transaction webhook for the authorization.
  await emitWebhook({
    type: approved ? 'transaction.authorized' : 'transaction.declined',
    data: {
      authorizationId: authId,
      cardId: card.id,
      amount,
      currency: auth.currency,
      approved,
      declineCode,
      declineReason,
    },
  });

  return sendJson(res, approved ? 201 : 402, {
    authorization: {
      id: authId,
      cardId: card.id,
      amount,
      currency: auth.currency,
      approved,
      status: auth.status,
      declineCode,
      declineReason,
      createdAt: now,
    },
  });
}

function handleListAuthorizations(req, res, cardId) {
  const card = state.cards.get(cardId);
  if (!card) return sendError(res, 404, 'card_not_found', `Card ${cardId} not found`);
  const list = [];
  for (const auth of state.authorizations.values()) {
    if (auth.cardId === cardId) list.push(auth);
  }
  return sendJson(res, 200, { authorizations: list });
}

async function handleEmitWebhook(req, res) {
  const raw = await readBody(req);
  const body = parseJson(raw);
  if (body === null) return sendError(res, 400, 'invalid_json', 'Request body must be valid JSON');
  const record = await emitWebhook({
    type: body.type || 'transaction.created',
    data: body.data || {},
  });
  return sendJson(res, 202, { webhook: record.event, delivered: record.delivered });
}

function handleListWebhooks(req, res) {
  return sendJson(res, 200, {
    webhooks: state.webhooks.map((w) => ({
      event: w.event,
      signature: w.signature,
      delivered: w.delivered,
      deliveryError: w.deliveryError,
    })),
  });
}

function handleHealth(req, res) {
  return sendJson(res, 200, {
    status: 'ok',
    cards: state.cards.size,
    authorizations: state.authorizations.size,
    webhooks: state.webhooks.length,
  });
}

function handleReset(req, res) {
  state.cards.clear();
  state.authorizations.clear();
  state.webhooks.length = 0;
  state.seq = 0;
  return sendJson(res, 200, { status: 'reset' });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();

  try {
    if (path === '/health' && method === 'GET') return handleHealth(req, res);
    if (path === '/reset' && method === 'POST') return handleReset(req, res);

    if (path === '/v1/cards' && method === 'POST') return await handleCreateCard(req, res);

    let m = path.match(/^\/v1\/cards\/([^/]+)$/);
    if (m && method === 'GET') return handleGetCard(req, res, m[1]);

    m = path.match(/^\/v1\/cards\/([^/]+)\/balance$/);
    if (m && method === 'GET') return handleBalance(req, res, m[1]);

    m = path.match(/^\/v1\/cards\/([^/]+)\/freeze$/);
    if (m && (method === 'POST' || method === 'PUT')) return await handleFreeze(req, res, m[1]);

    m = path.match(/^\/v1\/cards\/([^/]+)\/authorize$/);
    if (m && method === 'POST') return await handleAuthorize(req, res, m[1]);

    m = path.match(/^\/v1\/cards\/([^/]+)\/authorizations$/);
    if (m && method === 'GET') return handleListAuthorizations(req, res, m[1]);

    if (path === '/v1/webhooks/emit' && method === 'POST') return await handleEmitWebhook(req, res);
    if (path === '/v1/webhooks' && method === 'GET') return handleListWebhooks(req, res);

    return sendError(res, 404, 'not_found', `No route for ${method} ${path}`);
  } catch (err) {
    return sendError(res, 500, 'internal_error', err.message || 'Internal error');
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the mock VCC server.
 * @param {object} [options]
 * @param {number} [options.port] - port to listen on (0 = ephemeral)
 * @param {string} [options.host='127.0.0.1']
 * @param {string} [options.webhookUrl] - URL to deliver emitted webhooks to
 * @param {string} [options.webhookSecret] - HMAC secret for webhook signing
 * @returns {Promise<{ port: number, url: string, server: http.Server }>}
 */
function startMockVccServer(options = {}) {
  if (state.server) {
    return Promise.reject(new Error('Mock VCC server is already running'));
  }

  const port = options.port != null ? Number(options.port) : DEFAULT_PORT;
  const host = options.host || '127.0.0.1';
  state.webhookUrl = options.webhookUrl || process.env.MOCK_VCC_WEBHOOK_URL || null;
  state.webhookSecret =
    options.webhookSecret || process.env.MOCK_VCC_WEBHOOK_SECRET || DEFAULT_WEBHOOK_SECRET;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      router(req, res).catch((err) => {
        if (!res.headersSent) sendError(res, 500, 'internal_error', err.message);
      });
    });

    server.on('error', (err) => {
      state.server = null;
      reject(err);
    });

    server.listen(port, host, () => {
      state.server = server;
      state.port = server.address().port;
      resolve({
        port: state.port,
        url: `http://${host}:${state.port}`,
        server,
      });
    });
  });
}

/**
 * Stop the mock VCC server and clear in-memory state.
 * @returns {Promise<void>}
 */
function stopMockVccServer() {
  return new Promise((resolve) => {
    const server = state.server;
    state.server = null;
    state.port = null;
    state.cards.clear();
    state.authorizations.clear();
    state.webhooks.length = 0;
    state.seq = 0;
    if (!server) return resolve();
    server.close(() => resolve());
    return undefined;
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  startMockVccServer,
  stopMockVccServer,
  // utilities
  generateCardNumber,
  luhnCheckDigit,
  isValidLuhn,
  signWebhook,
  verifyWebhookSignature,
  emitWebhook,
  // constants
  DECLINE_CODES,
  DEFAULT_WEBHOOK_SECRET,
  // state accessor (for tests)
  getState: () => state,
};