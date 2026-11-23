// @ts-check
// MPP router — unauthenticated endpoints for the Machine Payments
// Protocol. Mounted at /v1 BEFORE the auth middleware in app.js so
// anonymous agents can reach:
//
//   GET /v1/.well-known/mpp          → discovery
//   GET /v1/cards/visa/:amount       → 402 challenge (+ 200 on Phase 2 retry)
//   GET /v1/mpp/receipts/:id         → receipt polling for the 202 async path
//
// Phase 1 only serves the challenge shell: no credential verification
// and no card delivery. Phase 2 wires in verifyStellarPayment and the
// bounded-wait fulfillment handoff.

const { Router } = require('express');
const { STATUS_CODES } = require('http');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { event: bizEvent } = require('../lib/logger');
const { openCard } = require('../lib/card-vault');
const { usdToXlm } = require('../payments/xlm-price');
const {
  createChallenge,
  loadChallenge,
  loadOrderByReceiptId,
  parseChallengeRequest,
} = require('./challenge');
const { buildDiscoveryDoc, buildChallengeBody, buildWwwAuthenticate } = require('./discovery');
const { verifyAndCreateMppOrder } = require('./verify');
const { signCredential } = require('./credential');
const { waitForDelivery, streamDelivery } = require('./wait-for-delivery');

// Rate limiters for public endpoints.
//
// ipKeyGenerator takes an IP string, not the request. Passing `req` returns
// a fresh object per call, so the store never matches a previous hit and the
// limit never trips. Always pass req.ip.
const ipKey = (/** @type {any} */ req) => ipKeyGenerator(req.ip || 'unknown');

const discoveryLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: ipKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) =>
    sendProblem(res, 429, 'too_many_requests', 'Discovery rate limit exceeded. Retry in a minute.'),
});

const receiptLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: ipKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) =>
    sendProblem(res, 429, 'too_many_requests', 'Receipt polling rate limit exceeded. Retry in a minute.'),
});

// Per-IP rate limit on challenge creation. An unauthenticated endpoint
// must never be a free DoS amplifier — each GET creates a row in
// mpp_challenges, so we need a ceiling. 30/min/IP is plenty for a
// legitimate agent and cheap to enforce.
// A non-numeric MPP_CHALLENGE_RATE_LIMIT must not disable the limit
// (NaN never trips the check), so fall back to the default instead.
const CHALLENGE_RATE_LIMIT_DEFAULT = 30;
const challengeRateLimit = Number.parseInt(process.env.MPP_CHALLENGE_RATE_LIMIT ?? '', 10);
const challengeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit:
    Number.isFinite(challengeRateLimit) && challengeRateLimit > 0
      ? challengeRateLimit
      : CHALLENGE_RATE_LIMIT_DEFAULT,
  keyGenerator: ipKey,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) =>
    sendProblem(res, 429, 'too_many_requests', 'MPP challenge rate limit exceeded. Retry in a minute.'),
});

/**
 * Build the router. Factored as a function so tests (and any future
 * isolation need) can construct it with custom deps.
 * @param {object} [opts]
 * @param {() => number} [opts.ttlMs] - Challenge TTL resolver (reads env at request time).
 */
