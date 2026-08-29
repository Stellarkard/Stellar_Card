// @ts-check
// POST /v1/agent/status — agent-reported lifecycle transitions.
//
// Mounted at /v1 AFTER the auth chain (unlike the sibling claim
// endpoint), so req.apiKey identifies the reporting agent.

const { Router } = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('../db');

const router = Router();

// Drives the live "onboarding state" pill in the dashboards. Idempotent:
// an agent can POST the same state repeatedly without side-effects.
//
// Every POST emits a bizEvent and fans out an agent_state event on the
// in-process bus, which the dashboard SSE stream picks up and relays to
// every connected browser. Without a limiter, an agent stuck in a tight
// loop (or a compromised key) could flood the bus and 100% the SSE fan-out.
// 60/min per key is ~20× the real workload — an agent only transitions
// through ~4 states over onboarding and rarely reports afterwards.
const agentStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (/** @type {any} */ req) =>
    /** @type {any} */ (req).apiKey?.id || ipKeyGenerator(req),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_, res) => res.status(429).json({ error: 'too_many_requests' }),
});
router.post('/agent/status', agentStatusLimiter, (req, res) => {
  const { emit: emitBusEvent } = require('../lib/event-bus');
  const { StrKey } = require('@stellar/stellar-sdk');
  const ALLOWED_STATES = new Set(['initializing', 'awaiting_funding', 'funded']);
  const { state, wallet_public_key, detail } = req.body || {};

  if (state !== undefined && !ALLOWED_STATES.has(state)) {
    return res.status(400).json({
      error: 'invalid_state',
      message: `state must be one of: ${[...ALLOWED_STATES].join(', ')} (the 'minted' and 'active' states are derived automatically from activity)`,
    });
  }
  // F2-agent-status: StrKey.isValidEd25519PublicKey enforces the
  // Stellar Ed25519 checksum — the previous regex only checked the
  // shape (56 chars, base32 charset) and would accept a typo'd address
  // with a wrong checksum. That stored silently and later blew up in
  // the xlm-sender path (which now uses StrKey itself) or Horizon's
  // account loader. Fail at the write boundary so the bad value never
  // enters the DB.
  if (wallet_public_key !== undefined && wallet_public_key !== null) {
    if (
      typeof wallet_public_key !== 'string' ||
      !StrKey.isValidEd25519PublicKey(wallet_public_key)
    ) {
      return res.status(400).json({
        error: 'invalid_wallet_public_key',
        message: 'wallet_public_key must be a valid Stellar G-address (base32 + checksum)',
      });
    }
  }

  const fields = [];
  const params = { id: req.apiKey.id, at: new Date().toISOString() };
  // F1-agent-status: build the fanout event payload alongside the
  // UPDATE so the broadcast mirrors the actually-updated set. The
  // previous version null-padded every field the caller didn't
  // provide, so a detail-only POST emitted {state: null, ...} over
  // the bus and dashboard SSE subscribers that treated null as
  // "cleared" visually regressed the onboarding pill.
  /** @type {Record<string, any>} */
  const eventPayload = { api_key_id: req.apiKey.id };
  if (state !== undefined) {
    fields.push('agent_state = @state', 'agent_state_at = @at');
    params.state = state;
    eventPayload.state = state;
  }
  if (wallet_public_key !== undefined) {
    fields.push('wallet_public_key = @wallet_public_key');
    params.wallet_public_key = wallet_public_key || null;
    eventPayload.wallet_public_key = wallet_public_key || null;
  }
  if (detail !== undefined) {
    // Reject non-string detail — without the typeof guard an object
    // coerces to "[object Object]" via String(), which passes the length
    // check but stores a nonsense row in agent_state_detail.
    if (detail !== null && typeof detail !== 'string') {
      return res.status(400).json({
        error: 'invalid_detail',
        message: 'detail must be a string or null',
      });
    }
    fields.push('agent_state_detail = @detail');
    params.detail = detail ? detail.slice(0, 500) : null;
    eventPayload.detail = params.detail;
  }
  if (fields.length === 0) {
    return res.status(400).json({
      error: 'nothing_to_update',
      message: 'Provide at least one of: state, wallet_public_key, detail',
    });
  }

  db.prepare(`UPDATE api_keys SET ${fields.join(', ')} WHERE id = @id`).run(params);

  emitBusEvent('agent_state', eventPayload);

  res.json({ ok: true });
});

module.exports = router;
