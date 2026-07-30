// @ts-check
// POST /v1/agent/status — agent-reported lifecycle transitions.
//
// Mounted at /v1 AFTER the auth chain (unlike the sibling claim
// endpoint), so req.apiKey identifies the reporting agent.

const { Router } = require('express');
const { z } = require('zod');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { StrKey } = require('@stellar/stellar-sdk');
const db = require('../db');
const { validate } = require('../lib/validate');

const router = Router();

// ── Request schema ─────────────────────────────────────────────────────────
//
// Every field is optional and the handler distinguishes "absent" from
// "explicitly null" — absent means "leave this column alone", null means
// "clear it". So the schema has to preserve `undefined` rather than
// defaulting, which is why each field is declared with `z.unknown()` plus
// a refinement instead of a nullable typed field.
//
// Declaration order is load-bearing: Zod reports object issues in schema
// order and validate() surfaces the first one, so state → wallet →
// detail keeps the error a multiply-invalid request receives identical to
// the one the sequential guards returned.
const ALLOWED_STATES = ['initializing', 'awaiting_funding', 'funded'];

const UPDATABLE_FIELDS = ['state', 'wallet_public_key', 'detail'];

const AgentStatusBody = z
  .object({
    state: z.unknown().superRefine((value, ctx) => {
      if (value === undefined) return;
      if (typeof value !== 'string' || !ALLOWED_STATES.includes(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `state must be one of: ${ALLOWED_STATES.join(', ')} (the 'minted' and 'active' states are derived automatically from activity)`,
        });
      }
    }),

    // F2-agent-status: StrKey.isValidEd25519PublicKey enforces the
    // Stellar Ed25519 checksum. A shape-only regex (56 chars, base32
    // charset) accepts a typo'd address with a wrong checksum, which
    // stores silently and later blows up in the xlm-sender path or in
    // Horizon's account loader. Fail at the write boundary so the bad
    // value never enters the DB.
    wallet_public_key: z.unknown().superRefine((value, ctx) => {
      if (value === undefined || value === null) return;
      if (typeof value !== 'string' || !StrKey.isValidEd25519PublicKey(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'wallet_public_key must be a valid Stellar G-address (base32 + checksum)',
        });
      }
    }),

    // Without the typeof guard an object coerces to "[object Object]"
    // via String(), which passes a length check but stores a nonsense
    // row in agent_state_detail. The 500-char truncation stays in the
    // handler — it rewrites the value, and schemas here do not.
    detail: z.unknown().superRefine((value, ctx) => {
      if (value === undefined || value === null) return;
      if (typeof value !== 'string') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'detail must be a string or null' });
      }
    }),
  })
  .passthrough()
  .superRefine((body, ctx) => {
    // An empty body would otherwise build an UPDATE with no SET clause.
    // Reported at the object level (empty issue path), so it picks up
    // `defaultErrorCode` rather than a per-field code.
    if (!UPDATABLE_FIELDS.some((field) => body[field] !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Provide at least one of: ${UPDATABLE_FIELDS.join(', ')}`,
      });
    }
  });

const validateAgentStatus = validate({
  body: AgentStatusBody,
  errorCodes: {
    state: 'invalid_state',
    wallet_public_key: 'invalid_wallet_public_key',
    detail: 'invalid_detail',
  },
  defaultErrorCode: 'nothing_to_update',
});

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
router.post('/agent/status', agentStatusLimiter, validateAgentStatus, (req, res) => {
  const { emit: emitBusEvent } = require('../lib/event-bus');
  const { state, wallet_public_key, detail } = req.body;

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
    fields.push('agent_state_detail = @detail');
    // Truncation, not validation: the schema guarantees a string or
    // null, and the column budget is what caps the length.
    params.detail = detail ? detail.slice(0, 500) : null;
    eventPayload.detail = params.detail;
  }

  db.prepare(`UPDATE api_keys SET ${fields.join(', ')} WHERE id = @id`).run(params);

  emitBusEvent('agent_state', eventPayload);

  res.json({ ok: true });
});

module.exports = router;