function buildMppRouter(opts = {}) {
  const router = Router();
  const ttlMs = opts.ttlMs ?? (() => parseInt(process.env.MPP_CHALLENGE_TTL_MS || '600000', 10));

  // ── Discovery ─────────────────────────────────────────────────────────
  // RFC-style discovery document. Served both at the legacy /v1-prefixed
  // path and at the canonical /.well-known/mpp.json location. The
  // canonical endpoint is open to any agent, so it advertises permissive
  // CORS and a one-hour public cache.
  router.get('/.well-known/mpp', discoveryLimiter, (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(buildDiscoveryDoc());
  });

  router.get('/.well-known/mpp.json', discoveryLimiter, (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Content-Type', 'application/json');
    return res.json(buildDiscoveryDoc());
  });

  // ── Challenge issuance ────────────────────────────────────────────────
  //
  // GET /v1/cards/visa/:amount returns 402 with the challenge. Phase 2
  // layers verification on top when Authorization: Payment is present.
  router.get('/cards/visa/:amount', challengeLimiter, async (req, res) => {
    const parsed = parseChallengeRequest({ amount: String(req.params.amount || '') });
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error, message: parsed.message });
    }
    const amountStr = parsed.amount;

    const resourcePath = `/v1/cards/visa/${amountStr}`;
    const amountUsdc = normaliseAmount(amountStr);

    // Credential present → verification + fulfillment path. The XLM
    // amount to verify against comes from the stored challenge row,
    // NOT a fresh usdToXlm() call, so price drift between challenge
    // issuance and retry doesn't cause spurious mismatches.
    if (req.headers.authorization && /^Payment\b/i.test(req.headers.authorization)) {
      const verdict = await verifyAndCreateMppOrder({
        authHeader: req.headers.authorization,
        resourcePath,
        expectedAmount: amountUsdc,
      });
      if (!verdict.ok) {
        // 410 (expired challenge) and 409 (replayed nonce) verdicts from
        // verify.js are surfaced verbatim via sendProblem.
        const v = /** @type {any} */ (verdict);
        bizEvent('mpp.verify_rejected', {
          status: v.status,
          reason: v.reason,
        });
        return sendProblem(res, v.status, v.reason, v.detail);
      }
      return handleDeliveryForVerdict(req, res, verdict);
    }

    // No credential → issue a fresh 402 challenge. Quote XLM at issuance
    // time and snapshot it onto the challenge row; retry verification
    // uses the stored value so any subsequent price movement doesn't
    // make a paid tx look like an amount mismatch.
    let amountXlmQuote = null;
    try {
      const xlm = await usdToXlm(amountUsdc);
      if (xlm) amountXlmQuote = xlm;
    } catch (err) {
      bizEvent('mpp.xlm_quote_failed', { amount: amountUsdc, error: err?.message });
    }

    const challenge = createChallenge({
      resourcePath,
      amountUsdc,
      amountXlm: amountXlmQuote,
      clientIp: clientIpOf(req),
      ttlMs: ttlMs(),
    });

    const body = buildChallengeBody({ challenge, amountUsdc, amountXlmQuote });
    bizEvent('mpp.challenge_created', {
      challenge_id: challenge.id,
      amount: amountUsdc,
      client_ip: clientIpOf(req),
    });

    res.set('WWW-Authenticate', buildWwwAuthenticate(challenge.id));
    res.set('Cache-Control', 'no-store');
    return res.status(402).json(body);
  });

  // ── Receipt polling (202 → 200 transition) ────────────────────────────
  router.get('/mpp/receipts/:id', receiptLimiter, (req, res) => {
    const row = loadOrderByReceiptId(req.params.id);
    if (!row) {
      return sendProblem(
        res,
        404,
        'receipt_not_found',
        'No receipt matches this id. It may have expired or never existed.',
      );
    }
    if (row.status === 'delivered') {
      return res
        .status(200)
        .set('Payment-Receipt', buildPaymentReceiptHeader(row))
        .json({
          state: 'delivered',
          receipt_id: req.params.id,
          order_id: row.id,
          amount_usdc: row.amount_usdc,
          card: extractCardFields(row),
        });
    }
    if (row.status === 'failed') {
      return sendProblem(
        res,
        502,
        'fulfillment_failed',
        'Fulfillment failed. Funds are being refunded to the sender address.',
        { state: 'failed', receipt_id: req.params.id, order_id: row.id },
      );
    }
    return res.status(202).json({
      state: 'fulfilling',
      receipt_id: req.params.id,
      order_id: row.id,
      poll_url: `/v1/mpp/receipts/${req.params.id}`,
    });
  });

  // ── Delivery stream (SSE, #969) ───────────────────────────────────────
  // Agents hold this connection open and get the outcome as soon as it is
  // known, instead of polling the receipt. Terminal bodies match the receipt
  // endpoint's 200 and 502 responses.
  router.get('/mpp/receipts/:id/stream', receiptLimiter, (req, res) => {
    const receiptId = req.params.id;
    const row = loadOrderByReceiptId(receiptId);
    if (!row) {
      return res.status(404).json({
        error: 'receipt_not_found',
        message: 'No receipt matches this id. It may have expired or never existed.',
      });
    }
    return streamDelivery(req, res, {
      orderId: row.id,
      toEvent: (fresh) =>
        fresh.status === 'delivered'
          ? {
              state: 'delivered',
              receipt_id: receiptId,
              order_id: fresh.id,
              amount_usdc: fresh.amount_usdc,
              card: extractCardFields(fresh),
            }
          : {
              state: 'failed',
              receipt_id: receiptId,
              order_id: fresh.id,
              message: 'Fulfillment failed. Funds are being refunded to the sender address.',
            },
    });
  });

  return router;
}

