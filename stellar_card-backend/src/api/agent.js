// @ts-check
// POST /v1/agent/status — agent-reported lifecycle transitions.
//
// Mounted at /v1 AFTER the auth chain (unlike the sibling claim
// endpoint), so req.apiKey identifies the reporting agent.

const { Router } = require('express');
const { z } = require('zod');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { validate, boundedString, stellarPublicKey } = require('../lib/validate');
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

// ── Request schema ──────────────────────────────────────────────────────────
//
// The agent posts lifecycle transitions; each field is optional but at
// least one must be present — a body of {} is an empty report that
// previously 400'd as nothing_to_update and must keep doing so. The
// declaration order is load-bearing: Zod surfaces the first issue and
// the middleware maps it through the errorCodes map below, so a request
// that is wrong in several ways still gets the same error the sequential
// guards returned. An issue with no path (the all-fields-missing refine)
// falls through to defaultErrorCode.

const AGENT_STATES = ['initializing', 'awaiting_funding', 'funded'];

// `null` is meaningful on wallet_public_key and detail — "clear it" —
// which is why those fields are `.nullable()` as well as optional.
// Absent, null and the three whitelisted states cover every variant the
// handler knows how to store.
const AgentStatusBody = z
  .object({
    state: z
      .unknown()
      .optional()
      .superRefine((value, ctx) => {
        if (value === undefined) return;
        if (typeof value !== 'string' || !AGENT_STATES.includes(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `state must be one of: ${AGENT_STATES.join(', ')} (the 'minted' and 'active' states are derived automatically from activity)`,
          });
        }
      }),
    // F2-agent-status: StrKey checksum enforcement lives in the shared
    // stellarPublicKey primitive (lib/validate.js) — the old regex only
    // checked the base32 shape and would accept a typo'd address with a
    // wrong checksum, which stored silently and later blew up in the
    // xlm-sender path. The schema fails at the write boundary instead.
    wallet_public_key: stellarPublicKey(
      'wallet_public_key must be a valid Stellar G-address (base32 + checksum)',
    )
      .nullable()
      .optional(),
    // detail is explicitly bounded at 500 chars. The previous handler
    // silently sliced to 500; the shared bound turns that silent data
    // loss into a loud 400 (agent_state_detail is a TEXT column, so the
    // slice was the only cap).
    detail: boundedString(
      500,
      'detail must be a string or null',
      'detail must be at most 500 characters',
    )
      .nullable()
      .optional(),
  })
  .passthrough()
  .superRefine((body, ctx) => {
    if (
      body.state === undefined &&
      body.wallet_public_key === undefined &&
      body.detail === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one of: state, wallet_public_key, detail',
      });
    }
  });

const validateAgentStatusBody = validate({
  body: AgentStatusBody,
  errorCodes: {
    state: 'invalid_state',
    wallet_public_key: 'invalid_wallet_public_key',
    detail: 'invalid_detail',
  },
  defaultErrorCode: 'nothing_to_update',
});

router.post('/agent/status', agentStatusLimiter, validateAgentStatusBody, (req, res) => {
  const { emit: emitBusEvent } = require('../lib/event-bus');
  const { state, wallet_public_key, detail } = req.body || {};

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
    params.detail = detail ? detail.slice(0, 500) : null;
    eventPayload.detail = params.detail;
  }

  db.prepare(`UPDATE api_keys SET ${fields.join(', ')} WHERE id = @id`).run(params);

  emitBusEvent('agent_state', eventPayload);

  res.json({ ok: true });
});

module.exports = router;