// ── Delivery handoff ─────────────────────────────────────────────────
//
// After synchronous verification succeeds the order is created and
// handlePayment has dispatched. Wait up to MPP_SYNC_WAIT_MS for the
// order to reach 'delivered'; beyond that, hand off to a 202 + Location.
async function handleDeliveryForVerdict(req, res, verdict) {
  const syncWaitMs = parseInt(process.env.MPP_SYNC_WAIT_MS || '10000', 10);
  const result = await waitForDelivery({ orderId: verdict.orderId, timeoutMs: syncWaitMs });

  // Issue a scoped, short-lived credential so the agent can make
  // subsequent card requests without re-running the challenge flow.
  const credential = issueCredentialForVerdict(verdict);

  if (result.state === 'delivered') {
    res.set('Payment-Receipt', buildPaymentReceiptHeader(result.order));
    return res.status(200).json({
      state: 'delivered',
      receipt_id: verdict.receiptId,
      order_id: verdict.orderId,
      amount_usdc: result.order.amount_usdc,
      card: extractCardFields(result.order),
      challenge_id: verdict.challengeId,
      tx_hash: verdict.txHash,
      ...credential,
    });
  }
  if (result.state === 'failed') {
    return sendProblem(
      res,
      502,
      'fulfillment_failed',
      'Fulfillment failed. Funds are being refunded to the sender address.',
      { state: 'failed', receipt_id: verdict.receiptId, order_id: verdict.orderId },
    );
  }
  // timeout — hand off to the receipt polling endpoint.
  const location = `/v1/mpp/receipts/${verdict.receiptId}`;
  res.set('Location', location);
  return res.status(202).json({
    state: 'fulfilling',
    receipt_id: verdict.receiptId,
    order_id: verdict.orderId,
    poll_url: location,
    ...credential,
  });
}

/**
 * Sign a credential for a verified agent. Failures are non-fatal: the
 * delivery payload is still returned, just without a credential.
 * @param {any} verdict
 * @returns {{ credential?: string, expires_in?: number }}
 */
function issueCredentialForVerdict(verdict) {
  try {
    const agentId = verdict.agentId ?? verdict.challengeId ?? verdict.orderId;
    const scope = verdict.scope ?? { amount_usdc: verdict.amountUsdc ?? null };
    const token = signCredential({ agentId, scope });
    return { credential: token, expires_in: 3600 };
  } catch (err) {
    bizEvent('mpp.credential_issue_failed', { error: err?.message });
    return {};
  }
}

function extractCardFields(row) {
  if (!row.card_number) return null;
  try {
    return openCard({
      number: row.card_number,
      cvv: row.card_cvv,
      expiry: row.card_expiry,
      brand: row.card_brand,
    });
  } catch {
    return {
      number: row.card_number,
      cvv: row.card_cvv,
      expiry: row.card_expiry,
      brand: row.card_brand,
    };
  }
}

function buildPaymentReceiptHeader(row) {
  const parts = [`challenge="${row.mpp_challenge_id ?? ''}"`];
  // stellar_txid column on orders stores the Stellar tx hash once
  // handlePayment marks the order paid. Fall back to empty if missing.
  if (row.stellar_txid) parts.push(`tx_hash="${row.stellar_txid}"`);
  parts.push(`settled_at="${new Date().toISOString()}"`);
  return parts.join(', ');
}

function clientIpOf(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.ip || null;
}

function normaliseAmount(s) {
  // '10' → '10.00'; '10.5' → '10.50'; '10.00' stays.
  if (!s.includes('.')) return `${s}.00`;
  const [whole, frac] = s.split('.');
  if (frac.length === 1) return `${whole}.${frac}0`;
  return s;
}

module.exports = { buildMppRouter, loadChallenge, normaliseAmount };
